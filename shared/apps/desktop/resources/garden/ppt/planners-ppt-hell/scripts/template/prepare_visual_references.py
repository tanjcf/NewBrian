#!/usr/bin/env python3
"""Prepare visual-only references for template extraction.

This deliberately does not inspect presentation internals. It accepts rendered
page images directly, or uses an already-available host PDF renderer for PDF
input. PPTX must first be rendered by the host presentation capability.
All paths converge on page images, a manifest, and one PNG contact sheet.

Run through the workspace Python launcher, for example:
  ./run_python.cmd scripts/template/prepare_visual_references.py INPUT --project PROJECT
"""

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw


RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"}


def natural_key(path):
    """Sort 2 before 10 without imposing any semantic grouping on images."""
    import re
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


def image_dimensions(path):
    """Return dimensions for PNG/JPEG without adding an image library dependency."""
    with path.open("rb") as fh:
        header = fh.read(32)
    if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24:
        return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")
    if header[:2] == b"\xff\xd8":
        with path.open("rb") as fh:
            fh.read(2)
            while True:
                marker = fh.read(2)
                if len(marker) < 2:
                    break
                while marker[0] != 0xFF:
                    marker = marker[1:] + fh.read(1)
                if marker[1] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                    length = int.from_bytes(fh.read(2), "big")
                    data = fh.read(length - 2)
                    return int.from_bytes(data[3:5], "big"), int.from_bytes(data[1:3], "big")
                if marker[1] in {0xD8, 0xD9}:
                    continue
                length_bytes = fh.read(2)
                if len(length_bytes) != 2:
                    break
                fh.seek(int.from_bytes(length_bytes, "big") - 2, 1)
    return None, None


def write_contact_sheet_png(page_paths, output_path):
    cell_w, cell_h, columns = 480, 310, 3
    rows = max(1, (len(page_paths) + columns - 1) // columns)
    canvas = Image.new("RGB", (columns * cell_w, rows * cell_h), "#F4F6F8")
    draw = ImageDraw.Draw(canvas)
    for index, page_path in enumerate(page_paths):
        image = Image.open(page_path).convert("RGB")
        image.thumbnail((cell_w - 32, cell_h - 58))
        x0 = (index % columns) * cell_w
        y0 = (index // columns) * cell_h
        x = x0 + (cell_w - image.width) // 2
        y = y0 + 16
        draw.rounded_rectangle(
            (x0 + 8, y0 + 8, x0 + cell_w - 8, y0 + cell_h - 8),
            radius=8, fill="#FFFFFF", outline="#D6DCE4", width=2,
        )
        canvas.paste(image, (x, y))
        draw.text((x0 + 16, y0 + cell_h - 34), f"{index + 1:03d} · {page_path.name}", fill="#3B4652")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "PNG")


def render_pdf_pages(source, target, dpi):
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise RuntimeError(
            "PDF rendering capability is unavailable. Ask the host to render the PDF to page images, "
            "then pass that image directory."
        )
    prefix = target / "_pdf_page"
    completed = subprocess.run(
        [renderer, "-png", "-r", str(dpi), str(source), str(prefix)],
        capture_output=True, text=True, check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Host PDF renderer failed: {(completed.stderr or completed.stdout).strip()}")
    generated = sorted(target.glob("_pdf_page-*.png"), key=natural_key)
    if not generated:
        raise RuntimeError("Host PDF renderer produced no page images")
    pages = []
    for index, raw in enumerate(generated, start=1):
        page = target / f"page_{index:03d}.png"
        raw.replace(page)
        pages.append(page)
    return pages


def prepare(source, project, output=None, dpi=144):
    source = Path(source).resolve()
    project = Path(project).resolve()
    if not source.exists():
        raise RuntimeError(f"Input path not found: {source}")
    target = Path(output) if output else project / "_internal" / "00_project" / "template_visuals"
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("page_*"):
        if old.is_file():
            old.unlink()

    suffix = source.suffix.lower()
    image_sources = None
    if source.is_dir():
        image_sources = sorted(
            (path for path in source.iterdir() if path.is_file() and path.suffix.lower() in RASTER_SUFFIXES),
            key=natural_key,
        )
        if not image_sources:
            raise RuntimeError("Image directory contains no supported raster files")
    elif suffix == ".pdf":
        pages = render_pdf_pages(source, target, dpi)
        page_size = None
    elif suffix == ".pptx":
        raise RuntimeError(
            "PPTX requires host presentation rendering before indexing. Render every slide to PNG/JPEG "
            "in a directory, then pass that directory to this script."
        )
    elif suffix not in RASTER_SUFFIXES:
        raise RuntimeError(
            "This indexer accepts rendered page images only. Render PPTX/PDF with the host's "
            "available presentation/PDF viewer, then pass the resulting image directory."
        )

    if suffix == ".pdf":
        pass
    elif image_sources:
        pages = []
        for index, image_source in enumerate(image_sources, start=1):
            page = target / f"page_{index:03d}{image_source.suffix.lower()}"
            shutil.copy2(image_source, page)
            pages.append(page)
        page_size = None
    else:
        page = target / f"page_001{source.suffix.lower()}"
        shutil.copy2(source, page)
        pages, page_size = [page], None

    page_entries = []
    for index, page in enumerate(pages, start=1):
        width, height = image_dimensions(page)
        page_entries.append({"page": index, "image": page.name, "width_px": width, "height_px": height})
    manifest = {
        "source_file": str(source),
        "source_files": [str(path) for path in image_sources] if image_sources else [str(source)],
        "input_type": "image_directory" if image_sources else suffix.lstrip("."),
        "visual_only": True,
        "pages": page_entries,
        "contact_sheet": "contact_sheet.png",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "worker_instruction": "Inspect all page images before generalizing. Treat this input as one template evidence set; do not automatically split styles. Infer only repeated visual direction, cite page evidence, and do not claim exact font names or PPTX XML style facts without proof.",
    }
    (target / "visual_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_contact_sheet_png(pages, target / "contact_sheet.png")
    canonical_render_dir = project / "_internal" / "00_project" / "template_rendered_pages"
    if source == canonical_render_dir and canonical_render_dir.is_dir():
        shutil.rmtree(canonical_render_dir)
    print(target / "visual_manifest.json")
    return target


def main():
    parser = argparse.ArgumentParser(description="Prepare visual references from PDF or rendered page images")
    parser.add_argument("source", help="PDF, raster image, or directory of rendered page images")
    parser.add_argument("--project", required=True, help="Planner project root")
    parser.add_argument("--output", help="Optional visual-reference directory")
    parser.add_argument("--dpi", type=int, default=144, help="PDF rendering DPI (default: 144)")
    args = parser.parse_args()
    try:
        prepare(args.source, args.project, args.output, args.dpi)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

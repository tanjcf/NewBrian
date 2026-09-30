from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

src = Path(
    r"C:\Users\Administrator\.cursor\projects\i-G-workrpase-BRAIN\assets"
    r"\c__Users_Administrator_AppData_Roaming_Cursor_User_workspaceStorage"
    r"_empty-window_images_image-b3ae9214-3eaf-4362-9549-ffd3e0d1409b.png"
)
out_dir = Path(r"I:\G盘迁移备份\workrpase\BRAIN\assets")
out_dir.mkdir(parents=True, exist_ok=True)

# Match existing NewBrain icon corner radius (~51px on 256 ≈ 20%).
CORNER_RADIUS_RATIO = 51 / 256


def extract_logo(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    rgb = arr[..., :3].astype(np.float32)
    alpha = arr[..., 3].astype(np.float32)
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    mask = np.clip((luma - 8.0) / 24.0, 0.0, 1.0) * (alpha / 255.0)

    ys, xs = np.where(mask > 0.05)
    if len(xs) == 0:
        raise SystemExit("no foreground found")

    pad = 4
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(arr.shape[1], int(xs.max()) + pad + 1)
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(arr.shape[0], int(ys.max()) + pad + 1)

    fg = arr[y0:y1, x0:x1].copy()
    fg[..., 3] = (np.clip(mask[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(fg, "RGBA")


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # Sharp-free rounded square; radius matches original product icon proportion.
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(logo: Image.Image, size: int) -> Image.Image:
    radius = max(1, int(round(size * CORNER_RADIUS_RATIO)))
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))

    margin = int(size * 0.12)
    max_w = size - 2 * margin
    max_h = size - 2 * margin
    scale = min(max_w / logo.width, max_h / logo.height)
    new_w = max(1, int(round(logo.width * scale)))
    new_h = max(1, int(round(logo.height * scale)))
    resized = logo.resize((new_w, new_h), Image.Resampling.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    canvas.alpha_composite(resized, (x, y))

    # Keep white plate only inside rounded corners; outside stays transparent.
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, (0, 0))
    out.putalpha(rounded_rect_mask(size, radius))
    return out


logo = extract_logo(src)
sizes = [256, 512, 1024]
outputs = []
for size in sizes:
    icon = make_icon(logo, size)
    path = out_dir / f"newbrain-icon-{size}.png"
    icon.save(path, "PNG")
    outputs.append(f"{path} (radius={int(round(size * CORNER_RADIUS_RATIO))}px)")

main = out_dir / "newbrain-desktop-icon.png"
Image.open(out_dir / "newbrain-icon-512.png").save(main, "PNG")
outputs.append(str(main))

ico_path = out_dir / "newbrain-desktop-icon.ico"
base = Image.open(out_dir / "newbrain-icon-512.png")
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_images = [make_icon(logo, s) for s in ico_sizes]
ico_images[0].save(
    ico_path,
    format="ICO",
    sizes=[(s, s) for s in ico_sizes],
    append_images=ico_images[1:],
)
outputs.append(str(ico_path))

print("OK")
for line in outputs:
    print(line)

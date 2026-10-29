/**
 * Build tray-only multi-size ICO from the real NewBrain brain logo (monochrome).
 * Prefers build/tray-source-mono.png (faithful B&W logo); falls back to converting public/icon.png.
 * Does NOT overwrite build/icon.ico (taskbar / exe marketing asset).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const monoSource = path.join(desktopRoot, "build", "tray-source-mono.png");
const colorSource = path.join(desktopRoot, "public", "icon.png");
const sourcePng = fs.existsSync(monoSource) ? monoSource : colorSource;
const convertFromColor = sourcePng === colorSource;
const targets = [
  path.join(desktopRoot, "build", "tray.ico"),
  path.join(desktopRoot, "public", "tray.ico")
];
const previewPng = path.join(desktopRoot, "build", "tray-preview-32.png");
const sizes = [16, 20, 24, 32, 48, 64];

if (!fs.existsSync(sourcePng)) {
  throw new Error(`Missing logo source: ${sourcePng}`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-tray-logo-"));
const localSource = path.join(workDir, "source-icon.png");
fs.copyFileSync(sourcePng, localSource);
const ps1 = path.join(workDir, "render.ps1");
// Keep PowerShell on short ASCII temp paths — Chinese source roots break Bitmap.FromFile.
const sourceEscaped = localSource.replace(/\\/g, "\\\\").replace(/'/g, "''");
const outEscaped = workDir.replace(/\\/g, "\\\\").replace(/'/g, "''");
const convertFlag = convertFromColor ? "$true" : "$false";

fs.writeFileSync(
  ps1,
  `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = '${sourceEscaped}'
$outDir = '${outEscaped}'
$convertFromColor = ${convertFlag}

function Convert-ToMonochromeLogo([System.Drawing.Bitmap]$src) {
  $dst = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $dst.SetResolution($src.HorizontalResolution, $src.VerticalResolution)
  for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
      $c = $src.GetPixel($x, $y)
      if ($c.A -lt 8) {
        $dst.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        continue
      }
      $max = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
      $min = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
      $sat = $max - $min
      $isPlate = ($max -ge 235 -and $sat -le 18)
      if ($isPlate) {
        $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 255, 255, 255))
      } else {
        $ink = [Math]::Max(0, [Math]::Min(255, [int]((255 - $max) * 1.15 + $sat * 0.55)))
        if ($ink -lt 12) {
          $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 255, 255, 255))
        } else {
          $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([Math]::Min(255, $ink), 12, 12, 12))
        }
      }
    }
  }
  return $dst
}

function Resize-HighQuality([System.Drawing.Bitmap]$src, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $size, $size)
  } finally {
    $g.Dispose()
  }
  return $bmp
}

$src = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  $logo = if ($convertFromColor) { Convert-ToMonochromeLogo $src } else { $src }
  try {
    foreach ($size in @(16, 20, 24, 32, 48, 64)) {
      $sized = Resize-HighQuality $logo $size
      try {
        $sized.Save((Join-Path $outDir ("icon-" + $size + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $sized.Dispose()
      }
    }
  } finally {
    if ($convertFromColor) { $logo.Dispose() }
  }
} finally {
  $src.Dispose()
}
`,
  "utf8"
);

execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
  stdio: "inherit",
  windowsHide: true
});

function packIco(pngFiles) {
  const count = pngFiles.length;
  let offset = 6 + count * 16;
  const entries = pngFiles.map(({ size, buffer }) => {
    const entry = {
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      bytes: buffer.length,
      offset
    };
    offset += buffer.length;
    return entry;
  });
  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);
  pngFiles.forEach((image, i) => {
    const entry = entries[i];
    const o = 6 + i * 16;
    out[o] = entry.width;
    out[o + 1] = entry.height;
    out.writeUInt16LE(1, o + 4);
    out.writeUInt16LE(32, o + 6);
    out.writeUInt32LE(entry.bytes, o + 8);
    out.writeUInt32LE(entry.offset, o + 12);
    image.buffer.copy(out, entry.offset);
  });
  return out;
}

const pngFiles = sizes.map((size) => {
  const file = path.join(workDir, `icon-${size}.png`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  return { size, buffer: fs.readFileSync(file) };
});
const ico = packIco(pngFiles);
for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, ico);
  console.log("wrote", target, ico.length);
}
fs.copyFileSync(path.join(workDir, "icon-32.png"), previewPng);
console.log("source", sourcePng);
console.log("preview", previewPng);
fs.rmSync(workDir, { recursive: true, force: true });

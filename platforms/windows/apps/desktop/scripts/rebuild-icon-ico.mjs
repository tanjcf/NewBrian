/**
 * Build tray-only multi-size ICO (thick glyph for 16–32px).
 * Does NOT overwrite build/icon.ico — that stays the marketing logo for taskbar/exe.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const targets = [
  path.join(desktopRoot, "build", "tray.ico"),
  path.join(desktopRoot, "public", "tray.ico")
];
const sizes = [16, 20, 24, 32, 48, 64];

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-tray-only-"));
const ps1 = path.join(workDir, "render.ps1");

fs.writeFileSync(
  ps1,
  `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outDir = '${workDir.replace(/\\/g, "\\\\")}'

function New-TrayGlyph([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $m = [Math]::Max(1, [int][Math]::Floor($size * 0.05))
    $plate = New-Object System.Drawing.Rectangle $m, $m, ($size - 2 * $m), ($size - 2 * $m)
    $r = [Math]::Max(2, [int][Math]::Floor($size * 0.2))
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $gp.AddArc($plate.X, $plate.Y, $d, $d, 180, 90)
    $gp.AddArc($plate.Right - $d, $plate.Y, $d, $d, 270, 90)
    $gp.AddArc($plate.Right - $d, $plate.Bottom - $d, $d, $d, 0, 90)
    $gp.AddArc($plate.X, $plate.Bottom - $d, $d, $d, 90, 90)
    $gp.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,255,255,255))), $gp)

    $stroke = [Math]::Max(1.6, $size / 11.0)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
      (New-Object System.Drawing.Point 0, $size),
      (New-Object System.Drawing.Point $size, 0),
      [System.Drawing.Color]::FromArgb(255, 120, 80, 220),
      [System.Drawing.Color]::FromArgb(255, 40, 200, 210)
    )
    $pen = New-Object System.Drawing.Pen $brush, $stroke
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $cx = $size / 2.0
    $cy = $size / 2.0 + $size * 0.02
    $w = $size * 0.58
    $h = $size * 0.48
    $left = $cx - $w / 2
    $top = $cy - $h / 2
    $g.DrawArc($pen, $left, $top, ($w * 0.95), ($h * 0.55), 200, 145)
    $g.DrawArc($pen, ($left + $w * 0.04), ($top + $h * 0.16), ($w * 0.92), ($h * 0.5), 200, 150)
    $g.DrawArc($pen, ($left + $w * 0.08), ($top + $h * 0.34), ($w * 0.84), ($h * 0.48), 200, 155)
    $g.DrawArc($pen, ($left + $w * 0.16), ($top + $h * 0.5), ($w * 0.64), ($h * 0.42), 210, 145)
    $g.DrawLine($pen, ($cx + $w * 0.16), ($cy + $h * 0.2), ($cx + $w * 0.28), ($cy + $h * 0.4))

    $pen.Dispose(); $brush.Dispose(); $gp.Dispose()
  } finally { $g.Dispose() }
  return $bmp
}

foreach ($size in @(16,20,24,32,48,64)) {
  $bmp = New-TrayGlyph $size
  $bmp.Save((Join-Path $outDir ("icon-" + $size + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
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
fs.rmSync(workDir, { recursive: true, force: true });

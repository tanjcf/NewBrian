/**
 * Generate spring-app favicon / apple-touch assets from BRAIN mono brain logo.
 * Source of truth: BRAIN tray-source-mono.png (black brain on white rounded plate).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const brainRoot = path.resolve(here, "..");
const source = path.join(
  brainRoot,
  "platforms/windows/apps/desktop/build/tray-source-mono.png"
);
const springRoot = path.resolve(brainRoot, "../spring-app");
const outDirs = [
  path.join(springRoot, "frontend/public"),
  path.join(springRoot, "src/main/resources/static/app")
];

if (!fs.existsSync(source)) {
  throw new Error(`Missing mono logo source: ${source}`);
}
for (const dir of outDirs) {
  if (!fs.existsSync(dir)) throw new Error(`Missing output dir: ${dir}`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-favicon-"));
const localSource = path.join(workDir, "source.png");
fs.copyFileSync(source, localSource);
const ps1 = path.join(workDir, "render.ps1");
const sourceEsc = localSource.replace(/\\/g, "\\\\").replace(/'/g, "''");
const outEsc = workDir.replace(/\\/g, "\\\\").replace(/'/g, "''");

const sizes = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-48x48.png", size: 48 },
  { name: "favicon-64x64.png", size: 64 },
  { name: "favicon.png", size: 64 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "favicon-source.png", size: 512 }
];

fs.writeFileSync(
  ps1,
  `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = '${sourceEsc}'
$outDir = '${outEsc}'
$src = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  $specs = @(
    @{ Name='favicon-16x16.png'; Size=16 },
    @{ Name='favicon-32x32.png'; Size=32 },
    @{ Name='favicon-48x48.png'; Size=48 },
    @{ Name='favicon-64x64.png'; Size=64 },
    @{ Name='favicon.png'; Size=64 },
    @{ Name='apple-touch-icon.png'; Size=180 },
    @{ Name='icon-192.png'; Size=192 },
    @{ Name='favicon-source.png'; Size=512 }
  )
  foreach ($spec in $specs) {
    $size = [int]$spec.Size
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::White)
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($src, 0, 0, $size, $size)
    } finally { $g.Dispose() }
    $bmp.Save((Join-Path $outDir $spec.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
} finally { $src.Dispose() }
`,
  "utf8"
);

execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
  stdio: "inherit",
  windowsHide: true
});

for (const { name } of sizes) {
  const file = path.join(workDir, name);
  if (!fs.existsSync(file)) throw new Error(`Missing generated ${name}`);
  for (const dir of outDirs) {
    const dest = path.join(dir, name);
    fs.copyFileSync(file, dest);
    console.log("wrote", dest, fs.statSync(dest).size);
  }
}

// Keep a copy of mono source as brand mark reference for favicons.
for (const dir of outDirs) {
  const mark = path.join(dir, "favicon-mono-source.png");
  fs.copyFileSync(source, mark);
  console.log("wrote", mark);
}

fs.rmSync(workDir, { recursive: true, force: true });
console.log("favicon assets regenerated from mono brain logo");

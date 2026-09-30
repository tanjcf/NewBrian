const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const msi = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\NewBrain 1.2.9-unsigned.msi`;
const expectedAsar = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\_p\12108-1\win-unpacked\resources\app.asar`;
const installedAsar = String.raw`C:\Program Files\NewBrain\resources\app.asar`;
const extractMsi = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msi-extract`;
fs.rmSync(extractMsi, { recursive: true, force: true });
fs.mkdirSync(extractMsi, { recursive: true });

console.log("expected", sha256(expectedAsar), fs.statSync(expectedAsar).size);
console.log("installed-before", sha256(installedAsar), fs.statSync(installedAsar).size);

console.log("extracting msi with msiexec /a ...");
const adminLog = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msiexec-admin-extract.log`;
const admin = spawnSync(
  "msiexec.exe",
  ["/a", msi, "/qn", `TARGETDIR=${extractMsi}`, "/L*v", adminLog],
  { encoding: "utf8", windowsHide: true }
);
console.log("admin extract status", admin.status);

function findAsar(root) {
  const out = [];
  function go(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) go(full);
      else if (name === "app.asar") out.push(full);
    }
  }
  go(root);
  return out;
}

const extracted = findAsar(extractMsi);
console.log(
  "msi asars",
  extracted.map((p) => ({ path: p, sha256: sha256(p), size: fs.statSync(p).size }))
);

// Uninstall product then reinstall fresh.
const productCode = "{71E46D6D-C600-4F15-8CC6-4A6595418FF6}";
try {
  execFileSync("taskkill.exe", ["/IM", "newbrain.exe", "/F"], { stdio: "ignore" });
} catch {}

console.log("uninstall product", productCode);
const uninstallLog = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msiexec-uninstall.log`;
const uninstall = spawnSync(
  "msiexec.exe",
  ["/x", productCode, "/qn", "/norestart", "/L*v", uninstallLog],
  { encoding: "utf8", windowsHide: true }
);
console.log("uninstall status", uninstall.status);

console.log("fresh install");
const installLog = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msiexec-fresh-install.log`;
const install = spawnSync(
  "msiexec.exe",
  ["/i", msi, "/qn", "/norestart", "/L*v", installLog],
  { encoding: "utf8", windowsHide: true }
);
console.log("install status", install.status);

if (fs.existsSync(installedAsar)) {
  const after = sha256(installedAsar);
  console.log("installed-after", after, fs.statSync(installedAsar).size);
  console.log("matches expected", after === sha256(expectedAsar));
} else {
  console.log("installed asar missing after fresh install");
}

// Launch and confirm process path.
const exe = String.raw`C:\Program Files\NewBrain\newbrain.exe`;
if (fs.existsSync(exe)) {
  const { spawn } = require("child_process");
  const child = spawn(exe, [], { detached: true, stdio: "ignore" });
  child.unref();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  const procs = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'newbrain.exe' } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
    ],
    { encoding: "utf8" }
  ).trim();
  console.log("running", procs);
}

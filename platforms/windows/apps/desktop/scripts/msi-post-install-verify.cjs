const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });
}

function ps(script) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

const evidencePath = path.join(os.tmpdir(), "newbrain-msi-smoke", "post-install-evidence.json");
const asar = String.raw`C:\Program Files\NewBrain\resources\app.asar`;
const unpackedMain = String.raw`C:\Program Files\NewBrain\resources\app.asar.unpacked`;

const registry = ps(
  "$p = Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'NewBrain' } | Select-Object -First 1 DisplayName,DisplayVersion,Publisher,InstallLocation,InstallDate,EstimatedSize; if ($p) { $p | ConvertTo-Json -Compress }"
).trim();

let asarCli = null;
const roots = [
  String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\node_modules\@electron\asar\bin\asar.js`,
  String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\node_modules\@electron\asar\bin\asar.js`
];
for (const root of roots) {
  if (fs.existsSync(root)) {
    asarCli = root;
    break;
  }
}
if (!asarCli) {
  const pnpm = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\node_modules\.pnpm`;
  if (fs.existsSync(pnpm)) {
    for (const d of fs.readdirSync(pnpm)) {
      if (!d.startsWith("@electron+asar@")) continue;
      const candidate = path.join(pnpm, d, "node_modules", "@electron", "asar", "bin", "asar.js");
      if (fs.existsSync(candidate)) {
        asarCli = candidate;
        break;
      }
    }
  }
}

const extractDir = path.join(os.tmpdir(), "newbrain-msi-smoke", "asar-extract");
fs.rmSync(extractDir, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });

const checks = {
  registry: registry ? JSON.parse(registry) : null,
  asarExists: fs.existsSync(asar),
  asarSize: fs.existsSync(asar) ? fs.statSync(asar).size : 0,
  asarCli,
  fixMarkers: {}
};

if (asarCli && checks.asarExists) {
  run("node", [asarCli, "extract", asar, extractDir]);
  const targets = [
    path.join(extractDir, "out", "preload", "index.cjs"),
    path.join(extractDir, "out", "main", "index.js"),
    path.join(extractDir, "package.json")
  ];
  const rendererDir = path.join(extractDir, "out", "renderer", "assets");
  const rendererJs = fs.existsSync(rendererDir)
    ? fs.readdirSync(rendererDir).filter((name) => /^index-.*\.js$/.test(name)).map((name) => path.join(rendererDir, name))
    : [];
  const scanFiles = [...targets, ...rendererJs];
  for (const file of scanFiles) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    checks.fixMarkers[path.relative(extractDir, file).replace(/\\/g, "/")] = {
      reportRendererDiagnostic: text.includes("reportRendererDiagnostic") || text.includes("report-renderer-diagnostic"),
      filePreviewBlank: text.includes("file_preview_") || text.includes("file-preview-blank-state") || text.includes("blankReason"),
      stalePreviewGuard: text.includes("isStaleFilePreviewRequest") || text.includes("filePreviewRequestSequence"),
      packageVersion: text.includes("\"version\": \"1.2.9\"") || text.includes("1.2.9")
    };
  }
}

const procs = JSON.parse(
  ps(
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(NewBrain|newbrain)\\.exe$' } | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"
  ).trim() || "[]"
);

checks.runningInstalled = (Array.isArray(procs) ? procs : [procs]).filter((p) =>
  String(p.ExecutablePath || "").toLowerCase() === String.raw`c:\program files\newbrain\newbrain.exe`.toLowerCase()
);
checks.stillRunning = checks.runningInstalled.length > 0;
checks.observedAt = new Date().toISOString();

fs.writeFileSync(evidencePath, JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));

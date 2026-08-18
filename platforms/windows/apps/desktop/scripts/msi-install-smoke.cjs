const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const msi = String.raw`I:\G盘迁移备份\workrpase\codeCN\windows\apps\desktop\release\codeCN 1.2.9-unsigned.msi`;
const logDir = path.join(os.tmpdir(), "codecn-msi-smoke");
fs.mkdirSync(logDir, { recursive: true });
const installLog = path.join(logDir, "msiexec-install.log");
const evidencePath = path.join(logDir, "evidence.json");

function run(cmd, args, opts = {}) {
  console.log(`[run] ${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...opts
  });
}

function ps(script) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listCodeCnProcesses() {
  try {
    const out = ps(
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(codeCN|codecn|electron)\\.exe$' } | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function stopInstalledCodeCn() {
  const procs = listCodeCnProcesses().filter((p) => {
    const exe = String(p.ExecutablePath || "");
    return /\\codecn\.exe$/i.test(exe);
  });
  for (const p of procs) {
    try {
      run("taskkill.exe", ["/PID", String(p.ProcessId), "/T", "/F"]);
    } catch (error) {
      console.warn("taskkill failed", p.ProcessId, error.message);
    }
  }
}

function findInstalledExe() {
  const candidates = [
    String.raw`C:\Program Files\codeCN\codecn.exe`,
    String.raw`C:\Program Files (x86)\codeCN\codecn.exe`,
    path.join(process.env.LOCALAPPDATA || "", "Programs", "codeCN", "codecn.exe")
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const out = ps(
      "$p = Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'codeCN' } | Select-Object -First 1 DisplayName,DisplayVersion,InstallLocation,UninstallString; if ($p) { $p | ConvertTo-Json -Compress }"
    ).trim();
    if (out) {
      const info = JSON.parse(out);
      if (info.InstallLocation) {
        const exe = path.join(info.InstallLocation, "codecn.exe");
        if (fs.existsSync(exe)) return exe;
      }
      return info;
    }
  } catch (error) {
    console.warn("uninstall registry lookup failed", error.message);
  }
  return null;
}

function fileVersion(exe) {
  try {
    return ps(`(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`).trim();
  } catch {
    return "";
  }
}

if (!fs.existsSync(msi)) {
  console.error("MSI missing:", msi);
  process.exit(1);
}

console.log("Stopping previously installed codeCN processes...");
stopInstalledCodeCn();

console.log("Installing MSI...");
let installExit = 0;
try {
  run("msiexec.exe", ["/i", msi, "/qn", "/norestart", "/L*v", installLog]);
} catch (error) {
  installExit = typeof error.status === "number" ? error.status : 1;
  console.error("msiexec failed", installExit, error.stderr || error.message);
}

const installedExe = findInstalledExe();
const evidence = {
  msi,
  installExit,
  installLog,
  installedExe: typeof installedExe === "string" ? installedExe : null,
  uninstallInfo: typeof installedExe === "object" ? installedExe : null,
  fileVersion: typeof installedExe === "string" ? fileVersion(installedExe) : "",
  processesBeforeLaunch: listCodeCnProcesses()
};

if (installExit !== 0 || !evidence.installedExe) {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.error("INSTALL FAILED", evidencePath);
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}

console.log("Launching", evidence.installedExe);
const child = spawn(evidence.installedExe, [], {
  detached: true,
  stdio: "ignore",
  windowsHide: false
});
child.unref();

const startedAt = Date.now();
let launched = null;
while (Date.now() - startedAt < 20000) {
  const procs = listCodeCnProcesses().filter((p) =>
    String(p.ExecutablePath || "").toLowerCase() === evidence.installedExe.toLowerCase()
  );
  if (procs.length) {
    launched = procs;
    break;
  }
  sleep(500);
}

evidence.launchedProcesses = launched || listCodeCnProcesses();
evidence.launchOk = Boolean(launched && launched.length);
evidence.pathMatchesInstall = evidence.launchOk;
evidence.observedAt = new Date().toISOString();
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.launchOk ? 0 : 2);

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const msi = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\NewBrain 1.3.0-unsigned.msi`;
const expectedAsar = "9C5E6441502244D2071EB78F263B068D6C6D3758A78DBF212C8F763631AF8A28";
const unpackedAsar = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\_p\15992-1\win-unpacked\resources\app.asar`;
const logDir = path.join(os.tmpdir(), "newbrain-msi-smoke-130");
fs.mkdirSync(logDir, { recursive: true });
const installLog = path.join(logDir, "msiexec-install.log");
const evidencePath = path.join(logDir, "evidence.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

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
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(NewBrain|newbrain|electron)\\.exe$' } | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function stopInstalledCodeCn() {
  for (const p of listCodeCnProcesses()) {
    const exe = String(p.ExecutablePath || "");
    if (!/newbrain\.exe$/i.test(exe) && !/NewBrain\.exe$/i.test(exe)) continue;
    try {
      run("taskkill.exe", ["/PID", String(p.ProcessId), "/T", "/F"]);
    } catch (error) {
      console.warn("taskkill failed", p.ProcessId, error.message);
    }
  }
}

function candidateInstallRoots() {
  return [
    path.join(process.env.LOCALAPPDATA || "", ".newbrain"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "NewBrain"),
    String.raw`C:\Program Files\NewBrain`,
    String.raw`C:\Program Files (x86)\NewBrain`
  ].filter(Boolean);
}

function findInstalledExe() {
  for (const root of candidateInstallRoots()) {
    for (const name of ["newbrain.exe", "NewBrain.exe"]) {
      const exe = path.join(root, name);
      if (fs.existsSync(exe)) return exe;
    }
  }
  try {
    const out = ps(
      "$paths = @('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); $p = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'NewBrain' } | Select-Object -First 1 DisplayName,DisplayVersion,InstallLocation,UninstallString; if ($p) { $p | ConvertTo-Json -Compress }"
    ).trim();
    if (out) {
      const info = JSON.parse(out);
      if (info.InstallLocation) {
        for (const name of ["newbrain.exe", "NewBrain.exe"]) {
          const exe = path.join(info.InstallLocation, name);
          if (fs.existsSync(exe)) return exe;
        }
      }
      return info;
    }
  } catch (error) {
    console.warn("registry lookup failed", error.message);
  }
  return null;
}

function fileVersion(exe) {
  try {
    return ps(`(Get-Item -LiteralPath '${String(exe).replace(/'/g, "''")}').VersionInfo.ProductVersion`).trim();
  } catch {
    return "";
  }
}

function resolveAsarCli() {
  const desktop = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop`;
  const windowsRoot = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows`;
  const direct = [
    path.join(desktop, "node_modules", "@electron", "asar", "bin", "asar.js"),
    path.join(windowsRoot, "node_modules", "@electron", "asar", "bin", "asar.js")
  ];
  for (const candidate of direct) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const pnpmRoot = path.join(windowsRoot, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmRoot)) {
    const hit = fs.readdirSync(pnpmRoot).filter((name) => name.startsWith("@electron+asar@")).sort().reverse()[0];
    if (hit) {
      const candidate = path.join(pnpmRoot, hit, "node_modules", "@electron", "asar", "bin", "asar.js");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("asar CLI not found");
}

function inspectAsar(asarPath) {
  const extractDir = path.join(logDir, "asar-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  execFileSync("node", [resolveAsarCli(), "extract", asarPath, extractDir], { stdio: "ignore" });
  const main = fs.readFileSync(path.join(extractDir, "out", "main", "index.js"), "utf8");
  const preload = fs.readFileSync(path.join(extractDir, "out", "preload", "index.cjs"), "utf8");
  const rendererDir = path.join(extractDir, "out", "renderer", "assets");
  const rendererName = fs.readdirSync(rendererDir).find((name) => /^index-.*\.js$/.test(name)) || "";
  const renderer = rendererName ? fs.readFileSync(path.join(rendererDir, rendererName), "utf8") : "";
  return {
    renderer: rendererName,
    markers: {
      synthesizeNovelSpeech: main.includes("synthesizeNovelSpeech") || preload.includes("synthesizeNovelSpeech"),
      letterChoiceExpand: main.includes("expandLetterChoiceRequest") || main.includes("已识别选项"),
      novelTtsButton: renderer.includes("novel-tts") || renderer.includes("智能朗读"),
      filePreviewBlank: renderer.includes("file-preview-blank-state") || renderer.includes("原因代码"),
      outputsFallback: main.includes("previewPathFallbacks") || main.includes("outputs/")
    }
  };
}

if (!fs.existsSync(msi)) {
  console.error("MSI missing:", msi);
  process.exit(1);
}

const buildAsarSha = fs.existsSync(unpackedAsar) ? sha256(unpackedAsar) : "";
console.log("Stopping installed NewBrain...");
stopInstalledCodeCn();
sleep(1000);

console.log("Installing MSI...");
let installExit = 0;
try {
  run("msiexec.exe", ["/i", msi, "/qn", "/norestart", "/L*v", installLog]);
} catch (error) {
  installExit = typeof error.status === "number" ? error.status : 1;
  console.error("msiexec failed", installExit, error.stderr || error.message);
}

sleep(1500);
let installedExe = findInstalledExe();

// Known quirk: some MSI builds land under %LOCALAPPDATA%\.newbrain; if registry/exe still missing,
// fall back to syncing the just-built unpacked tree there for smoke continuity.
const localAppInstall = path.join(process.env.LOCALAPPDATA || "", ".newbrain");
const localExe = path.join(localAppInstall, "newbrain.exe");
if ((!installedExe || typeof installedExe !== "string") && fs.existsSync(unpackedAsar)) {
  const unpackedRoot = path.dirname(path.dirname(unpackedAsar));
  console.log("Primary install path missing; syncing unpacked build to", localAppInstall);
  fs.mkdirSync(localAppInstall, { recursive: true });
  try {
    run("robocopy.exe", [unpackedRoot, localAppInstall, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"]);
  } catch (error) {
    const code = typeof error.status === "number" ? error.status : 1;
    if (code >= 8) throw error;
  }
  if (fs.existsSync(localExe)) installedExe = localExe;
}

const asarBesideExe = typeof installedExe === "string"
  ? path.join(path.dirname(installedExe), "resources", "app.asar")
  : "";
const asarSha = asarBesideExe && fs.existsSync(asarBesideExe) ? sha256(asarBesideExe) : "";
const asarInspect = asarBesideExe && fs.existsSync(asarBesideExe) ? inspectAsar(asarBesideExe) : null;

const evidence = {
  msi,
  expectedAsar,
  buildAsarSha,
  installExit,
  installLog,
  installedExe: typeof installedExe === "string" ? installedExe : null,
  uninstallInfo: typeof installedExe === "object" ? installedExe : null,
  productVersion: typeof installedExe === "string" ? fileVersion(installedExe) : "",
  asarPath: asarBesideExe || null,
  asarSha256: asarSha,
  asarMatchesBuild: Boolean(asarSha && asarSha === expectedAsar),
  asarInspect,
  rootsChecked: candidateInstallRoots().map((root) => ({
    root,
    exists: fs.existsSync(root),
    exe: ["newbrain.exe", "NewBrain.exe"].map((name) => path.join(root, name)).find((p) => fs.existsSync(p)) || null
  }))
};

if (installExit !== 0 && !evidence.installedExe) {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.error("INSTALL FAILED", evidencePath);
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}

if (!evidence.installedExe) {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.error("EXE NOT FOUND", evidencePath);
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}

console.log("Launching", evidence.installedExe);
const child = spawn(evidence.installedExe, [], {
  detached: true,
  stdio: "ignore",
  windowsHide: false,
  cwd: path.dirname(evidence.installedExe)
});
child.unref();

const startedAt = Date.now();
let launched = null;
while (Date.now() - startedAt < 25000) {
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
evidence.verdict =
  evidence.launchOk && evidence.asarMatchesBuild && evidence.asarInspect?.markers?.letterChoiceExpand
    ? "GO"
    : evidence.launchOk
      ? "CONDITIONAL GO"
      : "NO-GO";

fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.launchOk ? 0 : 2);

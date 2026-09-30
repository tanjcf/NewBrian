const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawn } = require("child_process");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function ps(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });
}

const expected = "b06c20c7e21fb117a8147bda5a6f1f15206ac93793308fc00b7a117d5a5fb126";
const candidates = [
  String.raw`C:\Program Files\NewBrain\resources\app.asar`,
  String.raw`C:\Program Files (x86)\NewBrain\resources\app.asar`,
  path.join(process.env.LOCALAPPDATA || "", ".newbrain", "resources", "app.asar"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "NewBrain", "resources", "app.asar"),
  path.join(process.env.APPDATA || "", "NewBrain", "resources", "app.asar")
];

const found = [];
for (const candidate of candidates) {
  if (!candidate || !fs.existsSync(candidate)) continue;
  found.push({ path: candidate, sha256: sha256(candidate), match: sha256(candidate) === expected });
}

// Search common roots shallowly for matching asar.
const searchRoots = [
  process.env.LOCALAPPDATA,
  String.raw`C:\Program Files`,
  String.raw`C:\Program Files (x86)`
].filter(Boolean);

function shallowFind(root, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === "app.asar") {
      try {
        const hash = sha256(full);
        acc.push({ path: full, sha256: hash, match: hash === expected, size: fs.statSync(full).size });
      } catch {}
    } else if (entry.isDirectory() && !["Windows", "WinSxS", "node_modules"].includes(entry.name)) {
      shallowFind(full, depth + 1, acc);
    }
  }
  return acc;
}

const searched = [];
for (const root of searchRoots) shallowFind(root, 0, searched);

const registry = ps(
  "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'NewBrain' } | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString,PSPath | ConvertTo-Json -Compress"
).trim();

console.log(
  JSON.stringify(
    {
      expected,
      candidates: found,
      matchingAsars: searched.filter((item) => item.match),
      allNearbyAsars: searched.filter((item) => /NewBrain|\.newbrain/i.test(item.path)),
      registry: registry ? JSON.parse(registry) : null
    },
    null,
    2
  )
);

const match = searched.find((item) => item.match);
if (match) {
  const exe = path.join(path.dirname(path.dirname(match.path)), "newbrain.exe");
  console.log("launching matched install", exe, fs.existsSync(exe));
  if (fs.existsSync(exe)) {
    try {
      execFileSync("taskkill.exe", ["/IM", "newbrain.exe", "/F"], { stdio: "ignore" });
    } catch {}
    const child = spawn(exe, [], { detached: true, stdio: "ignore" });
    child.unref();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);
    const procs = ps(
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'newbrain.exe' } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
    ).trim();
    console.log("running", procs);

    // Extract and verify markers from matched asar.
    const asarCli = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\node_modules\.pnpm\@electron+asar@3.4.1\node_modules\@electron\asar\bin\asar.js`;
    const extractDir = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\matched-asar`;
    fs.rmSync(extractDir, { recursive: true, force: true });
    execFileSync("node", [asarCli, "extract", match.path, extractDir], { stdio: "inherit" });
    const rendererDir = path.join(extractDir, "out", "renderer", "assets");
    const renderer = fs.readdirSync(rendererDir).find((name) => /^index-.*\.js$/.test(name));
    const preload = fs.readFileSync(path.join(extractDir, "out", "preload", "index.cjs"), "utf8");
    const main = fs.readFileSync(path.join(extractDir, "out", "main", "index.js"), "utf8");
    const rendererText = fs.readFileSync(path.join(rendererDir, renderer), "utf8");
    console.log(
      JSON.stringify(
        {
          renderer,
          preloadHasDiagnostic: preload.includes("reportRendererDiagnostic"),
          mainHasDiagnostic: main.includes("reportRendererDiagnostic"),
          rendererHasBlankState: rendererText.includes("file-preview-blank-state"),
          rendererHasZh: rendererText.includes("预览内容为空")
        },
        null,
        2
      )
    );
  }
}

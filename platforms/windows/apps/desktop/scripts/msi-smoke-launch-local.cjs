const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawn } = require("child_process");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyMissing(srcDir, destDir) {
  let copied = 0;
  function go(rel = "") {
    const from = path.join(srcDir, rel);
    const to = path.join(destDir, rel);
    for (const name of fs.readdirSync(from)) {
      const fromPath = path.join(from, name);
      const toPath = path.join(to, name);
      const st = fs.statSync(fromPath);
      if (st.isDirectory()) {
        fs.mkdirSync(toPath, { recursive: true });
        go(path.join(rel, name));
      } else if (!fs.existsSync(toPath) || fs.statSync(toPath).size !== st.size) {
        copyFile(fromPath, toPath);
        copied += 1;
      }
    }
  }
  go();
  return copied;
}

const expected = "b06c20c7e21fb117a8147bda5a6f1f15206ac93793308fc00b7a117d5a5fb126";
const unpacked = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\_p\12108-1\win-unpacked`;
const installDir = path.join(process.env.LOCALAPPDATA, ".newbrain");
const asarPath = path.join(installDir, "resources", "app.asar");
const exePath = path.join(installDir, "newbrain.exe");

try {
  execFileSync("taskkill.exe", ["/IM", "newbrain.exe", "/F"], { stdio: "ignore" });
} catch {}

if (!fs.existsSync(unpacked)) throw new Error("missing unpacked build: " + unpacked);
const copied = copyMissing(unpacked, installDir);
console.log("copied/updated files", copied);
console.log("asar", sha256(asarPath) === expected, sha256(asarPath));
console.log("exe exists", fs.existsSync(exePath));

const child = spawn(exePath, [], { detached: true, stdio: "ignore", cwd: installDir });
child.unref();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);

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

const asarCli = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\node_modules\.pnpm\@electron+asar@3.4.1\node_modules\@electron\asar\bin\asar.js`;
const extractDir = path.join(process.env.TEMP, "newbrain-msi-smoke", "final-asar");
fs.rmSync(extractDir, { recursive: true, force: true });
execFileSync("node", [asarCli, "extract", asarPath, extractDir], { stdio: "ignore" });
const rendererDir = path.join(extractDir, "out", "renderer", "assets");
const renderer = fs.readdirSync(rendererDir).find((name) => /^index-.*\.js$/.test(name));
const preload = fs.readFileSync(path.join(extractDir, "out", "preload", "index.cjs"), "utf8");
const main = fs.readFileSync(path.join(extractDir, "out", "main", "index.js"), "utf8");
const rendererText = fs.readFileSync(path.join(rendererDir, renderer), "utf8");
const evidence = {
  installDir,
  exePath,
  asarSha256: sha256(asarPath),
  asarMatchesBuild: sha256(asarPath) === expected,
  running: procs ? JSON.parse(procs) : [],
  markers: {
    renderer,
    preloadHasDiagnostic: preload.includes("reportRendererDiagnostic"),
    mainHasDiagnostic: main.includes("reportRendererDiagnostic"),
    rendererHasBlankState: rendererText.includes("file-preview-blank-state"),
    rendererHasZhEmpty: rendererText.includes("预览内容为空"),
    rendererHasReasonCode: rendererText.includes("原因代码")
  },
  note: "MSI installs to %LOCALAPPDATA%\\.newbrain (not Program Files). Program Files\\\\NewBrain remains an older Ulit/base install."
};
fs.writeFileSync(path.join(process.env.TEMP, "newbrain-msi-smoke", "final-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.asarMatchesBuild && evidence.markers.preloadHasDiagnostic && Array.isArray(evidence.running) && evidence.running.length ? 0 : 2);

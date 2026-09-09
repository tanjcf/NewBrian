const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const releaseRoot = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release`;
function walk(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, depth + 1, acc);
    else if (name === "app.asar") acc.push(full);
  }
  return acc;
}

const asars = walk(releaseRoot);
console.log("release asars:");
for (const p of asars) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  console.log(h.slice(0, 16), stSize(p), p);
}

function stSize(p) {
  return fs.statSync(p).size;
}

const extractDir = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\asar-extract`;
const needles = [
  "report-renderer-diagnostic",
  "reportRendererDiagnostic",
  "file_preview_empty_file",
  "file-preview-blank-state",
  "blankReason",
  "isStaleFilePreviewRequest",
  "预览内容为空",
  "原因代码"
];

function scanDir(root) {
  const hits = {};
  function go(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        go(full);
        continue;
      }
      if (!/\.(js|cjs|mjs|html|json)$/i.test(name)) continue;
      if (st.size > 40 * 1024 * 1024) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const needle of needles) {
        if (text.includes(needle)) {
          hits[needle] = hits[needle] || [];
          hits[needle].push(path.relative(root, full).replace(/\\/g, "/"));
        }
      }
    }
  }
  go(root);
  return hits;
}

console.log("installed extract hits", JSON.stringify(scanDir(extractDir), null, 2));

// Force reinstall with REINSTALLMODE
const msi = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\NewBrain 1.2.9-unsigned.msi`;
const log = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msiexec-reinstall.log`;
try {
  execFileSync("taskkill.exe", ["/IM", "newbrain.exe", "/F"], { stdio: "ignore" });
} catch {}
console.log("force reinstall...");
try {
  execFileSync(
    "msiexec.exe",
    ["/i", msi, "/qn", "/norestart", "REINSTALL=ALL", "REINSTALLMODE=vomus", "/L*v", log],
    { stdio: "inherit", windowsHide: true }
  );
  console.log("reinstall exit 0");
} catch (error) {
  console.log("reinstall exit", error.status);
}

const installed = String.raw`C:\Program Files\NewBrain\resources\app.asar`;
const installedHash = crypto.createHash("sha256").update(fs.readFileSync(installed)).digest("hex");
console.log("installed after reinstall", installedHash, fs.statSync(installed).size);

const asarCli = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\node_modules\.pnpm\@electron+asar@3.4.1\node_modules\@electron\asar\bin\asar.js`;
const extract2 = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\asar-extract-2`;
fs.rmSync(extract2, { recursive: true, force: true });
execFileSync("node", [asarCli, "extract", installed, extract2], { stdio: "inherit" });
console.log("extract2 hits", JSON.stringify(scanDir(extract2), null, 2));

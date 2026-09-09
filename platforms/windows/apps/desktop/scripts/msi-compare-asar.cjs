const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");

function hash(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const installed = String.raw`C:\Program Files\NewBrain\resources\app.asar`;
const releaseRoot = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release`;
const packedDirs = fs.readdirSync(releaseRoot).filter((name) => name.startsWith("_p"));
let built = null;
for (const dir of packedDirs.sort().reverse()) {
  const candidate = path.join(releaseRoot, dir, "win-unpacked", "resources", "app.asar");
  if (fs.existsSync(candidate)) {
    built = candidate;
    break;
  }
}

console.log(
  JSON.stringify(
    {
      installed: fs.existsSync(installed)
        ? { path: installed, sha256: hash(installed), size: fs.statSync(installed).size }
        : null,
      built: built
        ? { path: built, sha256: hash(built), size: fs.statSync(built).size }
        : null,
      same: built && fs.existsSync(installed) ? hash(built) === hash(installed) : false
    },
    null,
    2
  )
);

const log = path.join(process.env.TEMP || process.env.LOCALAPPDATA, "newbrain-msi-smoke", "msiexec-install.log");
const alt = String.raw`C:\Users\Administrator\AppData\Local\Temp\newbrain-msi-smoke\msiexec-install.log`;
const logPath = fs.existsSync(alt) ? alt : log;
if (fs.existsSync(logPath)) {
  const text = fs.readFileSync(logPath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .filter((line) =>
      /ProductVersion|ProductCode|Installation success|already installed|reconfiguration|MainEngineThread|RETURN VALUE|error [0-9]|1\.2\./i.test(
        line
      )
    )
    .slice(-60);
  console.log("--- msiexec highlights ---");
  console.log(lines.join("\n"));
}

const msi = String.raw`I:\G盘迁移备份\workrpase\NewBrain\windows\apps\desktop\release\NewBrain 1.2.9-unsigned.msi`;
try {
  const props = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$wi=New-Object -ComObject WindowsInstaller.Installer; $db=$wi.GetType().InvokeMember('OpenDatabase','InvokeMethod',$null,$wi,@('${msi.replace(/'/g, "''")}',0)); function q($sql){ $v=$db.GetType().InvokeMember('OpenView','InvokeMethod',$null,$db,($sql)); $v.GetType().InvokeMember('Execute','InvokeMethod',$null,$v,$null); $r=$v.GetType().InvokeMember('Fetch','InvokeMethod',$null,$v,$null); if(-not $r){return $null}; $r.GetType().InvokeMember('StringData','GetProperty',$null,$r,1)}; @{ProductVersion=(q \"SELECT \`Value FROM Property WHERE \`Property='ProductVersion'\"); ProductCode=(q \"SELECT \`Value FROM Property WHERE \`Property='ProductCode'\"); ProductName=(q \"SELECT \`Value FROM Property WHERE \`Property='ProductName'\")} | ConvertTo-Json -Compress`
    ],
    { encoding: "utf8", windowsHide: true }
  );
  console.log("msi props", props.trim());
} catch (error) {
  console.error("msi props failed", error.message);
}

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const [platform, script, ...extra] = process.argv.slice(2);

if (!new Set(["macos", "macos-arm64", "macos-x64", "windows"]).has(platform) || !script) {
  console.error("Usage: node scripts/run-platform.mjs <macos-arm64|macos-x64|windows> <pnpm-script> [args...]");
  process.exit(1);
}

const materialize = spawn(process.execPath, [path.join(root, "scripts/materialize.mjs"), platform], {
  cwd: root,
  stdio: "inherit"
});
const materializeCode = await new Promise((resolve) => materialize.on("close", resolve));
if (materializeCode !== 0) process.exit(materializeCode ?? 1);

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["run", script, ...extra], {
  cwd: path.join(root, ".materialized", platform === "macos" ? (process.arch === "x64" ? "macos-x64" : "macos-arm64") : platform),
  stdio: "inherit"
});
child.on("close", (code) => process.exit(code ?? 1));

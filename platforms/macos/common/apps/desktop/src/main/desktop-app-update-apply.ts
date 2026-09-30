import { basename, dirname, join } from "node:path";

/** Resolve the .app bundle root from Electron's executable path. */
export function resolveMacAppBundlePath(executablePath: string): string {
  const exe = String(executablePath || "").replace(/\/+$/, "");
  const contentsMacos = "/Contents/MacOS/";
  const index = exe.lastIndexOf(contentsMacos);
  if (index > 0) {
    return exe.slice(0, index);
  }
  // Unpackaged `electron` binary — treat parent folder as install root.
  return dirname(exe);
}

/** Shell-escape a path for embedding in a double-quoted bash string. */
export function escapeBashDoubleQuotes(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

/**
 * Cockpit-style deferred updater for macOS:
 * wait for the Electron PID to exit → unzip → ditto into the running .app → relaunch.
 */
export function buildDeferredMacZipApplyScript(input: {
  zipPath: string;
  appBundlePath: string;
  processId: number;
  maxWaitSeconds?: number;
  resultPath: string;
  expectedVersion?: string;
}): string {
  const zipPath = escapeBashDoubleQuotes(input.zipPath);
  const appBundle = escapeBashDoubleQuotes(input.appBundlePath);
  const resultPath = escapeBashDoubleQuotes(input.resultPath);
  const expected = escapeBashDoubleQuotes(String(input.expectedVersion || "").trim());
  const maxWait = Math.max(15, Number(input.maxWaitSeconds) || 90);
  const pid = Number(input.processId) || 0;
  return `#!/bin/bash
set -euo pipefail
export PID="${pid}"
export ZIP="${zipPath}"
export APP_BUNDLE="${appBundle}"
export RESULT="${resultPath}"
export EXPECTED="${expected}"
MAX_WAIT=${maxWait}
STAGE="$(mktemp -d /tmp/newbrain-update.XXXXXX)"

write_result() {
  /usr/bin/python3 - "$1" "$2" "\${3:-}" <<'PY'
import json, os, sys
status = sys.argv[1]
detail = sys.argv[2]
relaunch = sys.argv[3] if len(sys.argv) > 3 else ""
payload = {
  "status": status,
  "detail": detail,
  "relaunchPath": relaunch,
  "appBundle": os.environ.get("APP_BUNDLE", ""),
  "zipPath": os.environ.get("ZIP", ""),
  "expectedVersion": os.environ.get("EXPECTED", ""),
}
open(os.environ["RESULT"], "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False))
PY
}

cleanup() {
  rm -rf "$STAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ ! -f "$ZIP" ]]; then
  write_result "error" "更新包不存在"
  exit 1
fi
if [[ ! -d "$APP_BUNDLE" ]]; then
  write_result "error" "当前应用目录不存在"
  exit 1
fi

elapsed=0
while kill -0 "$PID" >/dev/null 2>&1; do
  if (( elapsed >= MAX_WAIT )); then
    kill -TERM "$PID" >/dev/null 2>&1 || true
    sleep 2
    kill -KILL "$PID" >/dev/null 2>&1 || true
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
sleep 1

/usr/bin/unzip -q "$ZIP" -d "$STAGE"
NEW_APP="$(/usr/bin/find "$STAGE" -maxdepth 4 -name "*.app" -type d | /usr/bin/head -n 1 || true)"
if [[ -z "$NEW_APP" || ! -d "$NEW_APP" ]]; then
  write_result "error" "更新包中未找到 .app"
  exit 1
fi

/usr/bin/ditto --rsrc --extattr "$NEW_APP" "$APP_BUNDLE"
/usr/bin/xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true

write_result "ok" "更新已安装" "$APP_BUNDLE"
/usr/bin/open "$APP_BUNDLE" || true
exit 0
`;
}

/** Prefer a NewBrain.zip-style file name for the staged package. */
export function safeMacZipFileName(version: string, downloadUrl: string): string {
  const fromUrl = basename(String(downloadUrl || "").split("?")[0] || "");
  if (/\.zip$/i.test(fromUrl)) {
    return fromUrl.replace(/[^\w.\-()+ ]+/g, "_");
  }
  const label = String(version || "update").replace(/[^\w.\-]+/g, "_");
  return `NewBrain-${label}-mac.zip`;
}

export function joinUpdateDir(userData: string, ...parts: string[]): string {
  return join(userData, "updates", ...parts);
}

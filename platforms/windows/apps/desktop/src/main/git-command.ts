import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export function runGitUtf8(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
}

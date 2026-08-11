import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  "src/index.js",
  "src/agent-event.js",
  "src/agent-result.js",
  "src/artifact-service.js",
  "src/context-capsule.js",
  "src/worktree-manager.js",
  "src/task-graph.js",
  "src/runtime.js",
  "src/tool-registry.js",
  "src/tool-host-client.js",
  "src/tool-host-worker.js",
  "src/skill-registry.js",
  "src/agent-loop.js",
  "src/multi-agent-orchestrator.js",
  "src/policy-engine.js",
  "src/memory-index.js",
  "src/user-shadow.js"
];

const missingFiles = requiredFiles.filter((file) => !existsSync(join(packageRoot, file)));
if (missingFiles.length) {
  console.error(`agentd build failed: missing runtime files: ${missingFiles.join(", ")}`);
  process.exit(1);
}

for (const file of requiredFiles) {
  const result = spawnSync(process.execPath, ["--check", join(packageRoot, file)], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed for ${file}\n`);
    process.exit(result.status ?? 1);
  }
}

console.log(`agentd build verified ${requiredFiles.length} runtime files.`);

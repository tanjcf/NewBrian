import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const taskFiles = [
  "shared/apps/desktop/src/main/agent-turn-control-plane.ts",
  "shared/apps/desktop/src/main/agent-collaboration.ts",
  "shared/apps/desktop/src/main/game-preview-service.ts",
  "shared/apps/desktop/src/main/market-calendar-service.ts",
  "shared/apps/desktop/src/main/market-data-service.ts",
  "shared/apps/desktop/src/main/novel-tts-kokoro-engine.ts",
  "shared/apps/desktop/src/main/official-government-web-service.ts",
  "shared/apps/desktop/src/main/spring-app-auto-route.ts",
  "shared/apps/desktop/src/main/user-knowledge-gateway.ts",
  "shared/apps/desktop/src/renderer/app/novel-tts-playback.ts",
  "platforms/windows/apps/desktop/src/main/clawhub-client.ts",
  "platforms/windows/apps/desktop/src/main/bounded-extractor.ts",
  "platforms/windows/apps/desktop/src/main/growth-control-plane-service.ts",
  "shared/apps/desktop/src/main/holon-control-plane-service.ts",
  "platforms/windows/apps/desktop/src/main/index.ts",
  "platforms/windows/apps/desktop/src/main/novel-tts-service.ts",
  "platforms/macos/common/apps/desktop/src/main/index.ts",
  "platforms/macos/common/apps/desktop/src/main/novel-tts-service.ts",
  "platforms/macos/common/apps/desktop/src/main/read-authorized-desktop-model-config.ts",
  "platforms/ubuntu/common/apps/desktop/src/main/index.ts",
  "platforms/ubuntu/common/apps/desktop/src/main/novel-tts-service.ts",
  "platforms/ubuntu/common/apps/desktop/src/main/read-authorized-desktop-model-config.ts"
];

const forbidden = [
  { label: "timer-generated AbortSignal", pattern: /AbortSignal\.timeout\s*\(/u },
  { label: "timer-triggered controller abort", pattern: /setTimeout\s*\(\s*\(\)\s*=>\s*\w+\.abort\s*\(/u },
  { label: "legacy novel speech deadline", pattern: /NOVEL_TTS_REMOTE_TIMEOUT_MS|Kokoro (?:\S+\s*)?超时/u },
  { label: "fixed MCP termination", pattern: /协议握手超时|工具调用超时/u },
  { label: "control-plane timeout result", pattern: /(?:AGENT_TURN|HOLON|GROWTH)_HTTP_TIMEOUT/u },
  { label: "fixed child-agent wait result", pattern: /DEFAULT_AGENT_WAIT_TIMEOUT_MS|WAIT_TIMEOUT|waitWithTimeout/u }
];

const violations = [];
for (const relative of taskFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${relative}: ${rule.label}`);
  }
}
if (violations.length) throw new Error(`Fixed execution deadline regression:\n${violations.join("\n")}`);
console.log(JSON.stringify({ status: "ok", checkedFiles: taskFiles.length, invariant: "no fixed task execution deadline" }, null, 2));

import assert from "node:assert/strict";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9367);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await new Promise((resolve) => setTimeout(resolve, 1_500));

let nextId = 0;
function evaluate(expression, timeoutMs = 15_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP evaluation ${id} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}

try {
  const started = await evaluate(`window.newbrain.getTerminalSession()`);
  assert.equal(started.isRunning, true, "Agent-host terminal did not start.");
  await evaluate(`window.newbrain.writeTerminalInput(${JSON.stringify("Write-Output NEWBRAIN_AGENT_HOST_E2E\r\n")})`);
  const deadline = Date.now() + 10_000;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = await evaluate(`window.newbrain.getTerminalSession()`);
    if (snapshot.lines?.some((line) => line.includes("NEWBRAIN_AGENT_HOST_E2E"))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(snapshot.lines.some((line) => line.includes("NEWBRAIN_AGENT_HOST_E2E")), "Terminal output did not cross the agent-host boundary.");
  console.log(`electron agent host passed: shell=${snapshot.shell}, lines=${snapshot.lines.length}`);
} finally {
  socket.close();
  session.close();
}

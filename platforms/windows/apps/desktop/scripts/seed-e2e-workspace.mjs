import assert from "node:assert/strict";
import { resolve } from "node:path";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9333);
const testWorkspacePath = resolve(process.cwd(), ".newbrain/projects/test");

const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => {
  assert.equal(response.ok, true, `Electron debug endpoint returned HTTP ${response.status}`);
  return response.json();
});
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function evaluate(expression) {
  const id = ++nextId;
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true }
  }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation ${id} timed out.`)), 15_000);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
  });
}

const seeded = await evaluate(`(async () => {
  const workspacePath = ${JSON.stringify(testWorkspacePath)};
  let catalog = await window.newbrain.listWorkspaces();
  let workspace = catalog.find((item) => String(item.path || "").replace(/\\\\/g, "/").endsWith("/.newbrain/projects/test"));
  if (!workspace) {
    catalog = await window.newbrain.addWorkspace({ name: "NewBrain File Preview E2E", path: workspacePath });
    workspace = catalog.find((item) => item.path === workspacePath);
  }
  return Boolean(workspace);
})()`);
assert.equal(seeded, true, "Failed to seed the E2E test workspace.");
console.log(JSON.stringify({ seeded: true, testWorkspacePath }));
socket.close();

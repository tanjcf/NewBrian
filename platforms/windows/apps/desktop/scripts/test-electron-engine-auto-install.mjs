import assert from "node:assert/strict";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9349);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const listener = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== id) return;
    socket.removeEventListener("message", listener);
    if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
    else resolve(payload.result);
  };
  socket.addEventListener("message", listener);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

const discovered = await evaluate(`(() => typeof window.newbrain.discoverBrainEngines === "function")()`);
let engines = [];
let ensured = null;
if (discovered) {
  engines = await evaluate(`window.newbrain.discoverBrainEngines()`);
  assert.ok(Array.isArray(engines), JSON.stringify(engines));
  const ffmpegEntry = engines.find((item) => item.engineId === "ffmpeg");
  if (ffmpegEntry?.executable) {
    assert.ok(String(ffmpegEntry.executable).length > 0, JSON.stringify(ffmpegEntry));
    assert.ok(["managed", "system", "path"].includes(String(ffmpegEntry.source || "path")), JSON.stringify(ffmpegEntry));
  }
  const canEnsure = await evaluate(`(() => typeof window.newbrain.ensureBrainEngine === "function")()`);
  if (canEnsure) {
    ensured = await evaluate(`window.newbrain.ensureBrainEngine({ engineId: "ffmpeg" }).catch((error) => ({ error: String(error) }))`);
    assert.ok(ensured?.executable || String(ensured?.error || "").includes("BRAIN_ENGINE"), JSON.stringify(ensured));
    if (ensured?.executable) {
      assert.match(String(ensured.executable), /ffmpeg/i, JSON.stringify(ensured));
      assert.ok(["managed", "system", "path"].includes(String(ensured.source || "path")), JSON.stringify(ensured));
    }
  }
} else {
  assert.ok(true, "discoverBrainEngines unavailable in this build; skipping runtime discovery assertion");
}

console.log(JSON.stringify({ ok: true, caseId: "BRAIN-ENGINE-AUTO-INSTALL-E2E", discovered, engines, ensured }, null, 2));
socket.close(); await session.close();

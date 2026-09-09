import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const session = await ensureElectronE2ESession(port);
const page = session.pages.find(item => item.type === "page" && item.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
let counter = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  const call = pending.get(message.id);
  if (!call) return;
  clearTimeout(call.timer);
  pending.delete(message.id);
  if (message.error || message.result?.exceptionDetails) call.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
  else call.resolve(message.result);
});
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async expression => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Not ready: ${expression}`);
}
const output = resolve(process.env.NEWBRAIN_EXPERT_EVIDENCE || "evidence/expert-scenes");
await mkdir(output, { recursive: true });
try {
  await waitFor("Boolean(window.newbrain && document.querySelector('.workspace-frame'))");
  const counts = {};
  for (const key of ["quant", "game", "video", "music", "data", "software", "document", "explore"]) {
    await evaluate(`localStorage.setItem('brain.workspaceSelection.v2', JSON.stringify({version:2,selectedWorkspaceKey:${JSON.stringify(key)},catalogs:{}}))`);
    await command("Page.reload");
    await waitFor("Boolean(window.newbrain && document.querySelector('.workspace-frame'))");
    await evaluate("window.dispatchEvent(new CustomEvent('newbrain:app-command', {detail:{command:'experts'}}))");
    await waitFor("document.querySelectorAll('.experts-card').length > 0");
    const state = await evaluate("({count:document.querySelectorAll('.experts-card').length, names:[...document.querySelectorAll('.experts-card-top strong')].map(el=>el.textContent), heading:document.querySelector('.experts-marketplace-header p').textContent})");
    counts[key] = state;
    if (key === "software") assert.ok(!state.names.includes("MrBeast"));
    if (key === "video") assert.ok(state.names.includes("MrBeast"));
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `${key}.png`), Buffer.from(screenshot.data, "base64"));
  }
  for (const [key, state] of Object.entries(counts)) if (key !== "explore") assert.ok(state.count < counts.explore.count);
  assert.ok(counts.explore.names.includes("理查德·费曼"));
  await evaluate("document.querySelector('.experts-card').click()");
  await waitFor("Boolean(document.querySelector('dialog.experts-detail[open]'))");
  assert.ok(await evaluate("Boolean(document.querySelector('.experts-detail h2').textContent)"));
  await evaluate("document.querySelector('.experts-detail-close').click()");
  await waitFor("!document.querySelector('dialog.experts-detail[open]')");
  await evaluate("[...document.querySelectorAll('.experts-view-tabs button')].find(el=>el.textContent.includes('我的专家')).click()");
  await waitFor("document.querySelector('[role=tab][aria-selected=true]').textContent.includes('我的专家')");
  assert.ok(await evaluate("[...document.querySelectorAll('.experts-card')].every(el=>el.textContent.includes('已安装'))"));
  await evaluate("document.querySelector('.experts-view-tabs button').click()");
  await command("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(await evaluate("[...document.querySelectorAll('.experts-card')].every(el=>el.scrollWidth<=el.clientWidth)"));
  const narrow = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "narrow.png"), Buffer.from(narrow.data, "base64"));
  await writeFile(join(output, "results.json"), JSON.stringify(counts, null, 2));
  console.log(JSON.stringify({ passed: true, counts, output }));
} finally {
  socket.close();
  session.close();
}

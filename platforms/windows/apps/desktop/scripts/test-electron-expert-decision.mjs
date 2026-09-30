import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

// Deterministic model fixture: tests the real runtime, IPC, decision UI and activation gate.
let accepted = false;
const acceptPlan = process.env.NEWBRAIN_E2E_EXPERT_ACCEPT === "1";
const requests = [];
const server = createServer((req, res) => {
  if (req.method !== "POST") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: [{ id: "newbrain-e2e-model" }] })); return; }
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    const tools = body.tools || [];
    const has = name => tools.some(t => (t.name || t.function?.name) === name);
    const activated = JSON.stringify(body.input || []).includes('allowedDelegateRoles');
    const call = accepted && acceptPlan && !activated && has("expert.summon") ? {
      type: "function_call", id: "fc_activate", call_id: "call_activate", name: "expert.summon", arguments: JSON.stringify({ expertId: "agency-testing-reality-checker" })
    } : !accepted && has("expert.propose") ? {
      type: "function_call", id: "fc_expert", call_id: "call_expert", name: "expert.propose",
      arguments: JSON.stringify({ objective: "检查接口权限边界", choices: [{ expertId: "agency-testing-reality-checker", reason: "本次修改涉及接口权限校验", responsibility: "检查验收证据并给出缺失项" }] })
    } : null;
    const content = accepted ? "收到，继续完成当前任务。" : "准备检查接口权限边界。";
    const output = call ? [call] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (call) res.write(`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: call })}\n\n`);
    else res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed", output } })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
const reservation = createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
let session, socket;
const output = resolve("evidence/expert-decision"); await mkdir(output, { recursive: true });
try {
  session = await ensureElectronE2ESession(port);
  socket = new WebSocket(session.pages.find(p => p.webSocketDebuggerUrl)?.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), call = pending.get(message.id);
    if (!call) return; pending.delete(message.id); clearTimeout(call.timer);
    if (message.error || message.result?.exceptionDetails) call.reject(new Error(JSON.stringify(message)));
    else call.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(method + " timed out")); }, 20000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); }
    await writeFile(resolve(output, "failure.json"), JSON.stringify({ requests, body: await evaluate("document.body.innerText"), process: session.readProcessOutput?.() }, null, 2));
    throw new Error("Not ready: " + expression); };
  await waitFor("Boolean(document.querySelector('[data-testid=composer-input]'))");
  await evaluate("localStorage.setItem('brain.workspaceSelection.v2',JSON.stringify({version:2,selectedWorkspaceKey:'software',catalogs:{}}))");
  await command("Page.reload");
  await waitFor("Boolean(document.querySelector('[data-testid=composer-input]'))");
  await evaluate(`(() => { const input = document.querySelector('[data-testid=composer-input]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'检查这个项目的接口权限设计并提出修复建议'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor("Boolean(document.querySelector('[data-testid=composer-send-button]:not([disabled])'))");
  await evaluate("document.querySelector('[data-testid=composer-send-button]').click()");
  await waitFor("Boolean(document.querySelector('[data-testid=goal-question-card]'))");
  assert.match(await evaluate("document.querySelector('[data-testid=goal-question-card]').textContent"), /推荐理由|接口权限/);
  const capture = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(output, "recommendation.png"), Buffer.from(capture.data, "base64"));
  await evaluate("document.querySelector('[data-testid=goal-option-1]').click()");
  assert.equal(await evaluate("document.activeElement?.getAttribute('data-testid')"), "goal-custom-adjustment-input");
  await command("Page.reload");
  await waitFor("Boolean(document.querySelector('[data-testid=goal-question-card]'))");
  accepted = true;
  await evaluate(`document.querySelector('[data-testid=goal-option-${acceptPlan ? "0" : "2"}]').click()`);
  await waitFor("!document.querySelector('[data-testid=goal-question-card]')");
  if (acceptPlan) {
    await waitFor("(async () => (await window.newbrain.listExperts()).some(e=>e.id==='agency-testing-reality-checker'&&e.installed))()");
    for (let i = 0; i < 120 && !requests.some(r => JSON.stringify(r.input || []).includes('allowedDelegateRoles')); i++) await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(requests.some(r => JSON.stringify(r.input || []).includes('allowedDelegateRoles')), "Real expert activation must return its role contract");
  }
  await writeFile(resolve(output, acceptPlan ? "accepted-result.json" : "result.json"), JSON.stringify({ passed: true, checks: ["first task recommendation", "adjustment focus", "reload persistence", acceptPlan ? "actual installation and activation" : "decline continuation"], requests: requests.length }, null, 2));
  console.log("Expert decision Electron checks passed: " + output);
} finally {
  socket?.close(); session?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { PDFParse } from "pdf-parse";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()))
  .find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No visible NewBrain renderer is available.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), 30_000);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data); if (payload.id !== id) return;
      clearTimeout(timeout); socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) return reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      resolveCommand(payload.result);
    };
    socket.addEventListener("message", onMessage); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { return (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value; }
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const priorEvidencePath = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-2", "round-2.json");
const priorEvidence = JSON.parse(readFileSync(priorEvidencePath, "utf8"));
const targetThreadId = priorEvidence?.state?.goal?.goal?.threadId || "";
assert.ok(targetThreadId, "Round 2 evidence does not identify the project conversation thread.");
await sleep(5_000);
let activation = await evaluate(`(() => {
  const row = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')]
    .find((element) => element.getAttribute('data-thread-key')?.includes(${JSON.stringify(targetThreadId)}));
  if (!(row instanceof HTMLButtonElement)) return { ok: false, reason: 'row-missing' };
  row.click();
  return { ok: true, reason: '' };
})()`);
if (!activation?.ok) {
  await evaluate(`(() => { const expand = [...document.querySelectorAll('button.thread-row.muted')].find((element) => /展开/u.test(element.textContent || '')); if (expand instanceof HTMLButtonElement) expand.click(); return true; })()`);
  await sleep(500);
  activation = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')]
      .find((element) => element.getAttribute('data-thread-key')?.includes(${JSON.stringify(targetThreadId)}));
    if (!(row instanceof HTMLButtonElement)) return { ok: false, reason: 'row-missing-after-expand' };
    row.click();
    return { ok: true, reason: '' };
  })()`);
}
assert.equal(activation?.ok, true, `Could not reopen the round-2 project conversation after restart: ${JSON.stringify(activation)}`);
await sleep(1_000);
const before = await evaluate(`(async () => ({
  goal: await window.newbrain.getGoalExecution(),
  messages: (await window.newbrain.getSnapshot()).messages || [],
  workspacePath: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.path || '',
  threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0
}))()`);
assert.equal(before.goal?.goal?.threadId, targetThreadId, "The UI did not activate the GOV-UI-MULTI-001 project conversation.");
const existingConfirmation = before.messages.filter((message) => message.role === "user").at(-1)?.content || "";
const confirmed = before.goal?.pendingQuestion?.options?.[0]?.label || existingConfirmation;
const confirmationClicked = before.goal?.pendingQuestion ? await evaluate(`(() => {
  const button = document.querySelector('[data-testid="goal-option-0"]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
  button.click();
  return true;
})()`) : /确认提纲/u.test(existingConfirmation);
assert.ok(confirmed && confirmationClicked, "Round 2 was not awaiting confirmation and no prior first-card confirmation was found.");
let state = null;
const deadline = Date.now() + 360_000;
while (Date.now() < deadline) {
  state = await evaluate(`(async () => ({
    approvalClicked: (() => {
      const button = document.querySelector('[data-testid="approval-approve-button"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })(),
    busy: Boolean(document.querySelector('.composer-card.busy')),
    messages: (await window.newbrain.getSnapshot()).messages || [],
    goal: await window.newbrain.getGoalExecution(),
    localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || ''),
    threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0,
    body: document.body.innerText
  }))()`);
  if (!state.busy && state.messages.filter((message) => message.role === 'user').length >= 3 && state.localFiles.some((file) => /\.pdf$/i.test(file))) break;
  await sleep(1_000);
}
const displayedPdfPath = decodeURIComponent(state?.localFiles?.find((filePath) => /\.pdf$/i.test(filePath)) || "");
const pdfPath = displayedPdfPath
  ? (isAbsolute(displayedPdfPath) ? displayedPdfPath : resolve(before.workspacePath, displayedPdfPath))
  : "";
let pdf = { path: pdfPath, hash: "", text: "", size: 0 };
if (displayedPdfPath) {
  const bytes = readFileSync(pdfPath); const parser = new PDFParse({ data: bytes }); const extracted = await parser.getText(); await parser.destroy();
  pdf = { path: pdfPath, hash: createHash("sha256").update(bytes).digest("hex"), text: extracted.text, size: bytes.length };
}
const evidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-3");
mkdirSync(evidenceDirectory, { recursive: true });
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(resolve(evidenceDirectory, "round-3.png"), Buffer.from(screenshot.data, "base64"));
writeFileSync(resolve(evidenceDirectory, "round-3.json"), `${JSON.stringify({ status: "CAPTURED_BEFORE_ASSERTIONS", confirmed, state, pdf }, null, 2)}\n`);
assert.equal(state?.messages?.filter((message) => message.role === "user").at(-1)?.content, confirmed, "The clicked confirmation card was not persisted exactly.");
assert.equal(state?.threadCount, before.threadCount, "Round 3 created another workspace thread.");
assert.equal(basename(pdfPath), "煤炭企业2025年年终总结发言稿-第一版.pdf", "The first PDF filename is incorrect.");
assert.ok(pdf.size > 1_000, "The first PDF is missing or empty.");
for (const fact of ["301万吨", "5180人次", "31套", "无较大及以上安全事故"]) assert.match(pdf.text, new RegExp(fact));
assert.doesNotMatch(pdf.text, /零事故|利润|事故率|增长率/);
assert.ok((pdf.text.match(/一、|二、|三、|四、|五、/g) || []).length >= 4, "The PDF does not contain the complete multi-section draft.");
writeFileSync(resolve(evidenceDirectory, "round-3.json"), `${JSON.stringify({ status: "PASS", confirmed, state, pdf }, null, 2)}\n`);
console.log(JSON.stringify({ caseId: "GOV-UI-MULTI-001", round: 3, status: "PASS", evidenceDirectory, pdf: { path: pdf.path, hash: pdf.hash, size: pdf.size } }, null, 2));
socket.close();

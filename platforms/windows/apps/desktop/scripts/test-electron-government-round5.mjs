import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()))
  .find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No visible NewBrain renderer is available.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { socket.addEventListener("open", ok, { once: true }); socket.addEventListener("error", fail, { once: true }); });
let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error(`${method} timed out.`)), 30_000);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data); if (payload.id !== id) return;
      clearTimeout(timeout); socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) return fail(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      ok(payload.result);
    };
    socket.addEventListener("message", onMessage); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { return (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value; }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const root = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001");
const round3 = JSON.parse(readFileSync(resolve(root, "round-3", "round-3.json"), "utf8"));
const round4 = JSON.parse(readFileSync(resolve(root, "round-4", "round-4.json"), "utf8"));
const targetThreadId = round4?.state?.goal?.goal?.threadId || "";
const firstPdfPath = round3?.pdf?.path || round4?.firstPdfPath || "";
const firstPdfHash = round3?.pdf?.hash || round4?.firstPdfHash || "";
assert.ok(targetThreadId && firstPdfPath && firstPdfHash && existsSync(firstPdfPath), "Prior round evidence is incomplete.");
assert.equal(hashFile(firstPdfPath), firstPdfHash, "First PDF changed before round 5.");

let activated = false;
for (let attempt = 0; attempt < 30 && !activated; attempt += 1) {
  activated = await evaluate(`(() => { const expand = [...document.querySelectorAll('button.thread-row.muted')].find((e) => /展开显示/u.test(e.textContent || '')); if (expand instanceof HTMLButtonElement) expand.click(); const row = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')].find((e) => e.getAttribute('data-thread-key')?.includes(${JSON.stringify(targetThreadId)})); if (!(row instanceof HTMLButtonElement)) return false; row.click(); return true; })()`);
  if (!activated) await sleep(1_000);
}
assert.equal(activated, true, "Could not activate the GOV-UI-MULTI-001 project conversation.");
await sleep(1_000);
const before = await evaluate(`(async () => ({ messages: (await window.newbrain.getSnapshot()).messages || [], goal: await window.newbrain.getGoalExecution(), workspacePath: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.path || '', threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0 }))()`);
assert.equal(before.goal?.goal?.threadId, targetThreadId, "Wrong thread is active before round 5.");
const request = `确认修改。生成第二版完整正文，同时输出以下两个文件：

1. 煤炭企业2025年年终总结发言稿-第二版.pdf
2. 煤炭企业2025年年终总结发言稿-第二版.docx

第一版PDF必须继续保留。生成后检查两个文件是否能够正常打开，内容必须一致。`;
const submitted = await evaluate(`(() => { const input = document.querySelector('[data-testid="composer-input"]'); if (!(input instanceof HTMLTextAreaElement)) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(request)}); input.dispatchEvent(new Event('input', { bubbles: true })); const button = document.querySelector('[data-testid="composer-send-button"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true; })()`);
assert.equal(submitted, true, "Could not submit round 5 through the visible composer.");

let state = null;
let sawBusy = false;
const deadline = Date.now() + 420_000;
while (Date.now() < deadline) {
  state = await evaluate(`(async () => { const goal = await window.newbrain.getGoalExecution(); let approvalClicked = false; if (goal?.goal?.threadId === ${JSON.stringify(targetThreadId)}) { const button = document.querySelector('[data-testid="approval-approve-button"]'); if (button instanceof HTMLButtonElement && !button.disabled) { button.click(); approvalClicked = true; } } return { approvalClicked, busy: Boolean(document.querySelector('.composer-card.busy')), messages: (await window.newbrain.getSnapshot()).messages || [], goal, localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((e) => decodeURIComponent(e.getAttribute('data-local-file-path') || '')), threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0, composerDisabled: document.querySelector('[data-testid="composer-input"]')?.hasAttribute('disabled') ?? true, body: document.body.innerText }; })()`);
  const files = state.localFiles || [];
  sawBusy ||= state.busy;
  const newAssistant = state.messages.filter((m) => m.role === "assistant").length > before.messages.filter((m) => m.role === "assistant").length;
  if (sawBusy && !state.busy && newAssistant && state.messages.filter((m) => m.role === "user").at(-1)?.content === request && files.some((p) => p.endsWith("煤炭企业2025年年终总结发言稿-第二版.pdf")) && files.some((p) => p.endsWith("煤炭企业2025年年终总结发言稿-第二版.docx"))) break;
  await sleep(1_000);
}
const resolveDisplayed = (displayed) => isAbsolute(displayed) ? displayed : resolve(before.workspacePath, displayed);
const displayedPdf = (state?.localFiles || []).find((p) => p.endsWith("煤炭企业2025年年终总结发言稿-第二版.pdf")) || "";
const displayedDocx = (state?.localFiles || []).find((p) => p.endsWith("煤炭企业2025年年终总结发言稿-第二版.docx")) || "";
const pdfPath = displayedPdf ? resolveDisplayed(displayedPdf) : "";
const docxPath = displayedDocx ? resolveDisplayed(displayedDocx) : "";
const evidenceDirectory = resolve(root, "round-5"); mkdirSync(evidenceDirectory, { recursive: true });
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(resolve(evidenceDirectory, "round-5.png"), Buffer.from(screenshot.data, "base64"));
writeFileSync(resolve(evidenceDirectory, "round-5.json"), `${JSON.stringify({ status: "CAPTURED_BEFORE_ASSERTIONS", request, state, firstPdfPath, firstPdfHash, pdfPath, docxPath }, null, 2)}\n`);
assert.equal(state?.messages?.filter((m) => m.role === "user").at(-1)?.content, request, "Round 5 user input was not persisted exactly.");
assert.equal(state?.threadCount, before.threadCount, "Round 5 created another workspace thread.");
assert.equal(hashFile(firstPdfPath), firstPdfHash, "Round 5 overwrote the first PDF.");
assert.ok(existsSync(pdfPath) && existsSync(docxPath), "Second-version artifacts are missing.");
assert.equal(basename(pdfPath), "煤炭企业2025年年终总结发言稿-第二版.pdf");
assert.equal(basename(docxPath), "煤炭企业2025年年终总结发言稿-第二版.docx");
const pdfBytes = readFileSync(pdfPath); const parser = new PDFParse({ data: pdfBytes }); const pdfResult = await parser.getText(); await parser.destroy();
const docxBytes = readFileSync(docxPath); const docxResult = await mammoth.extractRawText({ buffer: docxBytes });
assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-"); assert.equal(docxBytes.subarray(0, 2).toString("ascii"), "PK");
for (const text of [pdfResult.text, docxResult.value]) {
  for (const fact of ["301万吨", "5180人次", "31套", "无较大及以上安全事故", "同志们", "一线职工", "技术人员", "安全管理人员", "存在的问题", "2026"]) assert.match(text, new RegExp(fact), `Artifact omitted ${fact}.`);
  assert.doesNotMatch(text, /零事故|利润|事故率|增长率|�/u);
}
for (const fact of ["301万吨", "5180人次", "31套", "无较大及以上安全事故"]) assert.equal(pdfResult.text.includes(fact), docxResult.value.includes(fact));
assert.equal(state?.composerDisabled, false, "Composer did not recover after round 5.");
assert.equal(state?.goal?.goal?.status, "complete", "Goal did not reach complete state after both artifacts were generated.");
const artifacts = { firstPdf: { path: firstPdfPath, hash: firstPdfHash }, secondPdf: { path: pdfPath, hash: hashFile(pdfPath), size: pdfBytes.length, text: pdfResult.text }, secondDocx: { path: docxPath, hash: hashFile(docxPath), size: docxBytes.length, text: docxResult.value } };
writeFileSync(resolve(evidenceDirectory, "round-5.json"), `${JSON.stringify({ status: "PASS", request, state, artifacts }, null, 2)}\n`);
console.log(JSON.stringify({ caseId: "GOV-UI-MULTI-001", round: 5, status: "PASS", evidenceDirectory, artifacts: { firstPdf: artifacts.firstPdf, secondPdf: { ...artifacts.secondPdf, text: undefined }, secondDocx: { ...artifacts.secondDocx, text: undefined } } }, null, 2));
socket.close();

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
const round3Path = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-3", "round-3.json");
const round3 = JSON.parse(readFileSync(round3Path, "utf8"));
const targetThreadId = round3?.state?.goal?.goal?.threadId || "";
const firstPdfPath = round3?.pdf?.path || "";
const firstPdfHash = round3?.pdf?.hash || "";
assert.ok(targetThreadId && firstPdfPath && firstPdfHash && existsSync(firstPdfPath), "Round 3 evidence is incomplete.");
assert.equal(createHash("sha256").update(readFileSync(firstPdfPath)).digest("hex"), firstPdfHash, "First PDF changed before round 4.");

const activated = await evaluate(`(() => {
  const row = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')]
    .find((element) => element.getAttribute('data-thread-key')?.includes(${JSON.stringify(targetThreadId)}));
  if (!(row instanceof HTMLButtonElement)) return false;
  row.click(); return true;
})()`);
assert.equal(activated, true, "Could not activate the GOV-UI-MULTI-001 project conversation.");
await sleep(1_000);
const before = await evaluate(`(async () => ({
  messages: (await window.newbrain.getSnapshot()).messages || [],
  threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0,
  goal: await window.newbrain.getGoalExecution()
}))()`);
assert.equal(before.goal?.goal?.threadId, targetThreadId, "Wrong thread is active before round 4.");
const request = `保留第一版PDF，不得覆盖。

请把正文改成更鲜明的领导讲话口吻：
1. 开头增加“同志们”；
2. 增加对一线职工、技术人员和安全管理人员的感谢；
3. “存在的问题”部分语气要客观，不回避问题；
4. 结尾增加2026年工作动员；
5. 先在对话中给我修改说明，不要立即生成文件。`;
const submitted = await evaluate(`(() => {
  const input = document.querySelector('[data-testid="composer-input"]');
  if (!(input instanceof HTMLTextAreaElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(request)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const button = document.querySelector('[data-testid="composer-send-button"]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
  button.click(); return true;
})()`);
assert.equal(submitted, true, "Could not submit round 4 through the visible composer.");

let state = null;
const deadline = Date.now() + 300_000;
while (Date.now() < deadline) {
  state = await evaluate(`(async () => ({
    approvalClicked: (() => { const button = document.querySelector('[data-testid="approval-approve-button"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true; })(),
    busy: Boolean(document.querySelector('.composer-card.busy')),
    messages: (await window.newbrain.getSnapshot()).messages || [],
    goal: await window.newbrain.getGoalExecution(),
    localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((element) => decodeURIComponent(element.getAttribute('data-local-file-path') || '')),
    threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0,
    composerDisabled: document.querySelector('[data-testid="composer-input"]')?.hasAttribute('disabled') ?? true,
    body: document.body.innerText
  }))()`);
  const users = state.messages.filter((message) => message.role === "user");
  const assistants = state.messages.filter((message) => message.role === "assistant");
  if (!state.busy && users.at(-1)?.content === request && assistants.length > before.messages.filter((message) => message.role === "assistant").length) break;
  await sleep(1_000);
}
const latestAssistant = state?.messages?.filter((message) => message.role === "assistant").at(-1)?.content || "";
const currentHash = createHash("sha256").update(readFileSync(firstPdfPath)).digest("hex");
const secondArtifacts = (state?.localFiles || []).filter((filePath) => /第二版\.(?:pdf|docx)$/i.test(filePath));
const evidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-4");
mkdirSync(evidenceDirectory, { recursive: true });
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(resolve(evidenceDirectory, "round-4.png"), Buffer.from(screenshot.data, "base64"));
writeFileSync(resolve(evidenceDirectory, "round-4.json"), `${JSON.stringify({ status: "CAPTURED_BEFORE_ASSERTIONS", request, state, latestAssistant, firstPdfPath, firstPdfHash, currentHash, secondArtifacts }, null, 2)}\n`);
assert.equal(state?.messages?.filter((message) => message.role === "user").at(-1)?.content, request, "Round 4 user input was not persisted exactly.");
assert.equal(state?.threadCount, before.threadCount, "Round 4 created another workspace thread.");
assert.equal(currentHash, firstPdfHash, "Round 4 overwrote the first PDF.");
assert.deepEqual(secondArtifacts, [], "Round 4 generated a second-version file before confirmation.");
for (const pattern of [/同志们/u, /一线职工/u, /技术人员/u, /安全管理人员/u, /存在的问题/u, /客观/u, /2026/u, /动员|奋斗/u]) {
  assert.match(latestAssistant, pattern, `Round 4 modification explanation omitted ${pattern}.`);
}
assert.doesNotMatch(latestAssistant, /已生成.*第二版|第二版.*已生成/u, "Round 4 falsely claimed that a second-version file was generated.");
assert.equal(state?.composerDisabled, false, "Composer did not recover after round 4.");
writeFileSync(resolve(evidenceDirectory, "round-4.json"), `${JSON.stringify({ status: "PASS", request, state, latestAssistant, firstPdfPath, firstPdfHash, currentHash }, null, 2)}\n`);
console.log(JSON.stringify({ caseId: "GOV-UI-MULTI-001", round: 4, status: "PASS", evidenceDirectory, firstPdfHash }, null, 2));
socket.close();

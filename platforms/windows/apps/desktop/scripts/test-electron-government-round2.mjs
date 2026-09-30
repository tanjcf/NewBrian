import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No visible NewBrain renderer is available.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), 30_000);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) return reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      resolveCommand(payload.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  return (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const adjustmentBody = `1. 安全生产放在第一部分，并明确写入“无较大及以上安全事故”，但不得写成“零事故”；
2. 第二部分增加301万吨原煤产量；
3. 第三部分增加5180人次安全培训和31套智能化设备；
4. 增加一节“存在的问题”，不要只写成绩；
5. 暂时不要生成正文和PDF。`;
const adjustment = `调整提纲：${adjustmentBody}`;

const initial = await evaluate(`(async () => ({
  goal: await window.newbrain.getGoalExecution(),
  assistantCount: ((await window.newbrain.getSnapshot()).messages || []).filter((message) => message.role === 'assistant').length,
  threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0,
  questionVisible: Boolean(document.querySelector('[data-testid="goal-question-card"]'))
}))()`);
assert.equal(initial.questionVisible, true, "Round 1 outline decision is not visible.");
const originalQuestionId = initial.goal?.pendingQuestion?.questionId;
assert.ok(originalQuestionId, "Round 1 has no pending outline decision.");
const submitted = await evaluate(`(() => {
  const input = document.querySelector('[data-testid="goal-custom-adjustment-input"]');
  const button = document.querySelector('[data-testid="goal-custom-adjustment-submit"]');
  if (!(input instanceof HTMLTextAreaElement) || !(button instanceof HTMLButtonElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(adjustmentBody)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  button.click();
  return true;
})()`);
assert.equal(submitted, true, "Could not submit the custom outline adjustment.");

let state = null;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  state = await evaluate(`(async () => {
    const goal = await window.newbrain.getGoalExecution();
    const messages = (await window.newbrain.getSnapshot()).messages || [];
    return {
      goal,
      messages,
      busy: Boolean(document.querySelector('.composer-card.busy')),
      questionVisible: Boolean(document.querySelector('[data-testid="goal-question-card"]')),
      body: document.body.innerText,
      localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || ''),
      threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0
    };
  })()`);
  const userMessages = state.messages.filter((message) => message.role === "user");
  const assistants = state.messages.filter((message) => message.role === 'assistant');
  const latestAssistantContent = assistants.at(-1)?.content || '';
  if (userMessages.length >= 2 && !state.busy && state.questionVisible
    && /301\s*万吨/u.test(latestAssistantContent) && /存在的问题/u.test(latestAssistantContent)) break;
  await sleep(1_000);
}
const evidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-2");
mkdirSync(evidenceDirectory, { recursive: true });
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(resolve(evidenceDirectory, "round-2.png"), Buffer.from(screenshot.data, "base64"));
writeFileSync(resolve(evidenceDirectory, "round-2.json"), `${JSON.stringify({ status: "CAPTURED_BEFORE_ASSERTIONS", adjustment, state }, null, 2)}\n`);
const userMessages = state?.messages?.filter((message) => message.role === "user") ?? [];
const latestAssistant = state?.messages?.filter((message) => message.role === "assistant").at(-1)?.content || "";
assert.ok(userMessages.at(-1)?.content.includes(adjustment), "The custom round-2 input was not persisted in the conversation.");
assert.equal(state?.questionVisible, true, "The revised outline did not return to confirmation.");
assert.equal(state?.threadCount, initial.threadCount, "Round 2 created an extra workspace thread.");
assert.match(latestAssistant, /301\s*万吨/);
assert.match(latestAssistant, /5180\s*人次/);
assert.match(latestAssistant, /31\s*套/);
assert.match(latestAssistant, /存在的问题/);
assert.match(latestAssistant, /无较大及以上安全事故/);
assert.doesNotMatch(latestAssistant, /整改闭环率\s*100%|设备开机率|增长率|事故率|零事故/);
assert.equal(state?.localFiles.some((filePath) => /\.pdf$/i.test(filePath)), false, "Round 2 generated a PDF early.");
writeFileSync(resolve(evidenceDirectory, "round-2.json"), `${JSON.stringify({ status: "PASS", adjustment, state }, null, 2)}\n`);
console.log(JSON.stringify({ caseId: "GOV-UI-MULTI-001", round: 2, status: "PASS", evidenceDirectory }, null, 2));
socket.close();

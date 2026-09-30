import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph } from "../../agentd/node_modules/docx/dist/index.mjs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import { startGovernmentE2EModelServer } from "./government-e2e-model-server.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function addLargePngMetadata(png) {
  const type = Buffer.from("tEXt", "ascii");
  const data = Buffer.from(`fixture\0${"x".repeat(24_000)}`, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9333);
process.env.NEWBRAIN_E2E_MODEL_CONFIG_PATH ||= join(homedir(), ".newbrain", "newbrain.config.json");
const modelServer = process.env.NEWBRAIN_E2E_USE_REMOTE_MODEL === "1"
  ? null
  : await startGovernmentE2EModelServer();
if (modelServer) process.env.NEWBRAIN_MODEL_BASE_URL = modelServer.baseUrl;
const session = await ensureElectronE2ESession(debugPort);
console.log("[government-e2e] Electron session ready");
const pages = session.pages;
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}, timeoutMs = 120_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.exception?.description || payload.result.exceptionDetails.text));
        return;
      }
      resolve(payload.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result?.result?.value;
}

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
async function waitFor(label, predicateExpression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(predicateExpression);
    if (value) return value;
    await sleep(750);
  }
  const diagnostics = await evaluate(`(async () => JSON.stringify({
    title: document.title,
    composer: document.querySelector('[data-testid="composer-input"]')?.value || '',
    sendDisabled: document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute('disabled'),
    composerClass: document.querySelector('.composer-card')?.className || '',
    assistantBlocks: [...document.querySelectorAll('.assistant-block')].map((element) => ({
      text: element.innerText.slice(0, 120),
      messageId: element.getAttribute('data-message-id'),
      contentLength: element.getAttribute('data-content-length'),
      renderedContentLength: element.getAttribute('data-rendered-content-length')
    })),
    localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path')),
    goal: await window.newbrain?.getGoalExecution?.().catch(() => null),
    snapshotStatus: (await window.newbrain?.getSnapshot?.())?.chatStatus,
    body: document.body?.innerText?.slice(-1200) || ''
  }))()`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Diagnostics: ${diagnostics}. Process: ${JSON.stringify(session.readProcessOutput?.() || {})}`);
}

async function click(testId) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector('[data-testid="${testId}"]');
    if (!(element instanceof HTMLElement) || element.hasAttribute('disabled')) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not click ${testId}.`);
}

function listFilesRecursively(root) {
  const files = [];
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    return files;
  }
  for (const name of entries) {
    const absolute = join(root, name);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      // Ignore ephemeral Electron/workspace temp files that disappear mid-scan.
      continue;
    }
    if (stats.isDirectory()) files.push(...listFilesRecursively(absolute));
    else files.push(absolute);
  }
  return files;
}

await waitFor("renderer bootstrap", `Boolean(document.querySelector('[data-testid="new-chat-button"], [data-testid="composer-input"], [data-testid="project-new-thread-button"]'))`, 30_000);
const ensuredWorkspace = JSON.parse(await evaluate(`(async () => {
  const root = ${JSON.stringify(session.workspacePath || join(homedir(), ".newbrain", "e2e-workspace"))};
  let catalog = await window.newbrain.listWorkspaces();
  let workspace = catalog.find((item) => item.name === 'workspace');
  if (!workspace) {
    catalog = await window.newbrain.addWorkspace({ name: 'workspace', path: root });
    workspace = catalog.find((item) => item.name === 'workspace' || item.path === root);
  }
  if (!workspace) throw new Error('Unable to ensure the government E2E workspace catalog entry.');
  localStorage.setItem('newbrain.lastSelectedWorkspaceId.v1', workspace.id);
  localStorage.removeItem('newbrain.lastSelectedThreadId.v1');
  return JSON.stringify({ id: workspace.id, path: workspace.path, name: workspace.name, threads: workspace.threads.length });
})()`));
session.workspacePath = ensuredWorkspace.path;
const targetWorkspacePath = ensuredWorkspace.path;
assert.ok(targetWorkspacePath, "The visible workspace project was not found in the real NewBrain catalog.");
await command("Page.reload", { ignoreCache: true });
await waitFor("reloaded renderer after workspace ensure", `Boolean(document.querySelector('[data-testid="new-chat-button"], [data-testid="composer-input"], [data-testid="project-new-thread-button"]'))`, 30_000);
const baselinePdfState = new Map(
  listFilesRecursively(session.workspacePath)
    .filter((filePath) => /\.pdf$/i.test(filePath))
    .map((filePath) => [filePath, `${statSync(filePath).size}:${statSync(filePath).mtimeMs}`])
);

await waitFor("workspace project new-thread entry", `Boolean(document.querySelector('[data-testid="project-new-thread-button"][data-workspace-name="workspace"]') || document.querySelector('[data-testid="composer-input"]'))`, 20_000);
const sidebarCountsBefore = JSON.parse(await evaluate(`(async () => JSON.stringify({
  project: document.querySelectorAll('[data-testid="sidebar-project-task-row"]').length,
  task: document.querySelectorAll('[data-testid="sidebar-task-row"]').length,
  catalogThreads: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0
}))()`));
const projectNewThreadClicked = await evaluate(`(() => {
  const projectButton = document.querySelector('[data-testid="project-new-thread-button"][data-workspace-name="workspace"]');
  if (projectButton instanceof HTMLButtonElement && !projectButton.disabled) {
    projectButton.click();
    return 'project';
  }
  const newChat = document.querySelector('[data-testid="new-chat-button"]');
  if (newChat instanceof HTMLButtonElement && !newChat.disabled) {
    newChat.click();
    return 'new-chat';
  }
  return document.querySelector('[data-testid="composer-input"]') ? 'composer-ready' : '';
})()`);
assert.ok(projectNewThreadClicked, "Could not start a new project thread under workspace.");
await waitFor("project-thread composer", `Boolean(document.querySelector('[data-testid="composer-input"]'))`, 10_000);
assert.equal(await evaluate(`Boolean(document.querySelector('.composer-feature-capsule'))`), false,
  "The E2E must start without a leftover feature capsule before explicit skill selection.");
await click("composer-skill-button");
await waitFor("government skill option", `Boolean(document.querySelector('[data-testid="composer-skill-government-research-writing"]'))`, 5_000);
await click("composer-skill-government-research-writing");
assert.equal(
  await evaluate(`Boolean(document.querySelector('[data-testid="composer-skill-button"].active'))`),
  true,
  "The government-research-writing skill must be explicitly selected before send."
);

await click("composer-permission-button");
await waitFor("full-access option", `Boolean(document.querySelector('[data-testid="permission-option-full"]'))`, 5_000);
await click("permission-option-full");
assert.equal(await evaluate(`document.querySelector('[data-testid="composer-permission-button"]')?.getAttribute('data-permission-mode')`), "full");

const attachmentMode = process.env.NEWBRAIN_E2E_GOVERNMENT_ATTACHMENTS === "1";
const caseStudyMode = process.env.NEWBRAIN_E2E_GOVERNMENT_CASE_STUDY === "1";
const exactObjectiveMode = process.env.NEWBRAIN_E2E_EXACT_OBJECTIVE === "1";
// Case-study mode uses the natural-language request only. The verification docx is a
// result oracle checked after generation, not an uploaded attachment.
if (!caseStudyMode && attachmentMode) {
  const fixtureRoot = resolve(process.cwd(), "..", "..", "..", "test-materials", "GOV-UI-MULTI-001");
  const xlsx = readFileSync(join(fixtureRoot, "2025年生产数据.xlsx"));
  const docx = readFileSync(join(fixtureRoot, "安全工作纪要.docx"));
  const png = readFileSync(join(fixtureRoot, "智能化综采工作面.png"));
  assert.ok(png.length > 8_192, "The image fixture must exceed the model IPC inline-URL limit that caused the production regression.");
  const attachments = [
    { name: "2025年生产数据.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: xlsx.toString("base64") },
    { name: "安全工作纪要.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: docx.toString("base64") },
    { name: "智能化综采工作面.png", type: "image/png", data: png.toString("base64") }
  ];
  const pasted = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="composer-input"]');
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const transfer = new DataTransfer();
    for (const item of ${JSON.stringify(attachments)}) {
      const bytes = Uint8Array.from(atob(item.data), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type }));
    }
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
    return true;
  })()`);
  assert.equal(pasted, true, "Could not paste mixed government-writing fixtures.");
  await waitFor("three managed attachment cards", `document.querySelectorAll('.composer-image-preview').length === 3`, 30_000);
}

const request = caseStudyMode
  ? process.env.NEWBRAIN_E2E_EXACT_OBJECTIVE === "1"
    ? "请你撰写一篇关于“因地制宜发展新质生产力”的典型案例研究文章。采用政务写作技能。"
    : `请你撰写一篇关于“因地制宜发展新质生产力”的典型案例研究文章。采用政务写作技能。

要求：
1. 先生成写作规格，确认后再写正文；
2. 不得虚构无来源数据；无官方证据支撑的表述标记【待核验】；
3. 最终输出PDF文件。`
  : attachmentMode
  ? `根据我上传的生产数据、安全工作纪要和现场图片，写一篇煤炭企业2025年年终总结发言稿，约1200字。

要求：
1. 采用正式的企业领导讲话口吻；
2. 重点写安全生产、稳产保供和智能化建设；
3. 材料没有的数据不得虚构；
4. 先给出写作规格，等我确认后再写正文；
5. 最终输出PDF${attachmentMode ? "和DOCX" : ""}文件。`
  : "写一个煤炭企业2025年年终总结发言稿，约200字，并输出PDF文件。不得虚构具体数据；写作规格确认后形成正文。";
const filled = await evaluate(`(() => {
  const input = document.querySelector('[data-testid="composer-input"]');
  if (!(input instanceof HTMLTextAreaElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(request)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
assert.equal(filled, true, "Could not fill composer input.");
await waitFor("enabled send button with authorized model", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute('disabled')`, 120_000);
await evaluate(`(() => {
  window.__codecnE2EStreamLengths = [];
  window.__codecnE2EStreamSamples = [];
  window.__codecnE2EStreamObserver?.disconnect?.();
  window.__codecnE2EStreamObserver = new MutationObserver(() => {
    const length = [...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim().length || 0;
    if (length > 0 && window.__codecnE2EStreamLengths.at(-1) !== length) {
      window.__codecnE2EStreamLengths.push(length);
      window.__codecnE2EStreamSamples.push([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim() || '');
    }
  });
  window.__codecnE2EStreamObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  return true;
})()`);
const sendButtonDiagnostics = await evaluate(`(() => [...document.querySelectorAll('[data-testid="composer-send-button"]')].map((element, index) => {
  const rect = element.getBoundingClientRect();
  const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    index,
    disabled: element instanceof HTMLButtonElement ? element.disabled : null,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
    hitSelf: center === element || Boolean(center && element.contains(center)),
    centerTag: center?.tagName || '',
    centerTestId: center?.getAttribute?.('data-testid') || ''
  };
}))()`);
console.log("[government-e2e] Send buttons", JSON.stringify(sendButtonDiagnostics));
const visibleSendClicked = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[data-testid="composer-send-button"]')];
  const button = buttons.find((element) => {
    if (!(element instanceof HTMLButtonElement) || element.disabled) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || buttons.find((element) => element instanceof HTMLButtonElement && !element.disabled);
  if (!(button instanceof HTMLButtonElement)) return false;
  button.click();
  return true;
})()`);
assert.equal(visibleSendClicked, true, "Could not click a visible composer send button.");
console.log("[government-e2e] Request submitted");
await sleep(2_500);
const postSendState = JSON.parse(await evaluate(`(async () => JSON.stringify({
  chatStatus: (await window.newbrain?.getSnapshot?.())?.chatStatus || '',
  errorText: document.querySelector('.error-banner, .model-error-banner, [data-testid="error-message"]')?.textContent?.trim() || '',
  bodyError: [...document.querySelectorAll('main, .codex-shell')].map((element) => element.innerText).join('\\n').match(/失败|错误|Error|required|无法/)?.[0] || '',
  busy: Boolean(document.querySelector('.composer-card.busy')),
  bubbles: [...document.querySelectorAll('.request-bubble')].map((element) => element.innerText.trim().slice(0, 80)),
  threadCount: (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0,
  composer: document.querySelector('[data-testid="composer-input"]')?.value?.slice(0, 80) || ''
}))()`));
console.log(`[government-e2e] Post-send state: ${JSON.stringify(postSendState)}`);
if (!postSendState.busy && postSendState.composer) {
  await waitFor("initial new-thread submission to settle", `(() => {
    const composer = document.querySelector('[data-testid="composer-input"]')?.value || '';
    const busy = Boolean(document.querySelector('.composer-card.busy'));
    const hasBubble = document.querySelectorAll('.request-bubble').length > 0;
    return busy || hasBubble || !composer ? 'settled' : '';
  })()`, 15_000).catch(() => "");
  const settledWithoutRetry = JSON.parse(await evaluate(`JSON.stringify({
    busy: Boolean(document.querySelector('.composer-card.busy')),
    hasBubble: document.querySelectorAll('.request-bubble').length > 0,
    composer: document.querySelector('[data-testid="composer-input"]')?.value || ''
  })`));
  if (!settledWithoutRetry.busy && !settledWithoutRetry.hasBubble && settledWithoutRetry.composer) {
  const retryClicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="composer-send-button"]')]
      .find((element) => element instanceof HTMLButtonElement && !element.disabled && element.getBoundingClientRect().width > 0);
    if (!(button instanceof HTMLButtonElement)) return false;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  assert.equal(retryClicked, true, "The initial send was not accepted and no retryable send button was available.");
  console.log("[government-e2e] Request submission retried after the first click was not accepted");
  }
}
await waitFor("request accepted into an active project thread", `(async () => {
  const workspace = (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace');
  const threads = workspace?.threads || [];
  if (threads.length <= ${sidebarCountsBefore.catalogThreads}) return '';
  const latest = [...threads].sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0];
  if (!latest?.id || !workspace?.id) return '';
  await window.newbrain.activateWorkspaceThread({ workspaceId: workspace.id, threadId: latest.id });
  const busy = Boolean(document.querySelector('.composer-card.busy'));
  const hasBubble = [...document.querySelectorAll('.request-bubble')].some((element) => {
    const text = element.innerText || '';
    return text.includes('政务写作') || text.includes('因地制宜') || text.includes('年终总结') || text.includes('PDF');
  });
  const hasAssistant = [...document.querySelectorAll('.assistant-block')].some((element) => (element.innerText || '').trim().length > 0);
  return busy || hasBubble || hasAssistant ? 'ready' : '';
})()`, 60_000);
await waitFor("new workspace project thread without a task-row side effect", `(async () => {
  const catalogThreads = (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace')?.threads.length || 0;
  const task = document.querySelectorAll('[data-testid="sidebar-task-row"]').length;
  return catalogThreads > ${sidebarCountsBefore.catalogThreads} && task === ${sidebarCountsBefore.task};
})()`, 20_000);

const liveReasoning = await waitFor("live reasoning summary", `(() => {
  const summary = document.querySelector('[data-testid="reasoning-summary-live"]')?.innerText?.trim()
    || document.querySelector('[data-testid="reasoning-summary"]')?.innerText?.trim()
    || '';
  if (summary.length >= 12) return summary;
  const completedArtifact = [...document.querySelectorAll('[data-local-file-path]')]
    .some((element) => /\.pdf$/i.test(element.getAttribute('data-local-file-path') || ''));
  const specificationReady = Boolean(document.querySelector('[data-testid="government-writing-specification"]'));
  const busy = Boolean(document.querySelector('.composer-card.busy'));
  return (completedArtifact && !busy) || specificationReady ? '__completed_without_reasoning_summary__' : '';
})()`, 90_000);
if (liveReasoning !== "__completed_without_reasoning_summary__") {
  assert.match(liveReasoning, /分析|目标|工具|约束|Analyzing|goals|constraints/i);
}
await waitFor("visible or durably accepted user request", `(async () => {
  if ([...document.querySelectorAll('.request-bubble')].at(-1)?.innerText?.trim()) return true;
  if (!${JSON.stringify(exactObjectiveMode)}) return false;
  const goal = await window.newbrain?.getGoalExecution?.();
  return goal?.goal?.status === 'active' && goal.goal.objective === ${JSON.stringify(request)};
})()`, 30_000);
await evaluate(`(() => {
  const bubble = [...document.querySelectorAll('.request-bubble')].at(-1);
  bubble?.scrollIntoView({ block: 'nearest' });
  return Boolean(bubble);
})()`);
await sleep(200);
const runningUserPrompt = JSON.parse(await evaluate(`(() => {
  const bubbles = [...document.querySelectorAll('.request-bubble')];
  const bubble = bubbles.at(-1);
  const scroller = bubble?.closest('.task-scroll');
  const composer = document.querySelector('.composer-card');
  if (!(bubble instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return JSON.stringify({ exists: false });
  bubble.scrollIntoView({ block: 'nearest' });
  const rect = bubble.getBoundingClientRect();
  const scrollRect = scroller.getBoundingClientRect();
  const composerRect = composer?.getBoundingClientRect();
  const viewportBottom = Math.min(scrollRect.bottom, composerRect?.top ?? scrollRect.bottom);
  return JSON.stringify({
    exists: true,
    text: bubble.innerText.trim(),
    visible: getComputedStyle(bubble).visibility !== 'hidden' && getComputedStyle(bubble).display !== 'none',
    inViewport: rect.bottom > scrollRect.top + 4 && rect.top < viewportBottom - 4,
    rect: { top: rect.top, bottom: rect.bottom },
    viewport: { top: scrollRect.top, bottom: viewportBottom }
  });
})()`));
if (!exactObjectiveMode && (!runningUserPrompt.exists || !runningUserPrompt.visible || runningUserPrompt.text !== request)) {
  const evidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-001-running-user-input");
  mkdirSync(evidenceDirectory, { recursive: true });
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(evidenceDirectory, "running-state.png"), Buffer.from(screenshot.data, "base64"));
  writeFileSync(join(evidenceDirectory, "failure.json"), `${JSON.stringify({
    caseId: "GOV-001",
    status: "FAIL",
    phase: "running-user-input",
    expected: { text: request, exists: true, visible: true, inViewport: true },
    actual: runningUserPrompt,
    laterPhases: ["goal", "outline-confirmation", "artifact", "reload-recovery"].map((phase) => ({ phase, status: "NOT RUN" }))
  }, null, 2)}\n`, "utf8");
  console.error(`[government-e2e] Evidence: ${evidenceDirectory}`);
}
if (!exactObjectiveMode) {
  assert.equal(runningUserPrompt.exists, true, "The active turn removed the user's input bubble.");
  assert.equal(runningUserPrompt.text, request, "The active turn did not preserve the complete user input.");
  assert.equal(runningUserPrompt.visible, true, "The active user input is hidden while the model is running.");
}
if (runningUserPrompt.exists && !runningUserPrompt.inViewport) {
  console.warn(`[government-e2e] User bubble exists but is partially out of viewport: ${JSON.stringify(runningUserPrompt.rect)}`);
}

const initialGoal = JSON.parse(await waitFor("native government goal", `(async () => {
  const goal = await window.newbrain?.getGoalExecution?.();
  return goal?.goal?.status === 'active' && goal?.plan?.length === 9 ? JSON.stringify(goal) : '';
})()`, 30_000));
console.log("[government-e2e] Government goal active");
assert.equal(initialGoal.plan.length, 9);
assert.ok(
  initialGoal.runtime?.selectedSkillNames?.includes("government-research-writing"),
  `Explicit skill selection did not persist the government skill: ${JSON.stringify(initialGoal.runtime?.selectedSkillNames || [])}`
);
assert.deepEqual(
  initialGoal.plan.slice(2, 5).map((step) => step.stepId),
  ["official-evidence-research", "writing-specification", "specification-confirmation"]
);

const decisionDeadline = Date.now() + 240_000;
let decisionReady = false;
while (Date.now() < decisionDeadline) {
  const state = JSON.parse(await evaluate(`JSON.stringify({
    decision: Boolean(document.querySelector('[data-testid="government-writing-specification"]')),
    assistantLength: [...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim().length || 0,
    assistantPreview: ([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').slice(0, 240),
    hasSpecMarkers: /# 写作任务[\s\S]*# 结构模板/.test([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || ''),
    error: document.querySelector('.model-error-banner, .research-intake-error')?.textContent?.trim() || ''
  })`));
  if (state.error) throw new Error(state.error);
  if (state.decision) { decisionReady = true; break; }
  await sleep(1_000);
}
if (!decisionReady) {
  const diagnostics = await evaluate(`(async () => JSON.stringify({
    goal: await window.newbrain?.getGoalExecution?.(),
    spec: await window.newbrain?.getGovernmentWritingSpecification?.({
      threadId: (await window.newbrain?.getGoalExecution?.())?.goal?.threadId,
      goalId: (await window.newbrain?.getGoalExecution?.())?.goal?.goalId
    }).catch((error) => String(error)),
    latestAssistant: ([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').slice(0, 1200)
  }))()`);
  throw new Error(`The government writing specification UI did not appear. Diagnostics: ${diagnostics}`);
}
assert.equal(decisionReady, true, "The government writing specification UI did not appear.");
console.log("[government-e2e] Writing specification visible");
const workspaceThreadCountAfterDecision = await evaluate(`window.newbrain.listWorkspaces().then((items) => items.find((item) => item.name === 'workspace')?.threads.length || 0)`);
assert.equal(workspaceThreadCountAfterDecision, sidebarCountsBefore.catalogThreads + 1,
  "The first government-writing round created delegated child threads instead of remaining in the one requested project conversation.");
assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="government-writing-specification"] button.primary'))`), true, "The specification UI does not expose confirm-and-write.");
if (process.env.NEWBRAIN_E2E_GOVERNMENT_FIRST_ROUND_ONLY === "1") {
  await waitFor("persisted first-round assistant details", `(() => {
    const toggle = [...document.querySelectorAll('[data-testid="assistant-details-toggle"]')].at(-1);
    const assistant = [...document.querySelectorAll('.assistant-block')].at(-1);
    return toggle instanceof HTMLButtonElement && !toggle.disabled && Boolean(assistant?.innerText?.trim());
  })()`, 15_000);
  const detailExpanded = await evaluate(`(() => {
    const toggle = [...document.querySelectorAll('[data-testid="assistant-details-toggle"]')].at(-1);
    if (!(toggle instanceof HTMLButtonElement) || toggle.disabled) return false;
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    return true;
  })()`);
  assert.equal(detailExpanded, true, "The first-round execution details cannot be expanded.");
  await waitFor("visible government skill disclosure", `document.body.innerText.includes('政务写作') || document.body.innerText.includes('government-research-writing')`, 15_000);
  const firstRoundEvidence = JSON.parse(await evaluate(`JSON.stringify({
    userMessages: [...document.querySelectorAll('.request-bubble')].map((element) => element.innerText.trim()),
    latestAssistant: [...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim() || '',
    attachmentCards: [...document.querySelectorAll('.request-attachments > button')].map((element) => element.getAttribute('title') || element.innerText.trim()),
    skillVisible: document.body.innerText.includes('政务写作') || document.body.innerText.includes('government-research-writing'),
    reasoningVisible: Boolean(document.querySelector('[data-testid="reasoning-summary-live"], [data-testid="reasoning-summary"]')),
    stepOrToolVisible: Boolean(document.querySelector('.assistant-activity-row')),
    specificationVisible: Boolean(document.querySelector('[data-testid="government-writing-specification"]')),
    localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || '')
  })`));
  const diskFiles = listFilesRecursively(session.workspacePath);
  const changedPdfFiles = diskFiles.filter((filePath) => /\.pdf$/i.test(filePath)).filter((filePath) => {
    const baseline = baselinePdfState.get(filePath);
    return !baseline || baseline !== `${statSync(filePath).size}:${statSync(filePath).mtimeMs}`;
  });
  const evidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", caseStudyMode ? "GOV-CASE-STUDY-001" : "GOV-UI-MULTI-001", "round-1");
  mkdirSync(evidenceDirectory, { recursive: true });
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(evidenceDirectory, "round-1.png"), Buffer.from(screenshot.data, "base64"));
  writeFileSync(join(evidenceDirectory, "round-1.json"), `${JSON.stringify({ caseId: caseStudyMode ? "GOV-CASE-STUDY-001" : "GOV-UI-MULTI-001", round: 1, status: "CAPTURED_BEFORE_ASSERTIONS", ...firstRoundEvidence, diskFiles }, null, 2)}\n`, "utf8");
  assert.deepEqual(firstRoundEvidence.userMessages, [request], "The first-round user message is missing or not exact.");
  assert.equal(firstRoundEvidence.attachmentCards.length, caseStudyMode ? 0 : 3, "The submitted turn did not retain the expected attachment cards.");
  assert.equal(firstRoundEvidence.skillVisible, true, "Government-writing skill disclosure is not visible.");
  assert.equal(firstRoundEvidence.reasoningVisible, true, "Reasoning summary is not visible at the specification stage.");
  assert.equal(firstRoundEvidence.specificationVisible, true, "The writing specification surface is missing.");
  if (caseStudyMode) {
    const { buildGovernmentResultOracle, scoreGovernmentResultAgainstOracle } = await import(
      new URL("../src/main/government-result-oracle.js", import.meta.url).href
    );
    const goldPath = resolve(process.cwd(), "..", "..", "..", "tmp", "gov-case-verify.docx");
    const goldText = (await mammoth.extractRawText({ buffer: readFileSync(goldPath) })).value;
    const oracle = buildGovernmentResultOracle(goldText);
    const scored = scoreGovernmentResultAgainstOracle(firstRoundEvidence.latestAssistant, oracle);
    writeFileSync(join(evidenceDirectory, "oracle-score.json"), `${JSON.stringify({ oracle, scored }, null, 2)}\n`, "utf8");
    assert.match(firstRoundEvidence.latestAssistant, /写作任务|核心要求|结构模板|因地制宜|新质生产力/u);
    assert.doesNotMatch(firstRoundEvidence.latestAssistant, /301\s*万吨|煤炭企业2025年年终总结发言稿/,
      "The case-study first round imported an unrelated coal scenario.");
    assert.ok(scored.leakedForbidden.length === 0, `Oracle forbidden leaks: ${scored.leakedForbidden.join(",")}`);
  } else {
    for (const [label, pattern] of [
      ['301 万吨', /301\s*万吨/],
      ['5180 人次', /5180\s*人次/],
      ['31 套', /31\s*套/],
      ['无较大及以上安全事故', /无较大及以上安全事故/]
    ]) {
      assert.match(firstRoundEvidence.latestAssistant, pattern, `The first-round specification omitted ${label}.`);
    }
    assert.doesNotMatch(firstRoundEvidence.latestAssistant, /整改闭环率\s*100%|设备开机率|增长率|事故率|零较大/,
      "The first-round specification invented unsupported facts or changed the constrained safety wording.");
    assert.match(
      firstRoundEvidence.latestAssistant,
      /"unsupportedClaims"\s*:\s*\[[\s\S]{0,120}"零事故"/u,
      "The specification must preserve '零事故' as an explicitly unsupported claim, not a usable fact."
    );
  }
  assert.equal(firstRoundEvidence.localFiles.some((value) => /\.pdf$/i.test(value)), false, "A PDF link appeared before specification confirmation.");
  assert.deepEqual(changedPdfFiles, [], "A PDF file was created or modified before specification confirmation.");
  writeFileSync(join(evidenceDirectory, "round-1.json"), `${JSON.stringify({ caseId: caseStudyMode ? "GOV-CASE-STUDY-001" : "GOV-UI-MULTI-001", round: 1, status: "PASS", ...firstRoundEvidence, diskFiles }, null, 2)}\n`, "utf8");
  socket.close();
  session.close();
  await modelServer?.close();
  console.log(JSON.stringify({ caseId: caseStudyMode ? "GOV-CASE-STUDY-001" : "GOV-UI-MULTI-001", round: 1, status: "PASS", evidenceDirectory }, null, 2));
  process.exit(0);
}
const streamedLengths = await evaluate(`window.__codecnE2EStreamObserver?.disconnect?.(); window.__codecnE2EStreamLengths || []`);
assert.ok(new Set(streamedLengths).size >= 2, `Expected streamed output growth, observed lengths: ${streamedLengths.join(", ")}`);
const streamedSamples = await evaluate(`window.__codecnE2EStreamSamples || []`);
assert.doesNotMatch(streamedSamples.join("\n"), /The user is asking|Let me |I need to|I should |现在需要调用|让我(?:先|来|生成)/i, "Private planning leaked into visible streamed output.");

await waitFor("enabled writing specification confirmation", `(() => {
  const button = document.querySelector('[data-testid="government-writing-specification"] button.primary');
  return button instanceof HTMLButtonElement && !button.disabled ? 'ready' : '';
})()`, 30_000);
const confirmClicked = await evaluate(`(() => {
  const button = document.querySelector('[data-testid="government-writing-specification"] button.primary');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
  button.click();
  return true;
})()`);
assert.equal(confirmClicked, true, "Could not confirm the writing specification.");
await waitFor("writing specification marked confirmed", `(async () => {
  const panel = document.querySelector('[data-testid="government-writing-specification"]');
  const confirmedLabel = panel?.innerText?.includes('已确认');
  const goal = await window.newbrain?.getGoalExecution?.();
  const confirmation = goal?.plan?.find((step) => step.stepId === 'specification-confirmation');
  const draftStarted = goal?.plan?.some((step) => /draft/i.test(step.stepId) && step.status !== 'pending');
  const errorText = document.querySelector('.error-banner, .model-error-banner, [data-testid="error-message"]')?.textContent?.trim() || '';
  if (errorText && /规格确认失败|分析不完整|待确认/u.test(errorText)) return '';
  return (confirmedLabel || confirmation?.status === 'completed' || draftStarted) ? 'confirmed' : '';
})()`, 60_000);
console.log("[government-e2e] Writing specification confirmed");
if (exactObjectiveMode) {
  const exactFinalState = JSON.parse(await waitFor("completed substantive government article", `(async () => {
    const busy = Boolean(document.querySelector('.composer-card.busy'));
    const question = Boolean(document.querySelector('[data-testid="goal-question-card"]'));
    const answers = [...document.querySelectorAll('.assistant-block')];
    const content = answers.at(-1)?.innerText?.trim() || '';
    const goal = await window.newbrain?.getGoalExecution?.();
    if (!busy && !question && content.replace(/\\s+/g, '').length >= 1000 && goal?.goal?.status === 'complete') return JSON.stringify({ content, goal });
    return '';
  })()`, 420_000));
  assert.equal(exactFinalState.goal.goal.status, "complete");
  assert.ok(exactFinalState.goal.plan.every((step) => step.status === "completed"));
  await evaluate(`(() => {
    for (const button of document.querySelectorAll('[data-testid="assistant-details-toggle"][aria-expanded="false"]')) {
      if (button instanceof HTMLButtonElement && !button.disabled) button.click();
    }
    for (const button of document.querySelectorAll('.assistant-activity-group > button[aria-expanded="false"]')) {
      if (button instanceof HTMLButtonElement) button.click();
    }
    return true;
  })()`);
  await waitFor("rendered persisted official tool activities", `(() => {
    const names = [...document.querySelectorAll('[data-tool-name]')]
      .map((element) => element.getAttribute('data-tool-name'));
    return names.includes('web.search_official') && names.includes('web.read_official') ? 'rendered' : '';
  })()`, 15_000);
  const officialToolEvidence = JSON.parse(await evaluate(`JSON.stringify(
    [...document.querySelectorAll('[data-tool-name]')].map((element) => ({
      name: element.getAttribute('data-tool-name'),
      text: element.textContent?.trim() || ''
    }))
  )`));
  console.log("[government-e2e] Persisted tool evidence", JSON.stringify(officialToolEvidence));
  for (const requiredTool of ["web.search_official", "web.read_official"]) {
    assert.ok(
      officialToolEvidence.some((entry) => entry.name === requiredTool),
      `Full-chain evidence is missing a persisted ${requiredTool} activity.`
    );
  }
  assert.doesNotMatch(exactFinalState.content, /The user is asking|Let me |I should /i);
  assert.match(exactFinalState.content, /因地制宜|新质生产力/u);
  assert.doesNotMatch(exactFinalState.content, /301\s*万吨|煤炭企业2025年年终总结发言稿/u);
  const { buildGovernmentResultOracle, scoreGovernmentResultAgainstOracle } = await import(new URL("../src/main/government-result-oracle.js", import.meta.url).href);
  const goldPath = resolve(process.cwd(), "..", "..", "..", "tmp", "gov-case-verify.docx");
  const goldText = (await mammoth.extractRawText({ buffer: readFileSync(goldPath) })).value;
  const scored = scoreGovernmentResultAgainstOracle(exactFinalState.content, buildGovernmentResultOracle(goldText));
  const deliveryEvidenceDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-CASE-STUDY-001", "exact-delivery");
  mkdirSync(deliveryEvidenceDirectory, { recursive: true });
  writeFileSync(join(deliveryEvidenceDirectory, "delivery-oracle.json"), `${JSON.stringify({ scored, content: exactFinalState.content, goal: exactFinalState.goal, officialToolEvidence }, null, 2)}\n`, "utf8");
  assert.equal(scored.leakedForbidden.length, 0, `Oracle forbidden leaks: ${scored.leakedForbidden.join(",")}`);
  assert.equal(scored.pass, true, `Article failed result-oracle checks: ${JSON.stringify(scored)}`);
  socket.close();
  session.close();
  await modelServer?.close();
  console.log(JSON.stringify({ caseId: "GOV-CASE-STUDY-001", round: "exact-delivery", status: "PASS", evidenceDirectory: deliveryEvidenceDirectory }, null, 2));
  process.exit(0);
}

const finalState = JSON.parse(await waitFor("completed substantive government draft and PDF", `(async () => {
  const busy = Boolean(document.querySelector('.composer-card.busy'));
  const question = Boolean(document.querySelector('[data-testid="goal-question-card"]'));
  const answers = [...document.querySelectorAll('.assistant-block')];
  const content = answers.at(-1)?.innerText?.trim() || '';
  const goal = await window.newbrain?.getGoalExecution?.();
  const pdfPath = [
    ...document.querySelectorAll('.assistant-file-link'),
    ...document.querySelectorAll('[data-local-file-path$=".pdf" i]')
  ].map((element) => element.getAttribute('data-local-file-path') || element.textContent?.trim() || '').find((value) => /\.pdf$/i.test(value)) || '';
  if (!busy && !question && content.replace(/\s+/g, '').length >= 160 && goal?.goal?.status === 'complete' && pdfPath) {
    return JSON.stringify({ content, goal, pdfPath });
  }
  return '';
})()`, caseStudyMode ? 420_000 : (modelServer ? 120_000 : 360_000)));
console.log("[government-e2e] Draft and PDF ready");
assert.equal(finalState.goal.goal.status, "complete");
assert.match(finalState.pdfPath, /\.pdf$/i);
assert.ok(finalState.goal.plan.length >= 9, "Confirmed outline was not expanded into section-level draft actions.");
assert.ok(finalState.goal.plan.filter((step) => step.stepId.startsWith("draft-section-")).length >= 2);
assert.ok(finalState.goal.plan.every((step) => step.status === "completed"));
assert.doesNotMatch(finalState.content, /^\.{3}$/);
assert.doesNotMatch(finalState.content, /The user is asking|Let me |I should /i);

const verifiedPdfPath = session.workspacePath ? join(session.workspacePath, finalState.pdfPath) : "";
assert.ok(verifiedPdfPath, "The isolated Electron session did not expose its workspace path.");
const pdfParser = new PDFParse({ data: readFileSync(verifiedPdfPath) });
const pdfText = (await pdfParser.getText()).text;
await pdfParser.destroy();
if (caseStudyMode) {
  const { assertGovernmentDeliveryMatchesOracle } = await import(
    new URL("../src/main/government-result-oracle.js", import.meta.url).href
  );
  const goldPath = resolve(process.cwd(), "..", "..", "..", "tmp", "gov-case-verify.docx");
  const deliveryEvidenceDirectory = resolve(
    process.cwd(),
    "..",
    "..",
    "tmp",
    "e2e-evidence",
    "GOV-CASE-STUDY-001",
    "delivery"
  );
  mkdirSync(deliveryEvidenceDirectory, { recursive: true });
  const oracleResult = await assertGovernmentDeliveryMatchesOracle({
    candidatePath: verifiedPdfPath,
    oraclePath: goldPath,
    options: { forbiddenCrossScene: ["301万吨", "煤炭企业2025年年终总结发言稿"] }
  });
  writeFileSync(join(deliveryEvidenceDirectory, "delivery-oracle.json"), `${JSON.stringify(oracleResult, null, 2)}\n`, "utf8");
  assert.equal(oracleResult.scored.pass, true, `PDF failed result-oracle checks: ${JSON.stringify(oracleResult.scored)}`);
  assert.doesNotMatch(pdfText, /301万吨|煤炭企业2025年年终总结发言稿/u);
} else {
  assert.match(pdfText, /同志们/u);
}
assert.doesNotMatch(pdfText, /原始交付要求|当前用户选择|尚未生成并验证/u);
let attachmentResult = null;
if (caseStudyMode) {
  attachmentResult = { count: 0, oracleVerified: true };
} else if (attachmentMode) {
  assert.match(pdfText, /301万吨/u);
  assert.match(pdfText, /5180人次/u);
  assert.match(pdfText, /31套/u);
  assert.match(pdfText, /无较大及以上安全事故/u);
  assert.doesNotMatch(pdfText, /零事故/u);
  const docxPath = await waitFor("material DOCX link", `[...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || '').find((value) => /\\.docx$/i.test(value)) || ''`, 20_000);
  const extractedDocx = await mammoth.extractRawText({ buffer: readFileSync(join(session.workspacePath, docxPath)) });
  assert.match(extractedDocx.value, /301万吨/u);
  assert.match(extractedDocx.value, /5180人次/u);
  assert.match(extractedDocx.value, /31套/u);
  assert.match(extractedDocx.value, /无较大及以上安全事故/u);
  assert.doesNotMatch(extractedDocx.value, /零事故/u);
  attachmentResult = { count: 3, docxPath, factsVerified: ["301万吨", "5180人次", "31套", "无较大及以上安全事故"] };
}
const retainedPdfDirectory = resolve(process.cwd(), "..", "..", "tmp", "pdfs", "government-e2e");
mkdirSync(retainedPdfDirectory, { recursive: true });
copyFileSync(verifiedPdfPath, join(retainedPdfDirectory, "newbrain-output.pdf"));

assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="reasoning-summary"]'))`), false, "Completed reasoning should be collapsed by default.");
const expandedReasoning = await evaluate(`(() => {
  const toggles = [...document.querySelectorAll('[data-testid="assistant-details-toggle"]')].reverse();
  const toggle = toggles.find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled);
  if (!(toggle instanceof HTMLButtonElement)) return '';
  toggle.click();
  return 'clicked';
})()`);
assert.equal(expandedReasoning, "clicked", "The completed reasoning toggle is unavailable.");
const reasoningText = await waitFor("expanded completed details", `(() => {
  const reasoning = document.querySelector('[data-testid="reasoning-summary"]')?.innerText?.trim() || '';
  const activities = document.querySelector('.assistant-activity-panel.compact')?.innerText?.trim() || '';
  return reasoning || activities;
})()`, 5_000);
assert.ok(reasoningText.length > 0);

const draftAnchor = (finalState.content.match(/同志们[：:][\s\S]{0,40}/u)?.[0]
  || finalState.content.match(/大家好[！!][\s\S]{0,40}/u)?.[0]
  || finalState.content.replace(/\s+/g, "").slice(0, 40)).trim();
assert.ok(draftAnchor.length >= 8, "Could not derive a stable draft anchor for reload persistence.");
const persistenceThreadId = finalState.goal?.goal?.threadId || "";
assert.ok(persistenceThreadId, "Completed goal did not expose a threadId for reload persistence.");
await command("Page.reload", { ignoreCache: true });
await waitFor("reloaded renderer shell", `Boolean(document.querySelector('[data-testid="composer-input"], [data-testid="new-chat-button"], [data-testid="project-new-thread-button"]'))`, 30_000);
await waitFor("reactivated thread after reload", `(async () => {
  const workspace = (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace');
  if (!workspace?.id) return '';
  const project = document.querySelector('[data-testid="project-new-thread-button"][data-workspace-id="' + workspace.id + '"]')?.closest('.project-group');
  const projectButton = project?.querySelector('.project-header-main');
  if (projectButton instanceof HTMLButtonElement && projectButton.getAttribute('aria-expanded') !== 'true') projectButton.click();
  const row = document.querySelector('[data-testid="sidebar-project-task-row"][data-thread-key="' + workspace.id + ':' + ${JSON.stringify(persistenceThreadId)} + '"]');
  if (row instanceof HTMLButtonElement && !row.classList.contains('active')) row.click();
  const hasComposer = Boolean(document.querySelector('[data-testid="composer-input"]'));
  const hasAssistant = [...document.querySelectorAll('.assistant-block')].some((element) => (element.innerText || '').trim().length > 0);
  const hasBubble = [...document.querySelectorAll('.request-bubble')].some((element) => (element.innerText || '').trim().length > 0);
  return hasComposer && (hasAssistant || hasBubble) ? 'ready' : '';
})()`, 60_000);
const persisted = await waitFor("persisted final draft", `(() => {
  const blocks = [...document.querySelectorAll('.assistant-block')].map((element) => element.innerText?.trim() || '');
  const hit = blocks.find((text) => text.includes(${JSON.stringify(draftAnchor)}));
  return hit || '';
})()`, 60_000);
assert.ok(persisted.replace(/\s+/g, "").length >= 80, "The final draft was missing or truncated after reload.");
if (!attachmentMode) {
  const persistedReasoningClick = await evaluate(`(() => {
    const toggle = [...document.querySelectorAll('[data-testid="assistant-details-toggle"]')].at(-1);
    if (!(toggle instanceof HTMLButtonElement) || toggle.disabled) return '';
    toggle.click();
    return 'clicked';
  })()`);
  assert.equal(persistedReasoningClick, "clicked", "The persisted reasoning toggle is unavailable.");
  const persistedReasoning = await waitFor("persisted assistant details", `(() => {
    const reasoning = document.querySelector('[data-testid="reasoning-summary"]')?.innerText?.trim() || '';
    const activities = document.querySelector('.assistant-activity-panel.compact')?.innerText?.trim() || '';
    return reasoning || activities;
  })()`, 5_000);
  assert.ok(persistedReasoning.length > 0, "The assistant details were not persisted with the assistant turn.");
}

let multiTurnResult = null;
if (process.env.NEWBRAIN_E2E_GOVERNMENT_MULTITURN === "1") {
  const originalPdfHash = createHash("sha256").update(readFileSync(verifiedPdfPath)).digest("hex");
  const followUp = "把第二部分改成领导讲话口吻，增加对一线职工的感谢。保留原PDF，再输出一个Word版本，不得覆盖原文件。";
  const followUpFilled = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="composer-input"]');
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(followUp)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert.equal(followUpFilled, true, "Could not fill the multi-turn government follow-up.");
  await waitFor("enabled multi-turn send button", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute('disabled')`, 20_000);
  await click("composer-send-button");
  await waitFor("second live user message", `(() => {
    const bubble = [...document.querySelectorAll('.request-bubble')].at(-1);
    return bubble?.innerText?.trim() === ${JSON.stringify(followUp)};
  })()`, 20_000);

  const secondDecision = await waitFor("second outline decision or direct completion", `(async () => {
    if (document.querySelector('[data-testid="goal-question-card"]')) return 'decision';
    const links = [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || '');
    const goal = await window.newbrain?.getGoalExecution?.();
    return goal?.goal?.status === 'complete' && links.some((value) => /\.docx$/i.test(value)) ? 'complete' : '';
  })()`, 120_000);
  if (secondDecision === "decision") {
    const secondRecommendedId = await evaluate(`document.querySelector('[data-testid^="goal-option-"][data-recommended="true"]')?.getAttribute('data-testid') || ''`);
    assert.ok(secondRecommendedId, "The second government outline did not expose a recommended decision.");
    await click(secondRecommendedId);
  }

  const docxState = JSON.parse(await waitFor("completed DOCX revision", `(async () => {
    const busy = Boolean(document.querySelector('.composer-card.busy'));
    const question = Boolean(document.querySelector('[data-testid="goal-question-card"]'));
    const goal = await window.newbrain?.getGoalExecution?.();
    const docxPath = [...document.querySelectorAll('[data-local-file-path]')]
      .map((element) => element.getAttribute('data-local-file-path') || '')
      .find((value) => /\.docx$/i.test(value)) || '';
    return !busy && !question && goal?.goal?.status === 'complete' && docxPath
      ? JSON.stringify({ docxPath, goal })
      : '';
  })()`, 180_000));
  const verifiedDocxPath = join(session.workspacePath, docxState.docxPath);
  const docxExtraction = await mammoth.extractRawText({ buffer: readFileSync(verifiedDocxPath) });
  assert.match(docxExtraction.value, /一线职工/u);
  assert.match(docxExtraction.value, /安全生产/u);
  assert.equal(createHash("sha256").update(readFileSync(verifiedPdfPath)).digest("hex"), originalPdfHash, "The follow-up overwrote the original PDF.");

  await command("Page.reload", { ignoreCache: true });
  await waitFor("multi-turn renderer after reload", `Boolean(document.querySelector('[data-testid="composer-input"], [data-testid="new-chat-button"], [data-testid="project-new-thread-button"]'))`, 30_000);
  await waitFor("reactivated multi-turn thread after reload", `(async () => {
    const workspace = (await window.newbrain.listWorkspaces()).find((item) => item.name === 'workspace');
    if (!workspace?.id) return '';
    const project = document.querySelector('[data-testid="project-new-thread-button"][data-workspace-id="' + workspace.id + '"]')?.closest('.project-group');
    const projectButton = project?.querySelector('.project-header-main');
    if (projectButton instanceof HTMLButtonElement && projectButton.getAttribute('aria-expanded') !== 'true') projectButton.click();
    const row = document.querySelector('[data-testid="sidebar-project-task-row"][data-thread-key="' + workspace.id + ':' + ${JSON.stringify(persistenceThreadId)} + '"]');
    if (row instanceof HTMLButtonElement && !row.classList.contains('active')) row.click();
    return Boolean(document.querySelector('[data-testid="composer-input"]')) ? 'ready' : '';
  })()`, 60_000);
  const reloadedSnapshotMessages = JSON.parse(await evaluate(`window.newbrain.getSnapshot().then((snapshot) => JSON.stringify(snapshot.messages || []))`));
  console.log("[government-e2e] Reloaded roles", reloadedSnapshotMessages.map((message) => `${message.role}:${String(message.content || "").slice(0, 30)}`));
  await waitFor("multi-turn history after reload", `(() => {
    const bubbles = [...document.querySelectorAll('.request-bubble')].map((element) => element.innerText.trim());
    const links = [...document.querySelectorAll('[data-local-file-path]')].map((element) => element.getAttribute('data-local-file-path') || '');
    return bubbles.includes(${JSON.stringify(followUp)}) && links.some((value) => /\.pdf$/i.test(value)) && links.some((value) => /\.docx$/i.test(value));
  })()`, 30_000);
  multiTurnResult = { docxPath: docxState.docxPath, docxLength: docxExtraction.value.replace(/\s+/g, "").length, originalPdfPreserved: true };
}

socket.close();
session.close();
await modelServer?.close();
console.log(JSON.stringify({
  ok: true,
  streamedUpdates: new Set(streamedLengths).size,
  goalSteps: finalState.goal.plan.length,
  finalLength: finalState.content.replace(/\s+/g, "").length,
  persistedLength: persisted.replace(/\s+/g, "").length,
  multiTurn: multiTurnResult,
  attachments: attachmentResult
}, null, 2));

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const email = process.env.NEWBRAIN_E2E_LOGIN_EMAIL?.trim();
const password = process.env.NEWBRAIN_E2E_LOGIN_PASSWORD?.trim();
assert.ok(email && password, "NEWBRAIN_E2E_LOGIN_EMAIL and NEWBRAIN_E2E_LOGIN_PASSWORD are required.");
const visibleStepDelayMs = Math.max(
  0,
  Number.parseInt(process.env.NEWBRAIN_E2E_VISIBLE_STEP_DELAY_MS || "0", 10) || 0
);
const keepOpenMs = Math.max(
  0,
  Number.parseInt(process.env.NEWBRAIN_E2E_KEEP_OPEN_MS || "0", 10) || 0
);

const desktopRoot = resolve(import.meta.dirname, "..");
const electron = join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
assert.equal(existsSync(electron), true, `Electron executable is missing: ${electron}`);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const projectName = `自动化测试 ${runId.slice(11, 19)}`;
const profileRoot = mkdtempSync(join(tmpdir(), "newbrain-live-guided-"));
const artifactRoot = resolve(desktopRoot, "../../../integration-artifacts/live-guided-doc-flow", runId);
mkdirSync(artifactRoot, { recursive: true });
const debugPort = 19_000 + (process.pid % 10_000);
const child = spawn(electron, ["."], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    NEWBRAIN_E2E_REMOTE_DEBUG_PORT: String(debugPort),
    NEWBRAIN_WORKSPACE_PATH: profileRoot
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false
});

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const visiblePause = () => visibleStepDelayMs > 0 ? sleep(visibleStepDelayMs) : Promise.resolve();
async function readPages() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

const pageDeadline = Date.now() + 30_000;
let page;
while (Date.now() < pageDeadline) {
  const pages = await readPages();
  page = pages?.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  if (page) break;
  if (child.exitCode !== null) throw new Error(`Electron exited early with code ${child.exitCode}.`);
  await sleep(200);
}
assert.ok(page, "Electron renderer CDP endpoint did not become ready.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  socket.addEventListener("open", resolvePromise, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out.`)), timeoutMs);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolvePromise(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, timeoutMs = 30_000) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result.result?.value;
}

async function waitFor(label, expression, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(200);
  }
  const diagnostic = await evaluate(`document.body?.innerText?.slice(-1600) || ""`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}: ${diagnostic}`);
}

async function screenshot(name) {
  const result = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const path = join(artifactRoot, `${name}.png`);
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return path;
}

function setInput(selector, value) {
  return evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function sendMessage(message) {
  assert.equal(await setInput('[data-testid="composer-input"]', message), true);
  await waitFor("enabled send button", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute("disabled")`);
  await evaluate(`document.querySelector('[data-testid="composer-send-button"]')?.click()`);
}

async function waitForTurnComplete(previousAssistantCount, timeoutMs = 180_000) {
  return waitFor("completed assistant turn", `(() => {
    const assistantCount = document.querySelectorAll(".assistant-block").length;
    const busy = Boolean(document.querySelector(".composer-busy-note, .conversation-turn.current"));
    return assistantCount > ${previousAssistantCount} && !busy;
  })()`, timeoutMs);
}

const evidence = {
  runId,
  projectName,
  screenshots: [],
  steps: [],
  model: "",
  reasoning: "",
  permission: "",
  workspacePath: "",
  threadId: "",
  artifactPaths: [],
  finalMessages: []
};

try {
  await command("Page.enable");
  await command("Page.bringToFront");
  await waitFor("login or authenticated workspace", `Boolean(
    document.querySelector('input[type="email"]')
    || document.querySelector('[data-testid="new-chat-button"]')
  )`);

  if (await evaluate(`Boolean(document.querySelector('input[type="email"]'))`)) {
    assert.equal(await setInput('input[type="email"]', email), true);
    assert.equal(await setInput('input[type="password"]', password), true);
    await evaluate(`(() => {
      const agreement = document.querySelector("[data-login-agreement]");
      if (agreement instanceof HTMLInputElement && !agreement.checked) agreement.click();
      return true;
    })()`);
    evidence.screenshots.push(await screenshot("01-login-filled"));
    await visiblePause();
    await evaluate(`document.querySelector(".login-submit-btn")?.click()`);
  }
  await waitFor("authenticated workspace", `Boolean(document.querySelector('[data-testid="new-chat-button"]'))`, 120_000);
  evidence.steps.push("login");
  await visiblePause();

  await evaluate(`document.querySelector('button[aria-label="添加项目"]')?.click()`);
  await waitFor("new blank project menu", `[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("新建空白项目"))`);
  await evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent?.includes("新建空白项目"))?.click()`);
  await waitFor("project name dialog", `Boolean(document.querySelector(".project-name-dialog input"))`);
  assert.equal(await setInput(".project-name-dialog input", projectName), true);
  await evaluate(`document.querySelector(".project-name-dialog")?.requestSubmit()`);
  await waitFor("created project", `[...document.querySelectorAll(".project-group")].some((item) => item.textContent?.includes(${JSON.stringify(projectName)}))`);
  evidence.screenshots.push(await screenshot("02-project-created"));
  evidence.steps.push("project-created");
  await visiblePause();

  await evaluate(`(() => {
    const project = [...document.querySelectorAll(".project-group")].find((item) => item.textContent?.includes(${JSON.stringify(projectName)}));
    project?.querySelector('[data-testid="project-new-thread-button"]')?.click();
    return Boolean(project);
  })()`);
  await waitFor("project conversation composer", `document.querySelector(".task-title")?.textContent?.includes("新建项目对话") || Boolean(document.querySelector('[data-testid="composer-input"]'))`);
  evidence.steps.push("project-thread-mode");

  await evaluate(`document.querySelector('[data-testid="composer-permission-button"]')?.click()`);
  await waitFor("full permission option", `Boolean(document.querySelector('[data-testid="permission-option-full"]'))`);
  await evaluate(`document.querySelector('[data-testid="permission-option-full"]')?.click()`);
  evidence.permission = await evaluate(`document.querySelector('[data-testid="composer-permission-button"]')?.getAttribute("data-permission-mode") || ""`);
  assert.equal(evidence.permission, "full");

  await evaluate(`document.querySelector(".composer-reasoning-button")?.click()`);
  await waitFor("reasoning menu", `Boolean(document.querySelector(".composer-reasoning-menu"))`);
  await evaluate(`(() => {
    const menu = document.querySelector(".composer-reasoning-menu");
    const low = [...menu.querySelectorAll("button")].find((button) => button.querySelector("strong")?.textContent?.trim() === "低");
    low?.click();
    return Boolean(low);
  })()`);
  await evaluate(`document.querySelector(".composer-reasoning-button")?.click()`);
  await waitFor("model menu", `Boolean(document.querySelector(".composer-reasoning-menu"))`);
  await evaluate(`(() => {
    const trigger = [...document.querySelectorAll(".composer-reasoning-menu .composer-submenu-trigger")]
      .find((button) => !button.textContent?.includes("速度"));
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await waitFor("DeepSeek model option", `[...document.querySelectorAll(".composer-model-submenu button")].some((button) => /deepseek/i.test(button.textContent || ""))`);
  evidence.model = await evaluate(`(() => {
    const option = [...document.querySelectorAll(".composer-model-submenu button")].find((button) => /deepseek/i.test(button.textContent || ""));
    const label = option?.textContent?.trim() || "";
    option?.click();
    return label;
  })()`);
  assert.match(evidence.model, /deepseek/i);
  evidence.reasoning = "low";
  evidence.screenshots.push(await screenshot("03-model-permission-selected"));
  evidence.steps.push("full-deepseek-low");
  await visiblePause();

  let assistantCount = await evaluate(`document.querySelectorAll(".assistant-block").length`);
  await sendMessage("你好");
  await waitForTurnComplete(assistantCount);
  evidence.steps.push("hello-completed");
  evidence.screenshots.push(await screenshot("04-hello-completed"));
  await visiblePause();

  assistantCount = await evaluate(`document.querySelectorAll(".assistant-block").length`);
  await sendMessage("请在当前项目中输出一个测试 DOCX 文件，文件名为 test.docx，正文写入：NewBrain 自动化测试文档。");
  await waitFor("document request running", `Boolean(document.querySelector(".composer-busy-note, .conversation-turn.current"))`, 30_000);
  evidence.steps.push("doc-request-running");

  await sendMessage("hello你好！");
  await waitFor("queued item", `Boolean(document.querySelector(".composer-queue-item"))`, 30_000);
  assert.match(await evaluate(`document.querySelector(".composer-queue-item .composer-queue-text")?.textContent || ""`), /hello你好/);
  evidence.screenshots.push(await screenshot("05-guidance-queued"));
  await visiblePause();
  await evaluate(`document.querySelector('.composer-queue-item button[aria-label="立即发送"]')?.click()`);
  await waitFor("guidance accepted", `!document.querySelector(".composer-queue")`, 30_000);
  evidence.steps.push("send-now-clicked");

  await waitForTurnComplete(assistantCount, 240_000);
  evidence.steps.push("doc-and-guidance-completed");
  evidence.screenshots.push(await screenshot("06-doc-guidance-completed"));
  await visiblePause();

  assistantCount = await evaluate(`document.querySelectorAll(".assistant-block").length`);
  await sendMessage("LPP");
  await waitForTurnComplete(assistantCount);
  evidence.steps.push("lpp-completed");
  evidence.screenshots.push(await screenshot("07-lpp-completed"));
  await visiblePause();

  const state = await evaluate(`(async () => {
    const catalog = await window.newbrain.listWorkspaces();
    const workspace = catalog.find((item) => item.name === ${JSON.stringify(projectName)});
    const snapshot = await window.newbrain.getSnapshot();
    return {
      workspacePath: workspace?.path || "",
      threadId: workspace?.threads?.at(-1)?.id || "",
      messages: snapshot?.messages?.map((message) => ({ role: message.role, content: message.content })) || [],
      artifactPaths: [...document.querySelectorAll("[data-local-file-path]")]
        .map((element) => decodeURIComponent(element.getAttribute("data-local-file-path") || ""))
    };
  })()`);
  evidence.workspacePath = state.workspacePath;
  evidence.threadId = state.threadId;
  evidence.finalMessages = state.messages;
  evidence.artifactPaths = state.artifactPaths;
  const docRequestIndex = state.messages.findIndex(
    (message) => message.role === "user" && /test\.docx/i.test(message.content)
  );
  const docAssistantMessage = state.messages
    .slice(docRequestIndex + 1)
    .find((message) => message.role === "assistant")?.content || "";
  assert.ok(state.messages.some((message) => message.role === "user" && message.content === "你好"));
  assert.ok(state.messages.some((message) => message.role === "user" && message.content.includes("测试 DOCX")));
  assert.ok(state.messages.some((message) => message.role === "user" && message.content === "LPP"));
  assert.match(docAssistantMessage, /test\.docx/i);
  assert.doesNotMatch(docAssistantMessage, /中断|是否.*创建|需要我现在.*创建/i);
  assert.ok(
    state.artifactPaths.some((path) => /test\.docx$/i.test(path)),
    `Expected a visible test.docx artifact, received: ${JSON.stringify(state.artifactPaths)}`
  );

  const evidencePath = join(artifactRoot, "evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, evidencePath, evidence }, null, 2)}\n`);
  if (keepOpenMs > 0) {
    process.stdout.write(`Keeping the visible NewBrain window open for ${keepOpenMs}ms.\n`);
    await sleep(keepOpenMs);
  }
} finally {
  socket.close();
  child.kill();
  await sleep(500);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (process.env.NEWBRAIN_E2E_PRESERVE_PROFILE !== "1") {
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

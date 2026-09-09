#!/usr/bin/env node
/**
 * Real-login game deliverable E2E:
 * login → game scene → BRAIN conversation → model writes playable mini web game → preview.
 *
 * Env:
 *   NEWBRAIN_E2E_LOGIN_EMAIL / NEWBRAIN_E2E_LOGIN_PASSWORD (required)
 *   NEWBRAIN_E2E_SKIP_EMAIL_CAPTCHA=1 (default in script; allows password-first E2E login)
 *   NEWBRAIN_E2E_LOGIN_CAPTCHA (optional fallback when gateway enforces email code login)
 *   NEWBRAIN_E2E_REUSE_LOGIN=1 (reuse ~/.newbrain session; skips captcha when already logged in)
 *   NEWBRAIN_E2E_PROFILE_PATH (optional explicit profile directory)
 *   NEWBRAIN_E2E_VISIBLE_STEP_DELAY_MS (optional, default 800 for visible mouse-less UI steps)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const email = process.env.NEWBRAIN_E2E_LOGIN_EMAIL?.trim();
const password = process.env.NEWBRAIN_E2E_LOGIN_PASSWORD?.trim();
assert.ok(email && password, "NEWBRAIN_E2E_LOGIN_EMAIL and NEWBRAIN_E2E_LOGIN_PASSWORD are required.");

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const desktopRoot = process.env.NEWBRAIN_E2E_APP_DIRECTORY?.trim() || resolve(scriptDir, "..");
const electron = join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
assert.equal(existsSync(electron), true, `Electron executable is missing: ${electron}`);

const visibleStepDelayMs = Math.max(0, Number.parseInt(process.env.NEWBRAIN_E2E_VISIBLE_STEP_DELAY_MS || "800", 10) || 0);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const projectName = `BRAIN小游戏${runId.slice(11, 19)}`;
const reuseLogin = process.env.NEWBRAIN_E2E_REUSE_LOGIN === "1";
const configuredProfile = process.env.NEWBRAIN_E2E_PROFILE_PATH?.trim();
const profileRoot = configuredProfile
  || (reuseLogin ? join(homedir(), ".newbrain") : mkdtempSync(join(tmpdir(), "newbrain-game-deliverable-")));
const removeProfileAfterRun = !configuredProfile && !reuseLogin && process.env.NEWBRAIN_E2E_PRESERVE_PROFILE !== "1";
const artifactRoot = resolve(desktopRoot, "../../../docs/evidence/scene-tests/game-deliverable", runId);
mkdirSync(artifactRoot, { recursive: true });
const debugPort = 19_500 + (process.pid % 8_000);

// Never inherit E2E auth bypass from the parent shell — real login is mandatory.
delete process.env.NEWBRAIN_E2E_AUTH_BYPASS;
delete process.env.NEWBRAIN_E2E_AUTH_TOKEN;

const childEnv = { ...process.env };
delete childEnv.NEWBRAIN_E2E_AUTH_BYPASS;
delete childEnv.NEWBRAIN_E2E_AUTH_TOKEN;
childEnv.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = String(debugPort);
childEnv.NEWBRAIN_WORKSPACE_PATH = profileRoot;
childEnv.NEWBRAIN_E2E_AUTH_BYPASS = "0";
childEnv.NEWBRAIN_E2E_SKIP_EMAIL_CAPTCHA = "1";
if (process.env.NEWBRAIN_E2E_LOGIN_CAPTCHA?.trim()) {
  childEnv.NEWBRAIN_E2E_LOGIN_CAPTCHA = process.env.NEWBRAIN_E2E_LOGIN_CAPTCHA.trim();
}

const child = spawn(electron, ["."], {
  cwd: desktopRoot,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false
});

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const visiblePause = () => (visibleStepDelayMs > 0 ? sleep(visibleStepDelayMs) : Promise.resolve());

async function readPages() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

const pageDeadline = Date.now() + 45_000;
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
function command(method, params = {}, timeoutMs = 45_000) {
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

async function evaluate(expression, timeoutMs = 45_000) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  return result.result?.value;
}

async function readUiDiagnostics() {
  return evaluate(`(() => {
    const authEmail = [...document.querySelectorAll(".sidebar-footer *, .account-label *, .user-email")].map((n) => n.textContent || "").join(" ");
    const chatStatus = document.querySelector(".chat-status, .local-mode")?.textContent?.trim() || "";
    const errorBanner = document.querySelector(".error-banner")?.textContent?.trim() || "";
    const busy = Boolean(document.querySelector(".brain-chat-working, .composer-card.busy"));
    const assistantCount = document.querySelectorAll(".brain-chat-message.assistant").length;
    const userCount = document.querySelectorAll(".brain-chat-message.user").length;
    const approval = Boolean(document.querySelector(".composer-approval-banner, .approval-request-banner"));
    return { authEmail, chatStatus, errorBanner, busy, assistantCount, userCount, approval };
  })()`);
}

async function waitFor(label, expression, timeoutMs = 180_000, onPoll) {
  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    polls += 1;
    if (onPoll && polls % 20 === 0) {
      await onPoll(await readUiDiagnostics().catch(() => null));
    }
    await sleep(250);
  }
  const diagnostic = await evaluate(`document.body?.innerText?.slice(0, 2200) || ""`).catch(() => "");
  const ui = await readUiDiagnostics().catch(() => null);
  throw new Error(`Timed out waiting for ${label}: ui=${JSON.stringify(ui)} text=${diagnostic}`);
}

async function screenshot(name) {
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
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

async function sendComposerMessage(message) {
  assert.equal(await setInput('[data-testid="composer-input"]', message), true);
  await waitFor("enabled send button", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute("disabled")`, 30_000);
  await evaluate(`document.querySelector('[data-testid="composer-send-button"]')?.click()`);
}

async function approveNativeDialog() {
  const helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Milliseconds 900; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{LEFT}{ENTER}')"], { windowsHide: true });
  await new Promise((resolvePromise, reject) => {
    helper.once("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`approval helper exited ${code}`))));
    helper.once("error", reject);
  });
}

async function readAuthStatus() {
  return evaluate(`window.newbrain.getAuthStatus().then((auth) => ({
    authenticated: Boolean(auth?.authenticated),
    email: String(auth?.user?.email || auth?.account?.email || "").trim(),
    mode: auth?.mode || "none"
  }))`);
}

async function assertRealAccount(label = "checkpoint") {
  const auth = await readAuthStatus();
  assert.equal(auth?.authenticated, true, `[${label}] not authenticated: ${JSON.stringify(auth)}`);
  assert.equal(auth.email.toLowerCase(), email.toLowerCase(), `[${label}] wrong account: expected ${email}, got ${auth?.email}`);
  assert.notEqual(auth.email.toLowerCase(), "e2e@newbrain.local", `[${label}] E2E bypass account detected`);
  return auth;
}

async function readLoginCaptcha() {
  const fromEnv = process.env.NEWBRAIN_E2E_LOGIN_CAPTCHA?.trim();
  if (fromEnv) return fromEnv;
  const captchaFile = process.env.NEWBRAIN_E2E_LOGIN_CAPTCHA_FILE?.trim();
  if (captchaFile && existsSync(captchaFile)) {
    return readFileSync(captchaFile, "utf8").trim();
  }
  return "";
}

async function waitForLoginCaptcha(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const captcha = await readLoginCaptcha();
    if (captcha) return captcha;
    await sleep(1000);
  }
  return "";
}

async function ensureRealAccountLogin() {
  let auth = await readAuthStatus();
  if (auth?.authenticated && auth.email.toLowerCase() === email.toLowerCase()) {
    evidence.steps.push("session-reused");
    evidence.auth = auth;
    await waitFor("workspace ready", `Boolean(document.querySelector('.brain-workspace-switcher'))`, 300_000);
    return;
  }
  if (auth?.authenticated && auth.email.toLowerCase() !== email.toLowerCase()) {
    await evaluate(`window.newbrain.logoutAuth()`);
    await waitFor("login shell after logout", `Boolean(document.querySelector('input[type="email"]') || document.body?.innerText?.includes('正在检查登录状态'))`, 60_000);
    auth = await readAuthStatus();
  }
  if (!auth?.authenticated || auth.email.toLowerCase() !== email.toLowerCase()) {
    await waitFor("login shell", `Boolean(document.querySelector('input[type="email"]') || document.body?.innerText?.includes('正在检查登录状态'))`, 120_000);
    let loginCaptcha = await readLoginCaptcha();
    if (!loginCaptcha && process.env.NEWBRAIN_E2E_SKIP_EMAIL_CAPTCHA === "1") {
      await evaluate(`window.newbrain.sendLoginCode({ email: ${JSON.stringify(email)} })`);
      evidence.steps.push("login-code-sent");
      process.stderr.write("[game-deliverable] 已发送邮箱验证码；可设置 NEWBRAIN_E2E_LOGIN_CAPTCHA 或 NEWBRAIN_E2E_LOGIN_CAPTCHA_FILE 后自动继续\\n");
      loginCaptcha = await waitForLoginCaptcha(120_000);
    }
    evidence.screenshots.push(await screenshot("01-before-login"));
    await visiblePause();
    const loginResult = await evaluate(`window.newbrain.loginAuth({
      email: ${JSON.stringify(email)},
      password: ${JSON.stringify(password)},
      captcha: ${JSON.stringify(loginCaptcha)},
      agreement_accepted: true
    }).then((auth) => ({
      ok: Boolean(auth?.authenticated),
      email: String(auth?.user?.email || auth?.account?.email || "").trim()
    })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))`);
    assert.equal(loginResult?.ok, true, `loginAuth failed: ${JSON.stringify(loginResult)}`);
    evidence.steps.push(loginCaptcha ? "login-submitted-code" : "login-submitted-ipc");
    await waitFor("login success", `(async () => {
      const auth = await window.newbrain.getAuthStatus();
      return auth.authenticated && String(auth.user?.email || auth.account?.email || "").toLowerCase() === ${JSON.stringify(email.toLowerCase())};
    })()`, 120_000);
  }
  auth = await assertRealAccount("after-login");
  evidence.auth = auth;
  evidence.steps.push("real-account-verified");
  await waitFor("workspace ready", `Boolean(document.querySelector('.brain-workspace-switcher'))`, 300_000);
}

async function waitForProjectBinding(name) {
  return waitFor("project bound to legacy workspace", `(async () => {
    const projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
    const brain = projects.find((item) => item.name === ${JSON.stringify(name)});
    if (!brain?.localWorkspaceId) return false;
    const catalog = await window.newbrain.listWorkspaces();
    const legacy = catalog.find((item) => item.id === brain.localWorkspaceId);
    return Boolean(legacy?.path);
  })()`, 120_000);
}

async function ensureExecutionWorkspace(name) {
  const state = await evaluate(`(async () => {
    const projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
    const brain = projects.find((item) => item.name === ${JSON.stringify(name)});
    const catalog = await window.newbrain.listWorkspaces();
    const legacy = catalog.find((item) => item.id === brain?.localWorkspaceId) || catalog.find((item) => item.name === ${JSON.stringify(name)});
    const header = [...document.querySelectorAll(".projects-section .project-header, .project-list .project-header")].find((el) => (el.textContent || "").includes(${JSON.stringify(name.slice(0, 8))}));
    header?.click();
    return {
      brainProjectId: brain?.id || "",
      localWorkspaceId: brain?.localWorkspaceId || legacy?.id || "",
      localPath: legacy?.path || "",
      clicked: Boolean(header)
    };
  })()`);
  assert.ok(state?.localWorkspaceId, `legacy workspace missing: ${JSON.stringify(state)}`);
  assert.ok(state?.localPath, `legacy workspace path missing: ${JSON.stringify(state)}`);
  return state;
}

async function maybeApproveComposer() {
  const hasApproval = await evaluate(`Boolean(document.querySelector('[data-testid="approval-approve-button"], .approval-request-banner button, .composer-approval-banner button'))`);
  if (!hasApproval) return false;
  await evaluate(`document.querySelector('[data-testid="approval-approve-button"]')?.click() || document.querySelector('.approval-request-banner button')?.click() || document.querySelector('.composer-approval-banner button')?.click()`);
  return true;
}

const evidence = { runId, projectName, requiredEmail: email, steps: [], screenshots: [], deliverable: null };

try {
  await command("Page.enable");
  await command("Page.bringToFront");

  await waitFor("app shell", `Boolean(document.querySelector('input[type="email"]') || document.querySelector('.brain-workspace-switcher') || document.body?.innerText?.includes('正在检查登录状态'))`, 120_000);
  await ensureRealAccountLogin();
  await visiblePause();
  await assertRealAccount("post-login");

  await evaluate(`document.querySelector('.brain-workspace-trigger')?.click()`);
  await waitFor("workspace menu", `Boolean(document.querySelector('.brain-workspace-menu'))`);
  await evaluate(`[...document.querySelectorAll('.brain-workspace-menu button')].find((b) => b.textContent?.includes('游戏制作'))?.click()`);
  await waitFor("game scene", `(() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2')).selectedWorkspaceKey === 'game'; } catch { return false; } })()`);
  evidence.steps.push("game-scene");
  await visiblePause();

  await evaluate(`document.querySelector('.projects-section .project-subsection-head button[aria-label="添加项目"], .projects-section .project-subsection-head button[title="添加项目"]')?.click()`);
  await waitFor("create menu", `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('新建空白项目'))`);
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('新建空白项目'))?.click()`);
  await waitFor("name dialog", `Boolean(document.querySelector('.project-name-dialog input'))`);
  assert.equal(await setInput(".project-name-dialog input", projectName), true);
  await evaluate(`document.querySelector('.project-name-dialog')?.requestSubmit()`);
  await waitFor("brain project visible", `[...document.querySelectorAll('.brain-project-list button span')].some((s) => (s.textContent || '').includes(${JSON.stringify(projectName.slice(0, 8))}))`, 60_000);
  await waitForProjectBinding(projectName);
  evidence.steps.push("project-created");
  evidence.projectBinding = await ensureExecutionWorkspace(projectName);
  evidence.screenshots.push(await screenshot("02-project-created"));
  await visiblePause();
  await assertRealAccount("post-project");

  await waitFor("brain conversation list", `Boolean(document.querySelector('.brain-conversation-list button'))`, 60_000);
  await evaluate(`document.querySelector('.brain-conversation-list button')?.click()`);
  await waitFor("brain composer", `Boolean(document.querySelector('[data-testid="composer-input"]'))`, 30_000);
  evidence.steps.push("brain-conversation");
  await visiblePause();

  evidence.legacyWorkspace = await ensureExecutionWorkspace(projectName);
  evidence.steps.push("legacy-workspace-selected");
  await assertRealAccount("pre-send");

  if (await evaluate(`Boolean(document.querySelector('[data-testid="composer-permission-button"]'))`)) {
    await evaluate(`document.querySelector('[data-testid="composer-permission-button"]')?.click()`);
    await waitFor("full permission", `Boolean(document.querySelector('[data-testid="permission-option-full"]'))`, 15_000);
    await evaluate(`document.querySelector('[data-testid="permission-option-full"]')?.click()`);
    evidence.steps.push("permission-full");
  }

  if (await evaluate(`Boolean(document.querySelector('.composer-reasoning-button'))`)) {
    await evaluate(`document.querySelector('.composer-reasoning-button')?.click()`);
    await waitFor("model menu", `Boolean(document.querySelector('.composer-reasoning-menu'))`, 10_000);
    await evaluate(`(() => {
      const trigger = [...document.querySelectorAll('.composer-reasoning-menu .composer-submenu-trigger')].find((b) => !b.textContent?.includes('速度'));
      trigger?.click();
      return Boolean(trigger);
    })()`);
    await waitFor("deepseek option", `[...document.querySelectorAll('.composer-model-submenu button')].some((b) => /deepseek/i.test(b.textContent || ''))`, 20_000);
    evidence.model = await evaluate(`(() => {
      const option = [...document.querySelectorAll('.composer-model-submenu button')].find((b) => /deepseek/i.test(b.textContent || ''));
      const label = option?.textContent?.trim() || '';
      option?.click();
      return label;
    })()`);
    evidence.steps.push("model-selected");
  }

  const gamePrompt = [
    "请在当前游戏项目中创建一个可本地试玩的小型 HTML5 网页小游戏（例如点击得分或躲避障碍）。",
    "必须把完整源码写入当前项目目录：至少包含 index.html（或 public/index.html）以及 package.json（scripts.start 可启动本地服务器）。",
    "不要只给代码片段，请直接创建/修改项目文件。完成后说明如何试玩。"
  ].join("");

  const assistantBefore = await evaluate(`document.querySelectorAll('.brain-chat-message.assistant').length`);
  await sendComposerMessage(gamePrompt);
  evidence.steps.push("game-request-sent");
  evidence.screenshots.push(await screenshot("03-game-request-sent"));
  await visiblePause();

  await sleep(3000);
  const localOnly = await evaluate(`document.body.innerText.includes('消息已保存在本地') || document.body.innerText.includes('没有可用的模型执行工作区')`);
  assert.equal(localOnly, false, "BRAIN 未调用模型，仅本地保存——请检查工作区绑定与登录会话");

  await waitFor("brain finished game task", `(() => {
    const busy = Boolean(document.querySelector('.brain-chat-working, .composer-card.busy'));
    const localFail = document.body.innerText.includes('消息已保存在本地');
    const count = document.querySelectorAll('.brain-chat-message.assistant').length;
    return !localFail && count > ${assistantBefore} && !busy;
  })()`, 600_000, async (ui) => {
    evidence.progress = evidence.progress || [];
    evidence.progress.push({ at: new Date().toISOString(), ui });
    process.stderr.write(`[game-deliverable] waiting for BRAIN… ${JSON.stringify(ui)}\n`);
    if (ui?.approval) await maybeApproveComposer();
  });
  evidence.steps.push("brain-replied");
  evidence.screenshots.push(await screenshot("04-brain-replied"));
  await visiblePause();

  const state = await evaluate(`(async () => {
    const catalog = await window.newbrain.listWorkspaces();
    const local = catalog.find((item) => item.name === ${JSON.stringify(projectName)});
    const projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
    const brain = projects.find((item) => item.name === ${JSON.stringify(projectName)});
    let inspection = null;
    if (brain?.id && window.newbrain.inspectBrainGameProject) {
      try { inspection = await window.newbrain.inspectBrainGameProject({ projectId: brain.id }); } catch {}
    }
    const assistantText = [...document.querySelectorAll('.brain-chat-message.assistant')].map((n) => n.textContent || '').join('\\n---\\n');
    const artifactPaths = [...document.querySelectorAll('[data-local-file-path]')].map((el) => decodeURIComponent(el.getAttribute('data-local-file-path') || ''));
    return { localPath: local?.path || '', brainProjectId: brain?.id || '', inspection, assistantText, artifactPaths };
  })()`);

  evidence.deliverable = state;
  let workspaceFiles = [];
  if (state.localPath && existsSync(state.localPath)) {
    workspaceFiles = readdirSync(state.localPath);
    if (existsSync(join(state.localPath, "public"))) {
      workspaceFiles.push(...readdirSync(join(state.localPath, "public")).map((name) => `public/${name}`));
    }
  }

  const hasHtml = workspaceFiles.some((name) => /\.html$/i.test(name));
  const hasPackage = workspaceFiles.includes("package.json") || workspaceFiles.includes("server.mjs");
  assert.ok(state.localPath, `missing workspace path: ${JSON.stringify(state)}`);
  assert.ok(hasHtml || hasPackage, `BRAIN did not write game files. Files: ${JSON.stringify(workspaceFiles)} assistant: ${state.assistantText?.slice(0, 400)}`);
  evidence.steps.push("game-files-on-disk");

  await evaluate(`[...document.querySelectorAll('.brain-resource-scene-nav button')].find((b) => b.textContent?.includes('项目与文件'))?.click()`);
  await waitFor("game workspace panel", `Boolean(document.querySelector('[data-testid="brain-game-workspace"]'))`, 30_000);

  if (!state.inspection?.preview?.supported) {
    await waitFor("web engine detected", `document.querySelector('[data-testid="brain-game-engine"]')?.textContent?.includes('Web')`, 30_000);
  }

  const approval = approveNativeDialog();
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('启动试玩'))?.click()`);
  await approval;
  await waitFor("preview ready", `document.querySelector('[data-testid="brain-game-preview-status"]')?.textContent?.includes('可以试玩')`, 90_000);
  evidence.steps.push("preview-ready");
  evidence.screenshots.push(await screenshot("05-preview-ready"));

  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存试玩截图'))?.click()`);
  await waitFor("preview evidence", `Boolean(document.querySelector('[data-testid="brain-game-evidence"]'))`, 30_000);
  evidence.steps.push("preview-evidence");

  const evidencePath = join(artifactRoot, "evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify({ ok: true, evidence, workspaceFiles }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, caseId: "BRAIN-GAME-DELIVERABLE", artifactRoot, evidencePath, workspaceFiles, projectName }, null, 2)}\n`);
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  evidence.screenshots.push(await screenshot("99-failure").catch(() => null));
  writeFileSync(join(artifactRoot, "evidence.json"), `${JSON.stringify({ ok: false, evidence }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  socket.close();
  child.kill();
  await sleep(800);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (removeProfileAfterRun) {
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

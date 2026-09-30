import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const execFileAsync = promisify(execFile);
const ffmpeg = process.env.BRAIN_FFMPEG_BINARY || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = process.env.BRAIN_FFPROBE_BINARY || (process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9335);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      } else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const diagnostics = await evaluate(`JSON.stringify({ text: document.body?.innerText?.slice(0, 1600), selection: localStorage.getItem('brain.workspaceSelection.v2') })`).catch(() => "");
  throw new Error(`Timed out waiting for ${expression}: ${diagnostics}`);
}
async function approveNativeDialog() {
  // MessageBox defaults to "取消" (index 1); LEFT focuses "开始渲染", ENTER confirms.
  const helper = spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Start-Sleep -Milliseconds 900; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{LEFT}{ENTER}')"
  ], { windowsHide: true });
  await new Promise((resolve, reject) => {
    helper.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Approval key helper exited ${code}`)));
    helper.once("error", reject);
  });
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function prepareMediaWorkspace(kind) {
  const root = await mkdtemp(join(tmpdir(), `brain-${kind}-ui-`));
  await mkdir(join(root, "media"), { recursive: true });
  await mkdir(join(root, "renders"), { recursive: true });
  if (kind === "video") {
    const input = join(root, "media", "input.mp4");
    await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "0.5", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", input], { windowsHide: true, maxBuffer: 1_048_576 });
    const meta = await stat(input);
    return { root, storageKey: "media/input.mp4", logicalName: "input.mp4", mimeType: "video/mp4", sizeBytes: meta.size, contentHash: await sha256File(input) };
  }
  const input = join(root, "media", "take.wav");
  await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.5", input], { windowsHide: true, maxBuffer: 1_048_576 });
  const meta = await stat(input);
  return { root, storageKey: "media/take.wav", logicalName: "take.wav", mimeType: "audio/wav", sizeBytes: meta.size, contentHash: await sha256File(input) };
}

async function seedBrainProject(kind, fixture) {
  const title = kind === "video" ? "视频渲染验收" : "音乐渲染验收";
  const projectName = kind === "video" ? "BRAIN Video E2E" : "BRAIN Music E2E";
  return evaluate(`(async () => {
    const path = ${JSON.stringify(fixture.root)};
    const workspaceKey = ${JSON.stringify(kind)};
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: ${JSON.stringify(projectName)}, path });
    const local = catalog.find((item) => item.path === path);
    if (!local) return { ok: false, reason: "workspace-missing" };
    let projects = await window.newbrain.listBrainProjects({ workspaceKey });
    let project = projects.find((item) => item.name === ${JSON.stringify(projectName)});
    if (!project) project = await window.newbrain.createBrainProject({ name: ${JSON.stringify(projectName)}, primaryWorkspaceKey: workspaceKey, localWorkspaceId: local.id });
    else project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
    let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey });
    let conversation = conversations[0];
    if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey, title: ${JSON.stringify(title)} });
    const files = await window.newbrain.listBrainFiles({ projectId: project.id });
    let file = files.find((item) => item.storageKey === ${JSON.stringify(fixture.storageKey)});
    if (!file) {
      file = await window.newbrain.registerBrainFile({
        projectId: project.id,
        logicalName: ${JSON.stringify(fixture.logicalName)},
        mimeType: ${JSON.stringify(fixture.mimeType)},
        sizeBytes: ${fixture.sizeBytes},
        contentHash: ${JSON.stringify(fixture.contentHash)},
        storageKey: ${JSON.stringify(fixture.storageKey)}
      });
    }
    if (workspaceKey === "video") {
      await window.newbrain.saveVideoTimeline({ projectId: project.id, title: "E2E Timeline", width: 160, height: 90, fps: 10 });
    } else {
      await window.newbrain.saveMusicTimeline({ projectId: project.id, title: "E2E Mix", sampleRate: 48000, channels: 2 });
    }
    localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({
      version: 2,
      selectedWorkspaceKey: workspaceKey,
      catalogs: { [workspaceKey]: { projectId: project.id, conversationId: conversation.id } }
    }));
    location.reload();
    return { ok: true, projectId: project.id, conversationId: conversation.id, fileId: file.id };
  })()`);
}

async function waitForReloadReady() {
  await waitFor(`Boolean(document.querySelector('[data-testid="new-chat-button"]') || document.querySelector('.brain-workspace-trigger') || document.querySelector('.brain-conversation-list'))`, 30_000);
}

async function openSceneTab(kind, conversationTitle, tabLabel) {
  const workspaceLabel = kind === "video" ? "视频制作" : "音乐创作";
  await evaluate(`(() => {
    const trigger = document.querySelector('.brain-workspace-trigger');
    if (trigger && !trigger.getAttribute('aria-expanded')?.includes('true')) trigger.click();
    return Boolean(trigger);
  })()`);
  await waitFor(`Boolean([...document.querySelectorAll('.brain-workspace-menu [role="menuitemradio"]')].find((button) => button.textContent?.includes(${JSON.stringify(workspaceLabel)})))`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.brain-workspace-menu [role="menuitemradio"]')].find((item) => item.textContent?.includes(${JSON.stringify(workspaceLabel)}));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(`Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((button) => button.textContent?.includes(${JSON.stringify(conversationTitle)})))`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes(${JSON.stringify(conversationTitle)}));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(`Boolean([...document.querySelectorAll('.brain-resource-panel nav button')].find((button) => button.textContent?.trim() === ${JSON.stringify(tabLabel)}))`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.brain-resource-panel nav button')].find((item) => item.textContent?.trim() === ${JSON.stringify(tabLabel)});
    button?.click();
    return Boolean(button);
  })()`);
}

async function openWorkspaceTab(kind, conversationTitle, tabLabel) {
  await openSceneTab(kind, conversationTitle, tabLabel);
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(kind === "video" ? '[data-testid="brain-video-workspace"]' : '[data-testid="brain-music-workspace"]')}))`);
}

async function runStoryboardFlow(fileId) {
  await openSceneTab("video", "视频渲染验收", "分镜");
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-video-storyboard"]'))`);
  await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="brain-video-storyboard"]');
    if (!panel) return false;
    const add = [...panel.querySelectorAll('button')].find((button) => button.textContent?.includes('添加镜头'));
    add?.click();
    add?.click();
    return Boolean(add);
  })()`);
  await waitFor(`document.querySelectorAll('[data-testid="brain-video-storyboard"] tbody tr').length >= 3`);
  const configured = await evaluate(`((fileId) => {
    const rows = [...document.querySelectorAll('[data-testid="brain-video-storyboard"] tbody tr')];
    rows.slice(0, 3).forEach((row, index) => {
      const shot = row.querySelector('td:nth-child(1) input');
      const visual = row.querySelector('td:nth-child(2) input');
      const duration = row.querySelector('td:nth-child(3) input');
      const asset = row.querySelector('td:nth-child(4) select');
      if (shot instanceof HTMLInputElement) {
        shot.value = String(index + 1);
        shot.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (visual instanceof HTMLInputElement) {
        visual.value = \`镜头 \${index + 1}\`;
        visual.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (duration instanceof HTMLInputElement) {
        duration.value = '500';
        duration.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (asset instanceof HTMLSelectElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(asset, fileId);
        asset.dispatchEvent(new Event('input', { bubbles: true }));
        asset.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    return rows.slice(0, 3).every((row) => row.querySelector('td:nth-child(4) select')?.value === fileId);
  })(${JSON.stringify(fileId)})`);
  assert.equal(configured, true, "storyboard rows missing asset selection");
  await evaluate(`document.querySelector('[data-testid="brain-video-storyboard-push"]')?.click()`);
  await waitFor(`document.querySelector('[data-testid="brain-video-storyboard"]')?.textContent?.includes('3 个镜头')`);
  await openSceneTab("video", "视频渲染验收", "时间线");
  await waitFor(`document.querySelectorAll('.brain-video-clip').length >= 3`);
  const storyboard = await evaluate(`(() => ({
    clipCount: document.querySelectorAll('.brain-video-clip').length,
    timelineMeta: document.querySelector('[data-testid="brain-video-timeline-meta"]')?.textContent || '',
    status: document.querySelector('[data-testid="brain-video-storyboard"]')?.textContent || ''
  }))()`);
  assert.ok(storyboard.clipCount >= 3, JSON.stringify(storyboard));
  assert.match(storyboard.timelineMeta, /2 秒|1 秒|秒/);
  return storyboard;
}

async function runVideoFlow() {
  const fixture = await prepareMediaWorkspace("video");
  const seeded = await seedBrainProject("video", fixture);
  assert.equal(seeded?.ok, true, `video seed failed: ${JSON.stringify(seeded)}`);
  await waitForReloadReady();
  const storyboard = await runStoryboardFlow(seeded.fileId);
  await openWorkspaceTab("video", "视频渲染验收", "项目与素材");
  await waitFor(`document.querySelector('[data-testid="brain-video-status"]')?.textContent?.includes('时间线已保存')`);
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-video-file-select"] option[value]:not([value=""])'))`);
  const selected = await evaluate(`(() => {
    const select = document.querySelector('[data-testid="brain-video-file-select"]');
    if (!(select instanceof HTMLSelectElement)) return "";
    const option = [...select.options].find((item) => item.value);
    if (!option) return "";
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, option.value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value;
  })()`);
  assert.ok(selected, "video file select has no option");
  await evaluate(`(() => {
    const button = document.querySelector('[data-testid="brain-video-add-clip"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  await waitFor(`document.querySelector('[data-testid="brain-video-status"]')?.textContent?.includes('片段已加入') || document.querySelectorAll('.brain-video-clip').length > 0`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.brain-resource-panel nav button')].find((item) => item.textContent?.trim() === "导出");
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(`!document.querySelector('[data-testid="brain-video-render"]')?.disabled`);
  const approval = approveNativeDialog();
  await evaluate(`document.querySelector('[data-testid="brain-video-render"]')?.click()`);
  await approval;
  await waitFor(`document.querySelector('[data-testid="brain-video-status"]')?.textContent?.includes('视频渲染完成')`, 90_000);
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-video-preview-result"]'))`);
  const observation = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="brain-video-workspace"]');
    const preview = document.querySelector('[data-testid="brain-video-preview"]');
    const result = document.querySelector('[data-testid="brain-video-preview-result"]');
    return {
      visible: Boolean(root && root.getBoundingClientRect().width > 200),
      previewVisible: Boolean(preview && preview.getBoundingClientRect().width > 40),
      previewReady: Boolean(result?.textContent?.includes('渲染预览就绪')),
      previewText: result?.textContent || "",
      status: document.querySelector('[data-testid="brain-video-status"]')?.textContent || "",
      timeline: document.querySelector('[data-testid="brain-video-timeline-meta"]')?.textContent || "",
      outputFileId: document.querySelector('[data-testid="brain-video-output-file-id"]')?.textContent || "",
      bodyHasError: document.body.innerText.includes("A JavaScript error occurred in the main process")
    };
  })()`);
  assert.equal(observation.visible, true, JSON.stringify(observation));
  assert.equal(observation.previewVisible, true, JSON.stringify(observation));
  assert.equal(observation.previewReady, true, JSON.stringify(observation));
  assert.match(observation.status, /视频渲染完成/);
  assert.notEqual(observation.outputFileId, "无产物编号");
  assert.equal(observation.bodyHasError, false);
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmpdir(), "brain-video-workspace-preview.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  return { observation, screenshotPath, fixtureRoot: fixture.root, storyboard };
}

async function runMusicFlow() {
  const fixture = await prepareMediaWorkspace("music");
  const seeded = await seedBrainProject("music", fixture);
  assert.equal(seeded?.ok, true, `music seed failed: ${JSON.stringify(seeded)}`);
  await waitForReloadReady();
  await openWorkspaceTab("music", "音乐渲染验收", "项目与音频");
  await waitFor(`document.querySelector('[data-testid="brain-music-status"]')?.textContent?.includes('时间线已加载')`);
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-music-file-select"] option[value]:not([value=""])'))`);
  const selected = await evaluate(`(() => {
    const select = document.querySelector('[data-testid="brain-music-file-select"]');
    if (!(select instanceof HTMLSelectElement)) return "";
    const option = [...select.options].find((item) => item.value);
    if (!option) return "";
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, option.value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value;
  })()`);
  assert.ok(selected, "music file select has no option");
  await evaluate(`(() => {
    const button = document.querySelector('[data-testid="brain-music-add-audio"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  await waitFor(`document.querySelector('[data-testid="brain-music-status"]')?.textContent?.includes('音频片段已加入') || document.querySelectorAll('.brain-music-module .brain-video-clip').length > 0`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.brain-resource-panel nav button')].find((item) => item.textContent?.trim() === "导出");
    button?.click();
    return Boolean(button);
  })()`);
  const approval = approveNativeDialog();
  await evaluate(`document.querySelector('[data-testid="brain-music-render"]')?.click()`);
  await approval;
  await waitFor(`document.querySelector('[data-testid="brain-music-status"]')?.textContent?.includes('音乐渲染完成')`, 90_000);
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-music-preview-result"]'))`);
  await waitFor(`Boolean(document.querySelector('[data-testid="brain-music-output-file-id"]')?.textContent?.trim())`, 20_000);
  await waitFor(`(() => {
    const audio = document.querySelector('[data-testid="brain-music-audio-preview"]');
    if (!(audio instanceof HTMLAudioElement)) return false;
    if (!audio.src) return false;
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA || audio.duration > 0) return true;
    audio.load();
    return false;
  })()`, 20_000);
  const observation = await evaluate(`(() => {
    const root = document.querySelector('[data-testid="brain-music-workspace"]');
    const preview = document.querySelector('[data-testid="brain-music-preview"]');
    const result = document.querySelector('[data-testid="brain-music-preview-result"]');
    const audio = document.querySelector('[data-testid="brain-music-audio-preview"]');
    return {
      visible: Boolean(root && root.getBoundingClientRect().width > 200),
      previewVisible: Boolean(preview && preview.getBoundingClientRect().height > 20),
      previewReady: Boolean(result?.textContent?.includes('混音预览就绪')),
      outputFileId: document.querySelector('[data-testid="brain-music-output-file-id"]')?.textContent || "",
      audioReady: Boolean(audio instanceof HTMLAudioElement),
      audioPlayable: Boolean(audio instanceof HTMLAudioElement && Boolean(audio.src) && (audio.readyState >= HTMLMediaElement.HAVE_METADATA || audio.duration > 0)),
      mediaInfo: document.querySelector('[data-testid="brain-music-media-info"]')?.textContent || "",
      status: document.querySelector('[data-testid="brain-music-status"]')?.textContent || "",
      renderState: document.querySelector('[data-testid="brain-music-render-state"]')?.textContent || "",
      bodyHasError: document.body.innerText.includes("A JavaScript error occurred in the main process")
    };
  })()`);
  assert.equal(observation.visible, true);
  assert.equal(observation.previewVisible, true);
  assert.equal(observation.previewReady, true);
  assert.match(observation.status, /音乐渲染完成/);
  assert.match(observation.renderState, /SUCCEEDED/);
  assert.notEqual(observation.outputFileId, "无产物编号");
  assert.equal(observation.audioReady, true, JSON.stringify(observation));
  assert.equal(observation.audioPlayable, true, JSON.stringify(observation));
  assert.match(observation.mediaInfo, /Hz/, JSON.stringify(observation));
  assert.equal(observation.bodyHasError, false);
  const mediaInspect = await evaluate(`(async () => {
    const selection = JSON.parse(localStorage.getItem('brain.workspaceSelection.v2') || '{}');
    const projectId = selection.catalogs?.music?.projectId;
    const fileId = document.querySelector('[data-testid="brain-music-output-file-id"]')?.textContent?.trim();
    if (!projectId || !fileId || !window.newbrain?.inspectMusicMedia) return null;
    return window.newbrain.inspectMusicMedia({ projectId, sourceFileId: fileId });
  })()`);
  assert.ok(mediaInspect?.durationMs > 0, JSON.stringify(mediaInspect));
  assert.ok(mediaInspect?.sampleRate > 0, JSON.stringify(mediaInspect));
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmpdir(), "brain-music-workspace-preview.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  return { observation, mediaInspect, screenshotPath, fixtureRoot: fixture.root };
}

async function probeDuration(path) {
  const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { windowsHide: true });
  return Number(stdout.trim());
}

try {
  await execFileAsync(ffmpeg, ["-version"], { windowsHide: true });
} catch {
  console.error("FFmpeg is required for video/music UI E2E.");
  process.exit(1);
}

await evaluate(`(() => {
  const backToApp = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('返回应用'));
  if (backToApp instanceof HTMLButtonElement) backToApp.click();
  return true;
})()`);
await waitFor(`Boolean(document.querySelector('[data-testid="new-chat-button"]') || document.querySelector('.brain-workspace-trigger'))`, 20_000);

const video = await runVideoFlow();
const music = await runMusicFlow();
if (video.fixtureRoot) {
  const outputPath = join(video.fixtureRoot, "renders", "output.mp4");
  const inputPath = join(video.fixtureRoot, "media", "input.mp4");
  const outputDuration = await probeDuration(outputPath);
  const inputDuration = await probeDuration(inputPath);
  assert.ok(Math.abs(outputDuration - inputDuration) < 0.35, JSON.stringify({ outputDuration, inputDuration }));
}
if (music.fixtureRoot) {
  const outputPath = join(music.fixtureRoot, "renders", "mix-output.wav");
  const outputDuration = await probeDuration(outputPath);
  assert.ok(outputDuration > 0.4 && outputDuration < 0.7, JSON.stringify({ outputDuration }));
  if (music.mediaInspect?.durationMs) {
    assert.ok(Math.abs(music.mediaInspect.durationMs / 1000 - outputDuration) < 0.2, JSON.stringify({ outputDuration, mediaInspect: music.mediaInspect }));
  }
}
console.log(JSON.stringify({ ok: true, caseId: "BRAIN-MEDIA-WORKSPACE-E2E", video, music }, null, 2));
socket.close();
await session.close();

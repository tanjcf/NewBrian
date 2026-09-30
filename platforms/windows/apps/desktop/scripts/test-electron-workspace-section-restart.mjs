import assert from "node:assert/strict";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9348);

async function connect(session) {
  const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert.ok(page, "No debuggable Electron renderer page was found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const command = (method, params = {}, testDeadlineMs = 30_000) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`E2E ${method} did not respond.`)), testDeadlineMs);
      const listener = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        if (payload.error || payload.result?.exceptionDetails) {
          reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text));
        } else resolve(payload.result);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const waitFor = async (label, expression, testDeadlineMs = 30_000) => {
    const deadline = Date.now() + testDeadlineMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const detail = await evaluate("document.body?.innerText?.slice(0, 1800) || ''").catch(() => "");
    throw new Error(`E2E did not reach ${label}. Renderer: ${detail}`);
  };
  const closeApplication = async () => {
    socket.send(JSON.stringify({ id: ++nextId, method: "Browser.close", params: {} }));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
        if (!response.ok) return;
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Electron did not exit after the application close request.");
  };
  return { socket, command, evaluate, waitFor, closeApplication };
}

async function seedProjects(evaluate) {
  return evaluate(`(async () => {
    const localWorkspace = (await window.newbrain.listWorkspaces())[0];
    if (!localWorkspace?.id) throw new Error("E2E local workspace is unavailable");
    const definitions = [
      { workspaceKey: "game", name: "场景编辑验收 游戏 A", title: "游戏 A 对话" },
      { workspaceKey: "game", name: "场景编辑验收 游戏 B", title: "游戏 B 对话" },
      { workspaceKey: "video", name: "场景编辑验收 视频", title: "视频对话" },
      { workspaceKey: "music", name: "场景编辑验收 音乐", title: "音乐对话" },
      { workspaceKey: "quant", name: "场景编辑验收 量化", title: "量化对话" },
      { workspaceKey: "data", name: "场景编辑验收 数据", title: "数据对话" },
      { workspaceKey: "software", name: "场景编辑验收 软件", title: "软件对话" },
      { workspaceKey: "document", name: "场景编辑验收 文档", title: "文档对话" }
    ];
    const result = {};
    for (const definition of definitions) {
      let projects = await window.newbrain.listBrainProjects({ workspaceKey: definition.workspaceKey, includeArchived: true });
      let project = projects.find((item) => item.name === definition.name);
      if (!project) project = await window.newbrain.createBrainProject({ name: definition.name, primaryWorkspaceKey: definition.workspaceKey, ...(definition.workspaceKey === "software" ? { localWorkspaceId: localWorkspace.id } : {}) });
      else if (definition.workspaceKey === "software") project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: localWorkspace.id });
      let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: definition.workspaceKey, includeArchived: true });
      let conversation = conversations.find((item) => item.title === definition.title);
      if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: definition.workspaceKey, title: definition.title });
      result[definition.name] = { projectId: project.id, conversationId: conversation.id, workspaceKey: definition.workspaceKey };
    }
    return result;
  })()`);
}

async function assertSceneCatalog(evaluate, waitFor, scene) {
  await selectCatalog(evaluate, waitFor, scene.workspaceKey, scene.projectId, scene.conversationId);
  await waitFor(`${scene.name} project`, `Boolean([...document.querySelectorAll('.brain-project-list button')].find((button) => button.textContent?.includes(${JSON.stringify(scene.name)})))`);
  await waitFor(`${scene.title} conversation`, `Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((button) => button.textContent?.includes(${JSON.stringify(scene.title)})))`);
  const visibleCatalog = await evaluate(`({
    projects: [...document.querySelectorAll('.brain-project-list button')].map((button) => button.textContent || ''),
    conversations: [...document.querySelectorAll('.brain-conversation-list button')].map((button) => button.textContent || '')
  })`);
  assert.equal(visibleCatalog.projects.some((value) => value.includes(scene.name)), true);
  assert.equal(visibleCatalog.conversations.some((value) => value.includes(scene.title)), true);
  for (const foreign of scene.allScenes) {
    if (foreign.workspaceKey === scene.workspaceKey) continue;
    assert.equal(visibleCatalog.projects.some((value) => value.includes(foreign.name)), false, `${foreign.name} leaked into ${scene.workspaceKey}`);
    assert.equal(visibleCatalog.conversations.some((value) => value.includes(foreign.title)), false, `${foreign.title} leaked into ${scene.workspaceKey}`);
  }
}

async function selectCatalog(evaluate, waitFor, workspaceKey, projectId, conversationId) {
  await evaluate(`(() => {
    const current = JSON.parse(localStorage.getItem("brain.workspaceSelection.v2") || '{"version":2,"catalogs":{}}');
    current.version = 2;
    current.selectedWorkspaceKey = ${JSON.stringify(workspaceKey)};
    current.catalogs = { ...(current.catalogs || {}), [${JSON.stringify(workspaceKey)}]: { projectId: ${JSON.stringify(projectId)}, conversationId: ${JSON.stringify(conversationId)} } };
    localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify(current));
    location.reload();
    return true;
  })()`);
  await waitFor("selected conversation list", "Boolean(document.querySelector('.brain-conversation-list'))");
}

async function openProjectAndSection(evaluate, waitFor, projectName, conversationTitle, tabLabel, sectionKey) {
  await waitFor(`${projectName} project`, `Boolean([...document.querySelectorAll('.brain-project-list button')].find((button) => button.textContent?.includes(${JSON.stringify(projectName)})))`);
  await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-project-list button')].find((item) => item.textContent?.includes(${JSON.stringify(projectName)})); button?.click(); return Boolean(button); })()`);
  await waitFor(`${conversationTitle} conversation`, `Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((button) => button.textContent?.includes(${JSON.stringify(conversationTitle)})))`);
  await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes(${JSON.stringify(conversationTitle)})); button?.click(); return Boolean(button); })()`);
  await waitFor(`${tabLabel} tab`, `Boolean([...document.querySelectorAll('.brain-resource-scene-nav button')].find((button) => button.textContent?.trim() === ${JSON.stringify(tabLabel)}))`);
  await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === ${JSON.stringify(tabLabel)}); button?.click(); return Boolean(button); })()`);
  await waitFor(`${sectionKey} editor`, `Boolean(document.querySelector('[data-testid="brain-section-${sectionKey}"] textarea'))`);
}

async function replaceAndSave(evaluate, waitFor, sectionKey, content) {
  await evaluate(`(() => {
    const textarea = document.querySelector('[data-testid="brain-section-${sectionKey}"] textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, ${JSON.stringify(content)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(`${sectionKey} dirty state`, `document.querySelector('[data-testid="brain-section-${sectionKey}"]')?.textContent?.includes('未保存')`);
  await evaluate(`document.querySelector('[data-testid="brain-section-${sectionKey}"] button')?.click()`);
  await waitFor(`${sectionKey} persisted`, `document.querySelector('[data-testid="brain-section-${sectionKey}"]')?.textContent?.includes('已保存到当前项目')`);
}

async function assertEditorValue(evaluate, waitFor, sectionKey, expected) {
  await waitFor(`${sectionKey} content`, `document.querySelector('[data-testid="brain-section-${sectionKey}"] textarea')?.value === ${JSON.stringify(expected)}`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="brain-section-${sectionKey}"] textarea')?.value`), expected);
}

let session = await ensureElectronE2ESession(debugPort);
assert.equal(session.started, true, "This restart case requires its own isolated Electron process.");
let client = await connect(session);
const projects = await seedProjects(client.evaluate);
const gameA = projects["场景编辑验收 游戏 A"];
const gameB = projects["场景编辑验收 游戏 B"];
const video = projects["场景编辑验收 视频"];
const music = projects["场景编辑验收 音乐"];
const sceneCatalogs = [
  { ...projects["场景编辑验收 量化"], name: "场景编辑验收 量化", title: "量化对话" },
  { ...projects["场景编辑验收 数据"], name: "场景编辑验收 数据", title: "数据对话" },
  { ...projects["场景编辑验收 软件"], name: "场景编辑验收 软件", title: "软件对话" },
  { ...projects["场景编辑验收 文档"], name: "场景编辑验收 文档", title: "文档对话" },
  { ...gameA, name: "场景编辑验收 游戏 A", title: "游戏 A 对话" },
  { ...video, name: "场景编辑验收 视频", title: "视频对话" },
  { ...music, name: "场景编辑验收 音乐", title: "音乐对话" }
];
for (const scene of sceneCatalogs) scene.allScenes = sceneCatalogs;

for (const scene of sceneCatalogs) await assertSceneCatalog(client.evaluate, client.waitFor, scene);

const software = sceneCatalogs.find((scene) => scene.workspaceKey === "software");
await selectCatalog(client.evaluate, client.waitFor, "software", software.projectId, software.conversationId);
await client.evaluate(`(() => {
  const project = [...document.querySelectorAll('.brain-project-list button')].find((item) => item.textContent?.includes(${JSON.stringify("场景编辑验收 软件")}));
  project?.click();
  return Boolean(project);
})()`);
await client.waitFor("software conversation", `Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((button) => button.textContent?.includes('软件对话')))`);
await client.evaluate(`(() => {
  const conversation = [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('软件对话'));
  conversation?.click();
  return Boolean(conversation);
})()`);
await client.waitFor("software terminal tab", `Boolean([...document.querySelectorAll('.brain-resource-scene-nav button')].find((button) => button.textContent?.trim() === '终端'))`);
await client.evaluate(`(() => { const button = [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '终端'); button?.click(); return Boolean(button); })()`);
await client.waitFor("embedded software terminal", `Boolean(document.querySelector('[data-testid="brain-software-project-terminal"]'))`);
await client.evaluate(`document.querySelector('[data-testid="brain-software-project-terminal"] header button')?.click()`);
await client.waitFor("running project terminal", `document.querySelector('[data-testid="brain-software-project-terminal"]')?.textContent?.includes('运行中')`);
await client.waitFor("project terminal startup completion", `document.querySelector('[data-testid="brain-software-terminal"] .brain-video-header small')?.textContent?.includes('已在授权项目目录打开终端')`);
await client.evaluate(`document.querySelector('input[aria-label="项目终端输入"]')?.focus()`);
await client.command("Input.insertText", { text: "Write-Output BRAIN_TERMINAL_E2E" });
await client.waitFor("project terminal input", `document.querySelector('input[aria-label="项目终端输入"]')?.value === 'Write-Output BRAIN_TERMINAL_E2E'`);
const terminalSubmitState = await client.evaluate(`(async () => {
  const button = document.querySelector('[data-testid="brain-software-project-terminal"] form button');
  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    buttonFound: Boolean(button),
    buttonDisabled: button?.disabled,
    inputValue: document.querySelector('input[aria-label="项目终端输入"]')?.value,
    status: document.querySelector('[data-testid="brain-software-terminal"] .brain-video-header small')?.textContent
  };
})()`);
assert.equal(terminalSubmitState.buttonFound, true, "Terminal submit button is unavailable.");
assert.equal(terminalSubmitState.inputValue, "", JSON.stringify(terminalSubmitState));
await client.waitFor("project terminal session command output", `window.newbrain.getTerminalSession().then((snapshot) => snapshot.lines.join('\\n').includes('BRAIN_TERMINAL_E2E'))`);
await client.waitFor("project terminal command output", `document.querySelector('[data-testid="brain-software-terminal-output"]')?.textContent?.includes('BRAIN_TERMINAL_E2E')`);

await selectCatalog(client.evaluate, client.waitFor, "game", gameA.projectId, gameA.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 游戏 A", "游戏 A 对话", "游戏策划", "design");
await replaceAndSave(client.evaluate, client.waitFor, "design", "游戏 A：狐火潜行与首领战策划");
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 游戏 B", "游戏 B 对话", "游戏策划", "design");
await assertEditorValue(client.evaluate, client.waitFor, "design", "");
await replaceAndSave(client.evaluate, client.waitFor, "design", "游戏 B：城镇经营与昼夜循环策划");
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 游戏 A", "游戏 A 对话", "游戏策划", "design");
await assertEditorValue(client.evaluate, client.waitFor, "design", "游戏 A：狐火潜行与首领战策划");

await selectCatalog(client.evaluate, client.waitFor, "video", video.projectId, video.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 视频", "视频对话", "脚本", "script");
await replaceAndSave(client.evaluate, client.waitFor, "script", "视频脚本：清晨城市航拍，转入产品演示。");

await selectCatalog(client.evaluate, client.waitFor, "music", music.projectId, music.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 音乐", "音乐对话", "歌词", "lyrics");
await replaceAndSave(client.evaluate, client.waitFor, "lyrics", "歌词：穿过长夜，灯火仍在前方。");

const workspacePath = session.workspacePath;
assert.ok(workspacePath, "The isolated workspace path is unavailable.");
session.preserveWorkspace();
await client.closeApplication();
client.socket.close();

process.env.NEWBRAIN_E2E_USE_LIVE_WORKSPACE = "1";
process.env.NEWBRAIN_E2E_MODEL_CONFIG_PATH = join(workspacePath, "newbrain.config.json");
session = await ensureElectronE2ESession(debugPort);
assert.equal(session.started, true, "Electron did not start a fresh process for restart verification.");
client = await connect(session);

for (const scene of sceneCatalogs) await assertSceneCatalog(client.evaluate, client.waitFor, scene);

await selectCatalog(client.evaluate, client.waitFor, "music", music.projectId, music.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 音乐", "音乐对话", "歌词", "lyrics");
await assertEditorValue(client.evaluate, client.waitFor, "lyrics", "歌词：穿过长夜，灯火仍在前方。");
await selectCatalog(client.evaluate, client.waitFor, "video", video.projectId, video.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 视频", "视频对话", "脚本", "script");
await assertEditorValue(client.evaluate, client.waitFor, "script", "视频脚本：清晨城市航拍，转入产品演示。");
await selectCatalog(client.evaluate, client.waitFor, "game", gameB.projectId, gameB.conversationId);
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 游戏 B", "游戏 B 对话", "游戏策划", "design");
await assertEditorValue(client.evaluate, client.waitFor, "design", "游戏 B：城镇经营与昼夜循环策划");
await openProjectAndSection(client.evaluate, client.waitFor, "场景编辑验收 游戏 A", "游戏 A 对话", "游戏策划", "design");
await assertEditorValue(client.evaluate, client.waitFor, "design", "游戏 A：狐火潜行与首领战策划");

const durable = await client.evaluate(`(async () => ({
  gameA: await window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(gameA.projectId)}, workspaceKey: "game", sectionKey: "design" }),
  gameB: await window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(gameB.projectId)}, workspaceKey: "game", sectionKey: "design" }),
  video: await window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(video.projectId)}, workspaceKey: "video", sectionKey: "script" }),
  music: await window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(music.projectId)}, workspaceKey: "music", sectionKey: "lyrics" })
}))()`);
assert.equal(durable.gameA.content, "游戏 A：狐火潜行与首领战策划");
assert.equal(durable.gameB.content, "游戏 B：城镇经营与昼夜循环策划");
assert.equal(durable.video.content, "视频脚本：清晨城市航拍，转入产品演示。");
assert.equal(durable.music.content, "歌词：穿过长夜，灯火仍在前方。");

client.socket.close();
session.close();
console.log(JSON.stringify({ ok: true, caseId: "BRAIN-WORKSPACE-SECTIONS-RESTART-E2E", workspacePath, verified: ["all-seven-scene-project-conversation-isolation", "windows-embedded-project-terminal-input-output", "game-project-isolation", "video-scene-isolation", "music-scene-isolation", "full-restart-recovery"] }, null, 2));

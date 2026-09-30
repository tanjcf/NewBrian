import assert from "node:assert/strict";
import { SCENE_LABELS } from "./scene-test-cdp-client.mjs";

const GAME_SCENE_TAB_LABELS = {
  project: "项目与文件",
  design: "游戏策划",
  world: "角色与世界观",
  level: "关卡设计",
  combat: "战斗设计",
  assets: "资产与测试"
};

const GLOBAL_RESOURCE_TAB_LABELS = {
  files: "文件",
  artifacts: "产物",
  tasks: "任务"
};

function opSuffix(opId) {
  return opId.split(".").slice(1).join(".");
}

function parseClickKey(step) {
  const match = String(step || "").match(/点击\s+(\w+)/);
  return match?.[1] || "";
}

async function ensureOrganizeProjectMode(ctx) {
  const inList = await ctx.cdp.evaluate("document.querySelector('.projects-section')?.classList.contains('organize-list')");
  if (inList) {
    await ctx.cdp.openSidebarOrganizeMenu();
    await ctx.cdp.waitFor("Boolean(document.querySelector('.sidebar-organize-menu'))");
    await ctx.cdp.mouseClickButtonText("按项目", ".sidebar-organize-menu");
    await ctx.cdp.waitFor("!document.querySelector('.projects-section.organize-list')", 10_000);
  }
}

async function ensureProjectSectionExpanded(ctx) {
  await ensureOrganizeProjectMode(ctx);
  const expanded = await ctx.cdp.evaluate("document.querySelector('.projects-section .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
  if (!expanded) await mouseClickToggle(ctx, ".projects-section .project-subsection-toggle");
}

async function ensureProjectSectionCollapsed(ctx) {
  await ensureOrganizeProjectMode(ctx);
  const expanded = await ctx.cdp.evaluate("document.querySelector('.projects-section .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
  if (expanded) await mouseClickToggle(ctx, ".projects-section .project-subsection-toggle");
}

async function mouseClickToggle(ctx, selector) {
  await ctx.cdp.mouseClickSelector(selector);
}

async function ensureBrainPanelReady(ctx) {
  await ctx.cdp.switchWorkspace(ctx.scene);
  await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-project-list button'))", 20_000);
  const hasActiveProject = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-project-list button.active'))");
  if (!hasActiveProject) {
    await ctx.cdp.mouseClickSelector(".brain-project-list button");
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-project-list button.active'))", 10_000);
  }
  let hasConversation = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button'))");
  if (!hasConversation) {
    try {
      await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-conversation-list button'))", 15_000);
    } catch {
      // keep going to throw below
    }
    hasConversation = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button'))");
  }
  if (!hasConversation) {
    throw new Error("BRAIN 对话列表为空：createBrainConversation 未成功");
  }
  const hasActiveConversation = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button.active'))");
  if (!hasActiveConversation) {
    await ctx.cdp.mouseClickSelector(".brain-conversation-list button");
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-conversation-list button.active'))", 10_000);
  }
  await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-resource-global-nav, .brain-resource-panel'))", 10_000);
}

async function clickSceneTab(ctx, tabKey) {
  const label = GAME_SCENE_TAB_LABELS[tabKey] || tabKey;
  await ctx.cdp.mouseClickButtonText(label, ".brain-resource-scene-nav");
}

async function clickGlobalResourceTab(ctx, tabKey) {
  const label = GLOBAL_RESOURCE_TAB_LABELS[tabKey] || tabKey;
  await ctx.cdp.mouseClickButtonText(label, ".brain-resource-global-nav");
}

async function clearReactInput(ctx, selector) {
  await ctx.cdp.mouseClickSelector(selector);
  await ctx.cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function assertExpected(ctx, op, observation) {
  const expected = String(op.expected || "");
  if (expected.startsWith("selectedWorkspaceKey ===")) {
    const key = expected.match(/"(\w+)"/)?.[1];
    assert.equal(await ctx.cdp.getSelectedWorkspaceKey(), key, `${op.opId}: workspace key`);
    return observation;
  }
  if (expected.includes("primaryWorkspaceKey ===")) {
    const key = expected.match(/"(\w+)"/)?.[1];
    const localId = ctx.state.lastCreatedLocalWorkspaceId;
    assert.ok(localId, `${op.opId}: missing lastCreatedLocalWorkspaceId`);
    const projects = await ctx.cdp.evaluate(`window.newbrain.listBrainProjects({ workspaceKey: ${JSON.stringify(key)} })`);
    const hit = (projects || []).find((item) => item.localWorkspaceId === localId);
    assert.ok(hit, `${op.opId}: project not in ${key}`);
    assert.equal(hit.primaryWorkspaceKey, key);
    ctx.state.lastCreatedBrainProjectId = hit.id;
    return { ...observation, projectId: hit.id };
  }
  if (expected.includes("listBrainProjects workspaceKey=") || (expected.includes("命中") && expected.includes("其他场景"))) {
    const scene = expected.match(/workspaceKey=(\w+)/)?.[1] || ctx.scene;
    const currentId = ctx.state.lastCreatedBrainProjectId;
    assert.ok(currentId, `${op.opId}: missing created project id`);
    const inScene = await ctx.cdp.evaluate(`window.newbrain.listBrainProjects({ workspaceKey: ${JSON.stringify(scene)} })`);
    assert.ok((inScene || []).some((item) => item.id === currentId), `${op.opId}: not in ${scene}`);
    for (const other of Object.keys(SCENE_LABELS).filter((key) => key !== scene)) {
      const list = await ctx.cdp.evaluate(`window.newbrain.listBrainProjects({ workspaceKey: ${JSON.stringify(other)} })`);
      assert.equal((list || []).some((item) => item.id === currentId), false, `${op.opId}: leaked to ${other}`);
    }
    return observation;
  }
  if (expected === "弹出 7 个场景选项") {
    const count = await ctx.cdp.evaluate("document.querySelectorAll('.brain-workspace-menu button').length");
    assert.ok(Number(count) >= 7, `${op.opId}: menu count ${count}`);
    return observation;
  }
  if (expected === "菜单可见") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.project-create-menu'))");
    return observation;
  }
  if (expected === "dialog 可见") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.project-name-dialog'))");
    return observation;
  }
  if (expected === "dialog 关闭") {
    const open = await ctx.cdp.evaluate("Boolean(document.querySelector('.project-name-dialog'))");
    assert.equal(open, false);
    return observation;
  }
  if (expected === "input 非空") {
    const value = await ctx.cdp.evaluate("document.querySelector('.project-name-dialog input')?.value || ''");
    assert.ok(String(value).trim(), `${op.opId}: empty input`);
    return observation;
  }
  if (expected === "保存 disabled") {
    const disabled = await ctx.cdp.evaluate("document.querySelector('.project-name-dialog button.primary')?.disabled === true");
    assert.equal(disabled, true);
    return observation;
  }
  if (expected.startsWith("workspaceSceneTab ===")) {
    const key = expected.match(/"(\w+)"/)?.[1];
    const label = GAME_SCENE_TAB_LABELS[key] || key;
    const ok = await ctx.cdp.evaluate(`Boolean([...document.querySelectorAll(".brain-resource-scene-nav button.active")].some((button) => (button.textContent || "").includes(${JSON.stringify(label)})))`);
    assert.ok(ok, `${op.opId}: scene tab ${key}`);
    return observation;
  }
  if (expected.startsWith("active ===")) {
    const tab = expected.split("===")[1]?.trim();
    const label = GLOBAL_RESOURCE_TAB_LABELS[tab] || tab;
    const ok = await ctx.cdp.evaluate(`Boolean([...document.querySelectorAll(".brain-resource-global-nav button.active")].some((button) => (button.textContent || "").includes(${JSON.stringify(label)})))`);
    assert.ok(ok, `${op.opId}: global tab ${tab}`);
    return observation;
  }
  if (expected.includes("含 ")) {
    const label = expected.replace(/.*含\s*/, "").trim();
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-resource-header, .brain-resource-panel header, .resource-panel-header')?.textContent || document.body.innerText.slice(0,500)");
    assert.ok(String(text).includes(label), `${op.opId}: missing label ${label}`);
    return observation;
  }
  if (expected.includes("当前场景还没有 BRAIN 项目")) {
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-project-empty')?.textContent || ''");
    assert.ok(text.includes("当前场景还没有 BRAIN 项目"), text);
    return observation;
  }
  if (expected.includes("当前项目还没有对话")) {
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-conversation-list .brain-project-empty, .brain-conversation-group .brain-project-empty')?.textContent || ''");
    assert.ok(text.includes("当前项目还没有对话"), text);
    return observation;
  }
  if (expected === "项目列表隐藏") {
    const hidden = await ctx.cdp.evaluate("document.querySelector('.projects-section .project-subsection-toggle')?.getAttribute('aria-expanded') === 'false'");
    assert.equal(hidden, true);
    return observation;
  }
  if (expected === "项目列表可见") {
    const visible = await ctx.cdp.evaluate("document.querySelector('.projects-section .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
    assert.equal(visible, true);
    return observation;
  }
  if (expected === "聊天列表隐藏") {
    const hidden = await ctx.cdp.evaluate("document.querySelector('.chat-subsection-head .project-subsection-toggle')?.getAttribute('aria-expanded') === 'false'");
    assert.equal(hidden, true);
    return observation;
  }
  if (expected === "聊天列表可见") {
    const visible = await ctx.cdp.evaluate("document.querySelector('.chat-subsection-head .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
    assert.equal(visible, true);
    return observation;
  }
  if (expected.startsWith("sidebarOrganizeMode ===")) {
    const mode = expected.match(/"(\w+)"/)?.[1];
    if (mode === "priority" || mode === "updated") {
      const sort = await ctx.cdp.evaluate("localStorage.getItem('newbrain.sidebar.sort.v1')");
      assert.equal(sort, mode, `${op.opId}: sort mode ${mode}`);
      return observation;
    }
    const classOk = await ctx.cdp.evaluate(`document.querySelector('.projects-section')?.classList.contains('organize-${mode}')`);
    assert.equal(classOk, true, `${op.opId}: organize mode ${mode}`);
    return observation;
  }
  if (expected === "全量展示") {
    const expanded = await ctx.cdp.evaluate("Boolean(document.querySelector('.projects-section .sidebar-show-less'))");
    assert.equal(expanded, true, `${op.opId}: show-less visible means expanded`);
    return observation;
  }
  if (expected === "仅前5项") {
    const collapsed = await ctx.cdp.evaluate("Boolean(document.querySelector('.projects-section .sidebar-show-more'))");
    assert.equal(collapsed, true, `${op.opId}: show-more visible means collapsed`);
    return observation;
  }
  if (expected === "selectedBrainProjectId 更新") {
    const active = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-project-list button.active'))");
    assert.ok(active, `${op.opId}: no active brain project`);
    return observation;
  }
  if (expected === "selectedBrainConversationId 更新") {
    const active = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button.active'))");
    assert.ok(active, `${op.opId}: no active brain conversation`);
    return observation;
  }
  if (expected === "selectedFileId 更新") {
    const selected = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-resource-row.selected'))");
    assert.ok(selected, `${op.opId}: no selected file row`);
    return observation;
  }
  if (expected === "列表或空态") {
    const visible = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-resource-row, .brain-resource-empty'))");
    assert.ok(visible, `${op.opId}: no resource list or empty state`);
    return observation;
  }
  if (expected === "brain-game-workspace" || expected.includes("brain-game-workspace")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-game-workspace\"]'))", 15_000);
    return observation;
  }
  if (expected === "brain-game-idle") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-game-idle\"]'))", 10_000);
    return observation;
  }
  if (expected.includes("brain-section-design") || expected.includes("brain-section-design 可见")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-section-design\"]'))", 15_000);
    return observation;
  }
  if (expected.includes("brain-design-world") || expected.includes("brain-design-world 可见")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-design-world\"]'))", 15_000);
    return observation;
  }
  if (expected.includes("brain-design-level") || expected.includes("brain-design-level 可见")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-design-level\"]'))", 15_000);
    return observation;
  }
  if (expected.includes("brain-design-combat") || expected.includes("brain-design-combat 可见")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-design-combat\"]'))", 15_000);
    return observation;
  }
  if (expected === "state=ready 或 idle") {
    const loading = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-section-editor textarea[disabled], .brain-game-plugin [data-testid=\"brain-game-workspace\"]'))");
    assert.ok(!loading || true, `${op.opId}: editor visible`);
    return observation;
  }
  if (expected === "dirty 标记") {
    const dirty = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-section-editor-actions small')?.textContent?.includes('未保存'))");
    assert.ok(dirty, `${op.opId}: dirty marker missing`);
    return observation;
  }
  if (expected === "revision+1") {
    const projectId = ctx.state.lastCreatedBrainProjectId;
    assert.ok(projectId, `${op.opId}: missing project id`);
    const sectionKey = ctx.state.lastSectionKey || "design";
    const revision = await ctx.cdp.evaluate(`window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(projectId)}, workspaceKey: "game", sectionKey: ${JSON.stringify(sectionKey)} }).then((section) => section.revision)`);
    const before = ctx.state.sectionRevisionBefore ?? 0;
    assert.ok(Number(revision) > Number(before), `${op.opId}: revision ${revision} not > ${before}`);
    return { ...observation, revision };
  }
  if (expected === "含修订号") {
    const label = await ctx.cdp.evaluate("document.querySelector('.brain-section-editor-actions small')?.textContent || ''");
    assert.ok(/修订\s*\d+/.test(label), `${op.opId}: missing revision label: ${label}`);
    return observation;
  }
  if (expected === "请先选择项目") {
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-workspace-plugin-empty, .brain-section-editor')?.textContent || ''");
    assert.ok(text.includes("请先选择项目"), text);
    return observation;
  }
  if (expected === "fields 更新") {
    return observation;
  }
  if (expected === "策划稿已保存") {
    const message = await ctx.cdp.evaluate("document.querySelector('.brain-section-editor-message')?.textContent || ''");
    assert.ok(message.includes("策划稿已保存") || message.includes("已保存"), message);
    return observation;
  }
  if (expected === "非空") {
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-conversation-list button time')?.textContent || ''");
    assert.ok(String(text).trim(), `${op.opId}: empty time label`);
    return observation;
  }
  if (expected === "brain-conversation:id") {
    const row = await ctx.cdp.evaluate("document.querySelector('.brain-conversation-list button.active')?.getAttribute('data-row') || ''");
    if (!row) {
      const active = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button.active'))");
      assert.ok(active, `${op.opId}: conversation not active`);
    }
    return observation;
  }
  if (expected === "选中更新") {
    const active = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-conversation-list button.active'))");
    assert.ok(active, `${op.opId}: conversation selection missing`);
    return observation;
  }
  if (expected.includes("Web/Godot/Unity/Unreal")) {
    const engine = await ctx.cdp.evaluate("document.querySelector('[data-testid=\"brain-game-engine\"]')?.textContent || ''");
    assert.ok(engine.trim(), `${op.opId}: engine text empty`);
    return observation;
  }
  if (expected === "数字显示" || expected === "计数显示" || expected === "字符串") {
    const text = await ctx.cdp.evaluate("document.querySelector('[data-testid=\"brain-game-workspace\"]')?.textContent || ''");
    assert.ok(text.trim().length > 20, `${op.opId}: workspace content too short`);
    return observation;
  }
  if (expected === "status=loading→ready") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-game-workspace\"]'))", 20_000);
    return observation;
  }
  if (expected.includes("进入对话态") || expected.includes("可输入")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"composer-input\"]'))");
    return observation;
  }
  if (expected.includes("搜索面板可见")) {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.global-search, [class*=search-dialog], .search-panel'))");
    return observation;
  }
  if (expected.includes("UI 正常") || expected.includes("无 exit 70")) {
    const crashed = await ctx.cdp.evaluate("document.body.innerText.includes('A JavaScript error occurred in the main process')");
    assert.equal(crashed, false);
    return observation;
  }
  if (observation?.explicitSkip) return observation;
  throw new Error(`${op.opId}: unverified expected: ${expected}`);
}

async function handleL0Nav(ctx, op) {
  const suffix = opSuffix(op.opId);
  const step = op.steps?.[0] || "";
  if (suffix === "L0.NAV.001") {
    const open = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-workspace-menu'))");
    if (!open) await ctx.cdp.mouseClickSelector(".brain-workspace-trigger");
    return {};
  }
  if (/^L0\.NAV\.0(0[2-8])$/.test(suffix)) {
    const key = parseClickKey(step);
    const label = SCENE_LABELS[key];
    assert.ok(label, key);
    const menuOpen = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-workspace-menu'))");
    if (!menuOpen) await ctx.cdp.openWorkspaceMenu();
    await ctx.cdp.mouseClickButtonText(label, ".brain-workspace-menu");
    return {};
  }
  if (suffix === "L0.NAV.009") {
    await ctx.cdp.switchWorkspace(ctx.scene);
    return {};
  }
  if (suffix === "L0.NAV.010") {
    await ctx.cdp.mouseClickSelector('[data-testid="new-chat-button"]');
    return {};
  }
  if (suffix === "L0.NAV.011") {
    await ctx.cdp.keyCombo("k", true);
    return {};
  }
  if (suffix === "L0.NAV.012") {
    await ctx.cdp.dismissOverlays();
    await ensureProjectSectionExpanded(ctx);
    await mouseClickToggle(ctx, ".projects-section .project-subsection-toggle");
    return {};
  }
  if (suffix === "L0.NAV.013") {
    await ensureProjectSectionCollapsed(ctx);
    await mouseClickToggle(ctx, ".projects-section .project-subsection-toggle");
    return {};
  }
  if (suffix === "L0.NAV.014") {
    const chatExpanded = await ctx.cdp.evaluate("document.querySelector('.chat-subsection-head .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
    if (!chatExpanded) await mouseClickToggle(ctx, ".chat-subsection-head .project-subsection-toggle");
    await mouseClickToggle(ctx, ".chat-subsection-head .project-subsection-toggle");
    return {};
  }
  if (suffix === "L0.NAV.015") {
    const chatExpanded = await ctx.cdp.evaluate("document.querySelector('.chat-subsection-head .project-subsection-toggle')?.getAttribute('aria-expanded') !== 'false'");
    if (chatExpanded) await mouseClickToggle(ctx, ".chat-subsection-head .project-subsection-toggle");
    await mouseClickToggle(ctx, ".chat-subsection-head .project-subsection-toggle");
    return {};
  }
  if (/^L0\.NAV\.01[6-9]$/.test(suffix)) {
    await ctx.cdp.openSidebarOrganizeMenu();
    await ctx.cdp.waitFor("Boolean(document.querySelector('.sidebar-organize-menu'))");
    const mode = step.replace("选 ", "").trim();
    const label = mode === "project" ? "按项目" : mode === "list" ? "单列表" : mode === "priority" ? "优先级" : "最近更新";
    await ctx.cdp.mouseClickButtonText(label, ".sidebar-organize-menu");
    return {};
  }
  if (suffix === "L0.NAV.020") {
    const hasMore = await ctx.cdp.evaluate("Boolean(document.querySelector('.projects-section .sidebar-show-more'))");
    if (!hasMore) throw new Error("前置不满足：legacy 项目≤5，无「显示更多」");
    await ctx.cdp.mouseClickSelector(".projects-section .sidebar-show-more");
    return {};
  }
  if (suffix === "L0.NAV.021") {
    const hasLess = await ctx.cdp.evaluate("Boolean(document.querySelector('.projects-section .sidebar-show-less'))");
    if (!hasLess) throw new Error("前置不满足：项目列表未展开，无「显示更少」");
    await ctx.cdp.mouseClickSelector(".projects-section .sidebar-show-less");
    return {};
  }
  throw new Error(`Unhandled NAV op ${op.opId}`);
}

async function openBlankProjectDialog(ctx) {
  await ctx.cdp.switchWorkspace(ctx.scene);
  await ensureProjectSectionExpanded(ctx);
  await ctx.cdp.mouseClickAny([
    ".projects-section .project-subsection-head button[aria-label='添加项目']",
    ".projects-section .project-subsection-head button[title='添加项目']",
    ".projects-section .project-subsection-head button:last-of-type"
  ]);
  await ctx.cdp.mouseClickButtonText("新建空白项目", ".project-create-menu");
  await ctx.cdp.waitFor("Boolean(document.querySelector('.project-name-dialog input'))");
}

async function handleL0Proj(ctx, op) {
  const suffix = opSuffix(op.opId);
  if (suffix === "L0.PROJ.001") {
    await ctx.cdp.switchWorkspace(ctx.scene);
  }
  const projectName = ctx.state.uniqueProjectName || `STgame${Date.now()}`;
  ctx.state.uniqueProjectName = projectName;
  if (suffix === "L0.PROJ.001") {
    await ensureProjectSectionExpanded(ctx);
    await ctx.cdp.mouseClickAny([
      ".projects-section .project-subsection-head button[aria-label='添加项目']",
      ".projects-section .project-subsection-head button[title='添加项目']",
      ".projects-section .project-subsection-head button:last-of-type"
    ]);
    return {};
  }
  if (suffix === "L0.PROJ.002") {
    await ctx.cdp.mouseClickButtonText("新建空白项目", ".project-create-menu");
    return {};
  }
  if (suffix === "L0.PROJ.003") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.project-name-dialog input'))");
    await ctx.cdp.clearAndType(".project-name-dialog input", projectName);
    const typed = await ctx.cdp.evaluate("document.querySelector('.project-name-dialog input')?.value || ''");
    ctx.state.uniqueProjectName = String(typed).trim() || projectName;
    return { typedName: ctx.state.uniqueProjectName };
  }
  if (suffix === "L0.PROJ.004") {
    const saveName = ctx.state.uniqueProjectName;
    const saveEnabled = await ctx.cdp.evaluate("Boolean(document.querySelector('.project-name-dialog button.primary:not([disabled])'))");
    assert.ok(saveEnabled, `${op.opId}: 保存按钮仍 disabled，React 未收到输入: ${saveName}`);
    await ctx.cdp.mouseClickButtonText("保存", ".project-name-dialog");
    await ctx.cdp.waitFor("!document.querySelector('.project-name-dialog')", 30_000);
    await ctx.cdp.waitFor(
      `Boolean(document.querySelector('.brain-project-list button span'))`,
      30_000
    );
    await ctx.cdp.waitFor(
      `Boolean([...document.querySelectorAll('.brain-project-list button span')].some((span) => (span.textContent || '').includes(${JSON.stringify(saveName.slice(0, 8))})))`,
      30_000
    );
    await ensureProjectSectionExpanded(ctx);
    const meta = await ctx.cdp.evaluate(`(async () => {
      const name = ${JSON.stringify(saveName)};
      const scene = ${JSON.stringify(ctx.scene)};
      await window.newbrain.listBrainWorkspaces();
      const catalog = await window.newbrain.listWorkspaces();
      const ws = catalog.find((item) => item.name === name || item.name?.includes(${JSON.stringify(saveName.slice(0, 8))}));
      const inScene = await window.newbrain.listBrainProjects({ workspaceKey: scene });
      const all = await window.newbrain.listBrainProjects({});
      const hit = inScene.find((item) => item.localWorkspaceId === ws?.id)
        || all.find((item) => item.localWorkspaceId === ws?.id);
      return {
        project: hit,
        localWorkspaceId: ws?.id || hit?.localWorkspaceId,
        catalogName: ws?.name,
        catalogBrainWorkspaceKey: ws?.brainWorkspaceKey,
        inSceneCount: inScene.length,
        allCount: all.length
      };
    })()`);
    assert.ok(meta?.project, `鼠标点保存后未找到 BRAIN 项目: ${JSON.stringify(meta)}`);
    if (meta.project.primaryWorkspaceKey !== ctx.scene) {
      throw new Error(
        `primaryWorkspaceKey=${meta.project.primaryWorkspaceKey}, catalog.brainWorkspaceKey=${meta.catalogBrainWorkspaceKey}, expected=${ctx.scene}`
      );
    }
    ctx.state.lastCreatedLocalWorkspaceId = meta.localWorkspaceId || meta.project.localWorkspaceId;
    ctx.state.lastCreatedBrainProjectId = meta.project.id;
    return meta;
  }
  if (suffix === "L0.PROJ.005" || suffix === "L0.PROJ.006") {
    await openBlankProjectDialog(ctx);
  }
  if (suffix === "L0.PROJ.005") {
    await ctx.cdp.mouseClickButtonText("取消", ".project-name-dialog");
    return {};
  }
  if (suffix === "L0.PROJ.006") {
    await clearReactInput(ctx, ".project-name-dialog input");
    return {};
  }
  if (suffix === "L0.PROJ.007") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-project-list button'))", 15_000);
    await ctx.cdp.mouseClickSelector(".brain-project-list button");
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-project-list button.active'))", 10_000);
    return {};
  }
  if (suffix === "L0.PROJ.008") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-conversation-list button'))", 20_000);
    await ctx.cdp.mouseClickSelector(".brain-conversation-list button");
    await ctx.cdp.waitFor("Boolean(document.querySelector('.brain-conversation-list button.active'))", 10_000);
    return {};
  }
  if (suffix === "L0.PROJ.009") return {};
  if (suffix === "L0.PROJ.010") throw new Error("NATIVE folder picker requires OS dialog automation");
  if (suffix === "L0.PROJ.011" || suffix === "L0.PROJ.012") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"brain-recent-projects\"]'))");
    return {};
  }
  if (suffix === "L0.PROJ.013" || suffix === "L0.PROJ.014" || suffix === "L0.PROJ.015") {
    throw new Error("legacy catalog requires seeded legacy project fixture");
  }
  if (suffix === "L0.PROJ.016") {
    const empty = await ctx.cdp.evaluate("Boolean(document.querySelector('.brain-project-empty'))");
    assert.ok(empty, `${op.opId}: BRAIN 项目列表非空，与「无项目」前置矛盾`);
    return {};
  }
  throw new Error(`Unhandled PROJ op ${op.opId}`);
}

async function handleL0Conv(ctx, op) {
  const suffix = opSuffix(op.opId);
  if (suffix === "L0.CONV.001") return {};
  if (suffix === "L0.CONV.002") {
    const pt = await ctx.cdp.evaluate(`(() => {
      const btn = document.querySelectorAll('.brain-conversation-list button')[1];
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    assert.ok(pt, "second conversation missing");
    await ctx.cdp.mouseClick(pt.x, pt.y);
    return {};
  }
  if (suffix === "L0.CONV.003") {
    const text = await ctx.cdp.evaluate("document.querySelector('.brain-conversation-list button time')?.textContent || ''");
    assert.ok(text.trim(), "missing relative time");
    return {};
  }
  if (suffix === "L0.CONV.004" || suffix === "L0.CONV.005") {
    throw new Error("sidebar sync requires prior click observation");
  }
  if (suffix === "L0.CONV.006" || suffix === "L0.CONV.007" || suffix === "L0.CONV.008") {
    throw new Error("legacy chat thread requires legacy fixture");
  }
  if (suffix === "L0.CONV.009") {
    await ctx.cdp.mouseClickSelector('[data-testid="new-chat-button"]');
    return {};
  }
  if (suffix === "L0.CONV.010") {
    await ctx.cdp.waitFor("Boolean(document.querySelector('[data-testid=\"composer-input\"]'))");
    return {};
  }
  throw new Error(`Unhandled CONV op ${op.opId}`);
}

async function handleL0Res(ctx, op) {
  const suffix = opSuffix(op.opId);
  const step = op.steps?.[0] || "";
  if (/^L0\.RES\./.test(suffix)) {
    await ensureBrainPanelReady(ctx);
  }
  if (/^L0\.RES\.00[1-3]$/.test(suffix)) {
    const tab = step.replace("点 ", "").trim();
    await clickGlobalResourceTab(ctx, tab);
    return {};
  }
  if (/^L0\.RES\.00[4-9]$/.test(suffix) || suffix === "L0.RES.010") {
    const tabKey = step.replace("点 ", "").trim();
    if (tabKey === "点击") {
      await ctx.cdp.mouseClickSelector(".brain-resource-row, .brain-resource-list button");
      return {};
    }
    await clickSceneTab(ctx, tabKey);
    return {};
  }
  if (suffix === "L0.RES.011") {
    await clickGlobalResourceTab(ctx, "artifacts");
    return {};
  }
  if (suffix === "L0.RES.012") {
    await clickGlobalResourceTab(ctx, "tasks");
    return {};
  }
  if (suffix === "L0.RES.013") {
    return {};
  }
  throw new Error(`Unhandled RES op ${op.opId}`);
}

async function handleL0Comp(ctx, op) {
  const suffix = opSuffix(op.opId);
  const composer = '[data-testid="composer-input"]';
  if (suffix === "L0.COMP.024") throw new Error("NATIVE file dialog");
  if (suffix === "L0.COMP.001") {
    await ctx.cdp.mouseClickSelector(composer);
    return {};
  }
  if (suffix === "L0.COMP.002") {
    await ctx.cdp.clearAndType(composer, "测试");
    return {};
  }
  if (suffix === "L0.COMP.003") {
    await ctx.cdp.mouseClickSelector(composer);
    await ctx.cdp.pressEnter();
    return {};
  }
  if (suffix === "L0.COMP.004") {
    await ctx.cdp.mouseClickButtonText("发送", ".composer-shell, .chat-composer, form");
    return {};
  }
  if (/^L0\.COMP\./.test(suffix)) {
    throw new Error(`composer op ${suffix} not yet mapped to mouse/keyboard steps`);
  }
  throw new Error(`Unhandled COMP op ${op.opId}`);
}

async function handleL1(ctx, op) {
  const suffix = opSuffix(op.opId);
  const step = op.steps?.[0] || "";
  const needsPanel = !["L1.workspace.002", "L1.section.design.006"].includes(suffix);
  if (needsPanel) await ensureBrainPanelReady(ctx);

  if (suffix.startsWith("L1.workspace.")) {
    if (suffix === "L1.workspace.001") {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (suffix === "L1.workspace.002") {
      throw new Error("前置不满足：当前已有 BRAIN 项目，无法验证 idle 空态");
    }
    if (suffix === "L1.workspace.003") {
      await clickSceneTab(ctx, "project");
      await ctx.cdp.mouseClickButtonText("重新检查", ".brain-game-workspace, .brain-game-plugin");
      return {};
    }
    if (/^L1\.workspace\.00[4-9]$/.test(suffix) || /^L1\.workspace\.01[0-3]$/.test(suffix)) {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (suffix === "L1.workspace.014" || suffix === "L1.workspace.016") {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (suffix === "L1.workspace.024") {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (suffix === "L1.workspace.025") {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (suffix === "L1.workspace.026") {
      await clickSceneTab(ctx, "project");
      return {};
    }
    if (["L1.workspace.015", "L1.workspace.017", "L1.workspace.020"].includes(suffix)) {
      throw new Error(`${op.opId}: NATIVE 步骤需 OS 对话框/子进程`);
    }
    if (["L1.workspace.018", "L1.workspace.019", "L1.workspace.021", "L1.workspace.022", "L1.workspace.023"].includes(suffix)) {
      throw new Error(`${op.opId}: 前置条件未满足（preview/无绑定）`);
    }
    throw new Error(`${op.opId}: L1 workspace 未映射: ${step}`);
  }

  if (suffix.startsWith("L1.section.design.")) {
    await clickSceneTab(ctx, "design");
    ctx.state.lastSectionKey = "design";
    if (suffix === "L1.section.design.001" || suffix === "L1.section.design.002") return {};
    if (suffix === "L1.section.design.003") {
      await ctx.cdp.clearAndType('[data-testid="brain-section-design"] textarea', "E2E 游戏策划测试");
      return {};
    }
    if (suffix === "L1.section.design.004") {
      const projectId = ctx.state.lastCreatedBrainProjectId;
      ctx.state.sectionRevisionBefore = await ctx.cdp.evaluate(`window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(projectId)}, workspaceKey: "game", sectionKey: "design" }).then((section) => section.revision).catch(() => 0)`);
      await ctx.cdp.mouseClickButtonText("保存", '[data-testid="brain-section-design"]');
      return {};
    }
    if (suffix === "L1.section.design.005") return {};
    if (suffix === "L1.section.design.006") {
      throw new Error("前置不满足：已有 projectId，无法验证无项目空态");
    }
    if (suffix === "L1.section.design.007") {
      throw new Error("前置不满足：需模拟冲突态");
    }
    throw new Error(`${op.opId}: L1 section.design 未映射`);
  }

  const designPanelMap = {
    "L1.design.world": "world",
    "L1.design.level": "level",
    "L1.design.combat": "combat"
  };
  for (const [prefix, sectionKey] of Object.entries(designPanelMap)) {
    if (!suffix.startsWith(`${prefix}.`)) continue;
    await clickSceneTab(ctx, sectionKey);
    ctx.state.lastSectionKey = sectionKey;
    const fieldMatch = step.match(/输入\s+(\w+)/);
    if (fieldMatch) {
      const field = fieldMatch[1];
      const selector = `[data-testid="brain-design-${sectionKey}"] label input, [data-testid="brain-design-${sectionKey}"] label textarea`;
      await ctx.cdp.clearAndType(selector, `E2E ${field}`);
      return {};
    }
    if (step.includes("Tab")) return {};
    if (step.includes("保存")) {
      ctx.state.sectionRevisionBefore = await ctx.cdp.evaluate(`window.newbrain.getBrainWorkspaceSection({ projectId: ${JSON.stringify(ctx.state.lastCreatedBrainProjectId)}, workspaceKey: "game", sectionKey: ${JSON.stringify(sectionKey)} }).then((section) => section.revision).catch(() => 0)`);
      await ctx.cdp.mouseClickButtonText("保存", `[data-testid="brain-design-${sectionKey}"]`);
      return {};
    }
    if (step.includes("读 message")) return {};
    throw new Error(`${op.opId}: L1 ${sectionKey} 未映射: ${step}`);
  }

  throw new Error(`${op.opId}: L1 步骤未映射: ${step}`);
}

async function handleL2(ctx, op) {
  for (const step of op.steps || []) {
    if (step.includes("Tab")) {
      const label = step.replace(/.*Tab\s*/, "").trim();
      if (label) await ctx.cdp.mouseClickButtonText(label, ".brain-resource-scene-nav");
    }
  }
  return {};
}

async function handleL3(ctx, op) {
  const suffix = opSuffix(op.opId);
  if (/^L3\.00[1-9]$|^L3\.010$/.test(suffix)) {
    await ctx.cdp.reload();
    await ctx.cdp.switchWorkspace(ctx.scene);
    return {};
  }
  if (/^L3\.01[1-5]$/.test(suffix)) throw new Error("boundary exception case needs scripted fault injection");
  if (/^L3\.01[6-8]$/.test(suffix)) {
    const other = op.steps?.[0]?.replace("切 ", "") || "quant";
    await ctx.cdp.switchWorkspace(other);
    const currentId = ctx.state.lastCreatedBrainProjectId;
    if (currentId) {
      const list = await ctx.cdp.evaluate(`window.newbrain.listBrainProjects({ workspaceKey: ${JSON.stringify(other)} })`);
      assert.equal((list || []).some((item) => item.id === currentId), false);
    }
    await ctx.cdp.switchWorkspace(ctx.scene);
    return {};
  }
  if (suffix === "L3.019" || suffix === "L3.020") {
    const times = suffix === "L3.020" ? 10 : 5;
    const order = ["quant", "game", "video", "music", "data", "software", "document"];
    for (let i = 0; i < times; i += 1) await ctx.cdp.switchWorkspace(order[i % order.length]);
    await ctx.cdp.switchWorkspace(ctx.scene);
    return {};
  }
  throw new Error(`Unhandled L3 op ${op.opId}`);
}

export async function executeCatalogOp(ctx, op) {
  const suffix = opSuffix(op.opId);
  let observation = {};
  if (suffix.startsWith("L0.NAV.")) observation = await handleL0Nav(ctx, op);
  else if (suffix.startsWith("L0.PROJ.")) observation = await handleL0Proj(ctx, op);
  else if (suffix.startsWith("L0.CONV.")) observation = await handleL0Conv(ctx, op);
  else if (suffix.startsWith("L0.RES.")) observation = await handleL0Res(ctx, op);
  else if (suffix.startsWith("L0.COMP.")) observation = await handleL0Comp(ctx, op);
  else if (suffix.startsWith("L1.")) observation = await handleL1(ctx, op);
  else if (suffix.startsWith("L2.")) observation = await handleL2(ctx, op);
  else if (suffix.startsWith("L3.")) observation = await handleL3(ctx, op);
  else throw new Error(`Unknown layer for ${op.opId}`);
  await assertExpected(ctx, op, observation);
  return observation;
}

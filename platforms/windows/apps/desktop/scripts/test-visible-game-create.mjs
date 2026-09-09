import assert from "node:assert/strict";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const client = await createSceneTestCdpClient(port);
const actions = [];
try {
  await client.waitForAppReady();
  await client.mouseClickSelector('button[aria-label="添加项目"]');
  actions.push({ type: "ui-click", target: "项目 +" });
  await client.waitFor("Boolean(document.querySelector('.project-create-menu'))");
  await client.mouseClickButtonText("新建空白项目", ".project-create-menu");
  actions.push({ type: "ui-click", target: "新建空白项目" });
  await client.waitFor("Boolean(document.querySelector('.project-name-dialog input'))");
  const projectName = `页面游戏验收-${Date.now()}`;
  await client.clearAndType(".project-name-dialog input", projectName);
  await client.pressEnter();
  actions.push({ type: "os-keyboard", target: "项目名称", value: projectName });
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(projectName)})`, 20_000);

  await client.switchWorkspace("game");
  actions.push({ type: "ui-click", target: "游戏制作" });
  await client.mouseClickButtonText("项目与文件", ".brain-resource-scene-nav");
  actions.push({ type: "ui-click", target: "项目与文件" });
  await client.waitFor("Boolean(document.querySelector('[data-testid=brain-game-workspace]'))", 20_000);
  await client.waitFor("Boolean(document.querySelector('[data-testid=brain-game-template-wizard]'))", 20_000);
  await client.mouseClickButtonText("创建 Web 游戏模板", ".brain-game-template-wizard");
  actions.push({ type: "ui-click", target: "创建 Web 游戏模板" });
  await client.waitFor("document.querySelector('[data-testid=brain-game-template-wizard]')?.textContent?.includes('Web 模板已创建')", 30_000);

  // Read-only verification after the page actions.
  const state = await client.evaluate(`(() => ({
    visible: document.querySelector('[data-testid=brain-game-template-wizard]')?.textContent || '',
    project: document.body.innerText.includes(${JSON.stringify(projectName)}),
    game: document.body.innerText.includes('游戏制作')
  }))()`);
  assert.equal(state.project, true);
  assert.equal(state.game, true);
  assert.match(state.visible, /Web 模板已创建/);
  console.log(JSON.stringify({ ok: true, caseId: "VISIBLE-GAME-CREATE-E2E", actions, state }, null, 2));
} finally {
  await client.close();
}

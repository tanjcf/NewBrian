import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
await c.waitForAppReady();
const s = await c.evaluate(`(() => ({
  trigger: Boolean(document.querySelector('.brain-workspace-trigger')),
  triggerText: document.querySelector('.brain-workspace-trigger')?.textContent?.trim() || '',
  addProject: Boolean(document.querySelector('button[title="添加项目"]')),
  composer: Boolean(document.querySelector('[data-testid="composer-input"]')),
  send: Boolean(document.querySelector('[data-testid="composer-send-button"]')),
  projectList: Boolean(document.querySelector('.brain-project-list')),
  resourcePanel: Boolean(document.querySelector('.brain-resource-panel')),
  workspaceMenu: Boolean(document.querySelector('.brain-workspace-menu')),
  bodyHead: document.body.innerText.slice(0, 800)
}))()`);
console.log(JSON.stringify(s, null, 2));
await c.close({ keepProcess: true });

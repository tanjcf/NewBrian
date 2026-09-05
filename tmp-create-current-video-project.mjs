import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c = await createSceneTestCdpClient(9570);
await c.switchWorkspace('video');
if (!(await c.evaluate(`Boolean(document.querySelector('.project-name-dialog'))`))) {
  await c.mouseClickButtonText('+', '.projects-section');
  await new Promise((r) => setTimeout(r, 400));
  await c.mouseClickButtonText('新建空白项目', '.project-create-menu');
  await new Promise((r) => setTimeout(r, 500));
}
const input = await c.evaluate(`[...document.querySelectorAll('input')].map((x) => ({ placeholder: x.placeholder, value: x.value }))`);
console.log(JSON.stringify(input));
await c.clearAndType('input', '视频制作自动化验收');
await c.mouseClickButtonText('保存', '.project-name-dialog');
await new Promise((r) => setTimeout(r, 1200));
console.log(JSON.stringify(await c.evaluate(`({ scene: JSON.parse(localStorage.getItem('brain.workspaceSelection.v2') || '{}').selectedWorkspaceKey, text: document.body.innerText.slice(0, 1200) })`), null, 2));
await c.close();

import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); await c.mouseClickSelector('button[aria-label="添加项目"]'); await new Promise(r=>setTimeout(r,500)); console.log(await c.evaluate(`document.body.innerText.slice(0,2200)`)); c.close();

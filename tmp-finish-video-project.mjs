import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); await c.clearAndType('input','视频制作E2E验收'); await c.mouseClickButtonText('保存'); await new Promise(r=>setTimeout(r,1000)); console.log(await c.evaluate(`document.body.innerText.slice(0,1000)`)); c.close();

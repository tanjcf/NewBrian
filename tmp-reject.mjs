import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); await c.mouseClickButtonText('拒绝'); await new Promise(r=>setTimeout(r,1500)); console.log((await c.evaluate(`document.body.innerText.slice(-1000)`))); c.close();

import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); await c.mouseClickButtonText('批准并继续'); await new Promise(r=>setTimeout(r,30000)); console.log((await c.evaluate(`document.body.innerText.slice(-3500)`))); c.close();

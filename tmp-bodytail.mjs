import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); console.log(await c.evaluate(`document.body.innerText.slice(-2500)`)); c.close();

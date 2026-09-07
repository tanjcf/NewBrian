import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566); await c.mouseClickSelector('.project-subsection-toggle'); await new Promise(r=>setTimeout(r,400)); console.log(await c.evaluate(`document.body.innerText.slice(0,700)`)); c.close();

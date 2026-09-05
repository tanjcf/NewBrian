import { createSceneTestCdpClient } from './platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs';
const c=await createSceneTestCdpClient(9566);
console.log(await c.evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((b,i)=>({i,t:b.textContent?.trim(),a:b.getAttribute('aria-label'),title:b.title,cls:b.className})).filter(x=>x.t||x.a||x.title))`));
c.close();

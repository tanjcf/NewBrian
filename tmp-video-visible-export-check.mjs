import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const c = await createSceneTestCdpClient(9356);
const clickText = async (value) => {
  const p = await c.evaluate(`(()=>{const e=[...document.querySelectorAll('button,[role=button]')].find(x=>x.textContent?.trim()===${JSON.stringify(value)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:Math.round(screenX+r.left+r.width/2),y:Math.round(screenY+r.top+r.height/2)}})()`);
  if (!p) throw new Error(`not found: ${value}`);
  await osMouseClick(p.x,p.y); await new Promise(r=>setTimeout(r,1500));
};
await clickText("导出");
let shot=await c.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
await writeFile("evidence/VIDEO-E2E-REAL-002/export-tab-visible.png",Buffer.from(shot.data,"base64"));
const body=await c.evaluate("document.body.innerText.slice(-12000)");
console.log(body);
await c.close({preserveWorkspace:true});

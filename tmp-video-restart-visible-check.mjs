import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const c=await createSceneTestCdpClient(9356), projectName="视频E2E青石谷-1787599877761";
const dir="evidence/VIDEO-E2E-REAL-002/restart-recovery";await mkdir(dir,{recursive:true});
const click=async(value)=>{const p=await c.evaluate(`(()=>{const e=[...document.querySelectorAll('button,[role=button],div,span')].find(x=>x.textContent?.trim()===${JSON.stringify(value)}&&x.getBoundingClientRect().width>0);if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:Math.round(screenX+r.left+r.width/2),y:Math.round(screenY+r.top+r.height/2)}})()`);assert.ok(p,value);await osMouseClick(p.x,p.y);await new Promise(r=>setTimeout(r,800));};
await c.waitFor("document.body.innerText.includes('新对话')",60000);
if(!await c.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`)) await click("视频制作");
for(let i=0;i<4;i++){if(await c.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`))break;await click("显示更多");}
const selected=await c.evaluate(`document.body.innerText.includes(${JSON.stringify("视频E2E青石谷-1787599877761")})`);
if(!selected){await click(projectName);await new Promise(r=>setTimeout(r,1500));}
await osMouseClick(700,70);await new Promise(r=>setTimeout(r,500));
const shot=await c.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(`${dir}/restored.png`,Buffer.from(shot.data,"base64"));
const body=await c.evaluate("document.body.innerText.slice(-10000)");await writeFile(`${dir}/visible-state.txt`,body);console.log(body.slice(-3000));await c.close({preserveWorkspace:true});

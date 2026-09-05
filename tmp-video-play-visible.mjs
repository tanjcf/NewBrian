import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const c=await createSceneTestCdpClient(9356);
const p=await c.evaluate(`(()=>{const e=document.querySelector('video');if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
if(!p)throw new Error("visible video not found");await osMouseClick(p.x,p.y);await new Promise(r=>setTimeout(r,3200));
const state=await c.evaluate(`(()=>{const e=document.querySelector('video');return{currentTime:e?.currentTime,duration:e?.duration,paused:e?.paused,readyState:e?.readyState,volume:e?.volume}})()`);
const shot=await c.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile("evidence/VIDEO-E2E-REAL-002-AUDIO/visible-playback.png",Buffer.from(shot.data,"base64"));console.log(JSON.stringify({mouse:p,state},null,2));await c.close({preserveWorkspace:true});

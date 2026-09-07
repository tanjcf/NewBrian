import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const execFileAsync=promisify(execFile), projectName="视频E2E青石谷-1787599877761";
const evidenceDir=`evidence/VIDEO-E2E-REAL-002-CONTINUE/${new Date().toISOString().replace(/[:.]/g,"-")}`;
await mkdir(evidenceDir,{recursive:true});
const evidence={caseId:"VIDEO-E2E-REAL-002-CONTINUE",projectName,result:"PARTIAL",actions:[],checkpoints:[]};
async function paste(value){const b64=Buffer.from(value,"utf16le").toString("base64");await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`],{windowsHide:true});await osKeyCombo(true,"v");}
async function point(c,selector,exact=""){const v=await c.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)})||document.body;const el=${exact?`[...root.querySelectorAll('button,[role=button],[data-testid]')].find(n=>n.textContent?.trim()===${JSON.stringify(exact)})`:"root"};if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(window.screenX+r.left+r.width/2),y:Math.round(window.screenY+r.top+r.height/2)}})()`);assert.ok(v,`${selector} ${exact}`);return v;}
async function click(c,s,t=""){const p=await point(c,s,t);await osMouseClick(p.x,p.y);await new Promise(r=>setTimeout(r,500));evidence.actions.push({method:"Windows SendInput mouse",target:t||s,x:p.x,y:p.y});}
async function shot(c,n){const r=await c.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false}),p=`${evidenceDir}/${n}.png`;await writeFile(p,Buffer.from(r.data,"base64"));evidence.checkpoints.push(p);}
async function state(c){return c.evaluate(`(()=>({body:document.body.innerText.slice(0,30000),buttons:[...document.querySelectorAll('button')].filter(x=>x.offsetParent).map(x=>({text:x.textContent?.trim(),testid:x.dataset.testid,title:x.title}))}))()`);}
const c=await createSceneTestCdpClient(Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT||9356));
try{
 await c.waitFor("document.readyState==='complete'",30000); await c.waitFor("document.body.innerText.includes('新对话')",60000); await shot(c,"00-start");
 const video=await c.evaluate(`(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='视频制作')?true:false)()`); if(video)await click(c,"body","视频制作");
 for(let reveal=0;reveal<4;reveal++){const found=await c.evaluate(`(()=>[...document.querySelectorAll('button,[role=button]')].some(x=>x.textContent?.trim()===${JSON.stringify(projectName)}))()`);if(found)break;const more=await c.evaluate(`(()=>[...document.querySelectorAll('button')].some(x=>x.textContent?.trim()==='显示更多'))()`);if(!more)break;await click(c,"body","显示更多");}
 await click(c,"body",projectName); await new Promise(r=>setTimeout(r,1000));
 await click(c,'[data-testid="sidebar-project-task-row"]'); await shot(c,"01-project-thread-restored");
 const prompt="只能使用右侧 video.* Tools，严禁 shell、exec、PowerShell 和通用文件工具。先用 video.project.inspect 确认当前青石谷工程已有两个视频片段、Kokoro 中文配音、环境音和两条字幕；不要重复生成或添加任何轨道。立即调用 video.render.start 导出 exports/qingshigu-accepted.mp4，并用 video.render.status 轮询到 SUCCEEDED。这次渲染必须按时间线设置输出 1920×1080、30fps、8秒、H.264 MP4，并包含烧录字幕、中文旁白和环境音。";
 await click(c,'[data-testid="composer-input"]');await paste(prompt);evidence.actions.push({method:"Windows clipboard + Ctrl+V",target:"visible composer",text:prompt});await shot(c,"02-prompt");await click(c,'[data-testid="composer-send-button"]');
 const deadline=Date.now()+8*60_000;let i=3,last="";while(Date.now()<deadline){await new Promise(r=>setTimeout(r,10000));const s=await state(c);last=s.body;const approval=s.buttons.find(b=>b.text==="批准并继续");if(approval)await click(c,"body","批准并继续");await shot(c,`${String(i++).padStart(2,"0")}-progress`);evidence.progress=s;await writeFile(`${evidenceDir}/evidence.json`,JSON.stringify(evidence,null,2));}
 evidence.finalState=await state(c);await shot(c,"99-final");
}catch(e){evidence.result="FAIL";evidence.error=e.stack||String(e);try{await shot(c,"98-failure");}catch{}}finally{await writeFile(`${evidenceDir}/evidence.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify({evidenceDir,result:evidence.result,error:evidence.error},null,2));await c.close({preserveWorkspace:true});}

import { access, mkdir, writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
const dir=`evidence/VIDEO-E2E-REAL-002-AUDIO/${new Date().toISOString().replace(/[:.]/g,"-")}`;await mkdir(dir,{recursive:true});
const output="C:/Users/Administrator/.codecn/.codecn/projects/视频E2E青石谷-1787599877761/exports/qingshigu-final-pass.mp4";
const c=await createSceneTestCdpClient(9356), evidence={actions:[],screenshots:[],output};
for(let i=0;i<48;i++){await new Promise(r=>setTimeout(r,10000));const s=await c.evaluate(`(()=>({body:document.body.innerText.slice(-25000),buttons:[...document.querySelectorAll('button')].filter(x=>x.offsetParent).map(x=>({text:x.textContent?.trim(),title:x.title}))}))()`);const approval=s.buttons.find(x=>x.text==="批准并继续");if(approval){const p=await c.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='批准并继续');const r=e.getBoundingClientRect();return{x:Math.round(screenX+r.left+r.width/2),y:Math.round(screenY+r.top+r.height/2)}})()`);await osMouseClick(p.x,p.y);evidence.actions.push({method:"Windows SendInput mouse",target:"批准并继续",...p});}
 const shot=await c.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});const path=`${dir}/${String(i).padStart(2,"0")}.png`;await writeFile(path,Buffer.from(shot.data,"base64"));evidence.screenshots.push(path);evidence.visible=s;await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
 try{await access(output);if(!s.buttons.some(x=>x.title==="当前对话正在处理中"))break;}catch{}
}
await c.close({preserveWorkspace:true});console.log(JSON.stringify({dir,output},null,2));

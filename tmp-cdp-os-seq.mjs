import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const pages = await (await fetch("http://127.0.0.1:9555/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
let id=0; const command=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; const t=setTimeout(()=>reject(new Error("timeout")),30000); const L=(e)=>{const p=JSON.parse(e.data); if(p.id!==mid)return; clearTimeout(t); socket.removeEventListener("message",L); if(p.error||p.result?.exceptionDetails) reject(new Error("err")); else resolve(p.result);}; socket.addEventListener("message",L); socket.send(JSON.stringify({id:mid,method,params}));});
const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;

async function osClick(x,y){
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WinInput {
  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  public static void LeftClick(int x, int y) { SetCursorPos(x,y); System.Threading.Thread.Sleep(80); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(40); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
}
"@
[WinInput]::LeftClick(${Math.round(x)}, ${Math.round(y)})
`;
  await execFileAsync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", ps], { windowsHide: true });
  await new Promise(r=>setTimeout(r,400));
}

const pt = await evaluate(`(() => {
  const el = [...document.querySelectorAll("button")].find((b)=>(b.textContent||"").trim()==="全片序列");
  if (!el) return null;
  el.scrollIntoView({block:"center", inline:"center"});
  const r = el.getBoundingClientRect();
  const frameTop = Math.max(0, window.outerHeight - window.innerHeight);
  const frameLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth)/2));
  return { x: Math.round(window.screenX + frameLeft + r.left + r.width/2), y: Math.round(window.screenY + frameTop + r.top + r.height/2), className: el.className };
})()`);
console.log("point", pt);
if (pt) await osClick(pt.x, pt.y);
const after = await evaluate(`(() => {
  const active = [...document.querySelectorAll("button")].filter(b=>/本镜|全片序列/.test((b.textContent||"").trim())).map(b=>({t:(b.textContent||"").trim(), c:b.className}));
  const clips = [...document.querySelectorAll(".brain-video-nle__clip")].map(el=>(el.getAttribute("title")||el.textContent||"").replace(/\\s+/g," ").slice(0,70));
  return { active, clipCount: clips.length, clips };
})()`);
console.log(JSON.stringify(after,null,2));
socket.close();

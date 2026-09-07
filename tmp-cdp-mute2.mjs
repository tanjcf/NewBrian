const pages = await (await fetch("http://127.0.0.1:9555/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
let id=0; const command=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; const t=setTimeout(()=>reject(new Error("timeout")),30000); const L=(e)=>{const p=JSON.parse(e.data); if(p.id!==mid)return; clearTimeout(t); socket.removeEventListener("message",L); if(p.error||p.result?.exceptionDetails) reject(new Error("err")); else resolve(p.result);}; socket.addEventListener("message",L); socket.send(JSON.stringify({id:mid,method,params}));});
const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
const info = await evaluate(`(() => {
  const mutes = [...document.querySelectorAll("button")].filter((b) => /^M$/.test((b.textContent||"").trim()));
  return mutes.map((b,i) => {
    const parent = b.parentElement;
    const row = b.closest("[class*='lane'],[class*='track'],[class*='nle']") || parent;
    return {
      i,
      className: b.className,
      aria: b.getAttribute("aria-pressed"),
      title: b.getAttribute("title"),
      parentText: (parent?.textContent||"").replace(/\\s+/g," ").slice(0,80),
      rowText: (row?.textContent||"").replace(/\\s+/g," ").slice(0,120),
      rowClass: row?.className || ""
    };
  });
})()`);
// Toggle first mute and compare second
const result = await evaluate(`(() => {
  const mutes = [...document.querySelectorAll("button")].filter((b) => /^M$/.test((b.textContent||"").trim()));
  if (mutes.length < 2) return { ok:false, count: mutes.length };
  const snap = (b)=>({cls:b.className, aria:b.getAttribute("aria-pressed")});
  const before = mutes.map(snap);
  mutes[0].click();
  const after = mutes.map(snap);
  mutes[0].click();
  const restored = mutes.map(snap);
  const otherUnchanged = before.slice(1).every((b,i) => b.cls===after[i+1].cls && b.aria===after[i+1].aria);
  const firstChanged = before[0].cls!==after[0].cls || before[0].aria!==after[0].aria;
  return { ok:true, count: mutes.length, otherUnchanged, firstChanged, before, after, restored };
})()`);
// linked clips / 本镜 filter: click 本镜 vs 全片 and count clips
const filter = await evaluate(`(() => {
  const clickLabel = (label) => {
    const el = [...document.querySelectorAll("button,[role=button],label,span,div")].find((n) => (n.textContent||"").trim()===label);
    if (el) { el.click(); return true; }
    return false;
  };
  const countClips = () => document.querySelectorAll(".brain-video-nle__clip").length;
  const linked = () => document.querySelectorAll(".brain-video-nle__clip--linked").length;
  clickLabel("全片序列");
  const seq = { clips: countClips(), linked: linked() };
  clickLabel("本镜");
  const shot = { clips: countClips(), linked: linked() };
  return { seq, shot };
})()`);
console.log(JSON.stringify({info, result, filter}, null, 2));
socket.close();

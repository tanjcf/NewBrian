const pages = await (await fetch("http://127.0.0.1:9555/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
let id=0; const command=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; const t=setTimeout(()=>reject(new Error("timeout")),30000); const L=(e)=>{const p=JSON.parse(e.data); if(p.id!==mid)return; clearTimeout(t); socket.removeEventListener("message",L); if(p.error||p.result?.exceptionDetails) reject(new Error("err")); else resolve(p.result);}; socket.addEventListener("message",L); socket.send(JSON.stringify({id:mid,method,params}));});
const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
const modes = await evaluate(`(() => {
  const candidates = [...document.querySelectorAll("button,[role=button],label")].filter((n) => /本镜|全片/.test((n.textContent||"").trim()));
  return candidates.map((n) => ({text:(n.textContent||"").trim().slice(0,40), className:n.className, aria:n.getAttribute("aria-pressed"), pressed:n.getAttribute("data-state")}));
})()`);
const filter2 = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll("button")].filter((n) => /本镜|全片序列/.test((n.textContent||"").trim()));
  const clipMeta = () => [...document.querySelectorAll(".brain-video-nle__clip")].map((el) => ({
    className: el.className,
    title: el.getAttribute("title")||"",
    text: (el.textContent||"").replace(/\\s+/g," ").slice(0,60)
  }));
  const clickExact = (label) => {
    const el = buttons.find((b) => (b.textContent||"").trim() === label) || [...document.querySelectorAll("button")].find((b)=>(b.textContent||"").trim()===label);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  };
  clickExact("全片序列");
  const seq = { clips: clipMeta().length, titles: clipMeta().map(c=>c.title||c.text) };
  clickExact("本镜");
  const shot = { clips: clipMeta().length, titles: clipMeta().map(c=>c.title||c.text) };
  return { buttons: buttons.map(b=>(b.textContent||"").trim()), seq, shot };
})()`);
// Mute isolation evidence: already distinct states
const muteStates = await evaluate(`(() => {
  const mutes = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title")||"") === "Mute (M)");
  return {
    count: mutes.length,
    states: mutes.map((b)=>({on:b.classList.contains("brain-video-nle__toggle--mute-on"), aria:b.getAttribute("aria-pressed")})),
    isolated: mutes.length>=2 && new Set(mutes.map(b=>b.classList.contains("brain-video-nle__toggle--mute-on"))).size > 1
  };
})()`);
console.log(JSON.stringify({modes, filter2, muteStates}, null, 2));
socket.close();

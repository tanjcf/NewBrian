const pages = await (await fetch("http://127.0.0.1:9555/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
let id=0; const command=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; const t=setTimeout(()=>reject(new Error("timeout")),30000); const L=(e)=>{const p=JSON.parse(e.data); if(p.id!==mid)return; clearTimeout(t); socket.removeEventListener("message",L); if(p.error||p.result?.exceptionDetails) reject(new Error(JSON.stringify(p.error||p.result.exceptionDetails))); else resolve(p.result);}; socket.addEventListener("message",L); socket.send(JSON.stringify({id:mid,method,params}));});
const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
const clicked = await evaluate(`(() => {
  const el = [...document.querySelectorAll("button,[role=tab],a,div,span")].find((n) => (n.textContent||"").trim() === "本镜音视频轨");
  if (!el) return {ok:false, reason:"tab not found"};
  el.click();
  return {ok:true, tag: el.tagName, className: el.className};
})()`);
await new Promise(r=>setTimeout(r,800));
const after = await evaluate(`(() => {
  const muteButtons = [...document.querySelectorAll("button")].filter((b) => /^M$/.test((b.textContent||"").trim()));
  const linked = document.querySelectorAll(".brain-video-nle__clip--linked").length;
  const lanes = document.querySelectorAll(".brain-video-nle__lane, .brain-video-nle__track-header, [data-lane-id]").length;
  const textHas = /A1|A2|V1|全片序列|本镜/.test(document.body.innerText||"");
  return { muteButtons: muteButtons.length, linked, lanes, textHas, snippet: (document.body.innerText||"").replace(/\\s+/g," ").slice(0,300) };
})()`);
const interact = await evaluate(`(() => {
  const headers = [...document.querySelectorAll(".brain-video-nle__track-header, .brain-video-nle__lane-header, .brain-video-nle__lane")];
  const findMute = (label) => {
    const lane = headers.find((el) => (el.textContent||"").includes(label));
    if (!lane) return null;
    return [...lane.querySelectorAll("button")].find((b) => /^M$/.test((b.textContent||"").trim()));
  };
  const a1 = findMute("A1");
  const a2 = findMute("A2");
  if (!a1 || !a2) return { ok:false, reason:"missing", headers: headers.map(h=> (h.textContent||"").slice(0,40)), a1:!!a1, a2:!!a2 };
  const snap = (b)=>({cls:b.className, aria:b.getAttribute("aria-pressed")});
  const before={a1:snap(a1),a2:snap(a2)};
  a1.click();
  const after={a1:snap(a1),a2:snap(a2)};
  a1.click();
  return { ok:true, a2Unchanged: before.a2.cls===after.a2.cls && before.a2.aria===after.a2.aria, a1Changed: before.a1.cls!==after.a1.cls || before.a1.aria!==after.a1.aria, before, after };
})()`);
console.log(JSON.stringify({clicked, after, interact}, null, 2));
socket.close();

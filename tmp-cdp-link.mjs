const pages = await (await fetch("http://127.0.0.1:9555/json/list")).json();
const page = pages.find(p=>p.type==="page"&&p.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
let id=0; const command=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; const t=setTimeout(()=>reject(new Error("timeout")),20000); const L=(e)=>{const p=JSON.parse(e.data); if(p.id!==mid)return; clearTimeout(t); socket.removeEventListener("message",L); if(p.error||p.result?.exceptionDetails) reject(new Error("err")); else resolve(p.result);}; socket.addEventListener("message",L); socket.send(JSON.stringify({id:mid,method,params}));});
const evaluate=async(expression)=>(await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
const info = await evaluate(`(() => {
  const clips = [...document.querySelectorAll(".brain-video-nle__clip")];
  return {
    count: clips.length,
    linked: clips.filter(c=>c.classList.contains("brain-video-nle__clip--linked")).length,
    titles: clips.map(c=>({title:(c.getAttribute("title")||"").slice(0,80), linked:c.classList.contains("brain-video-nle__clip--linked"), cls:c.className}))
  };
})()`);
console.log(JSON.stringify(info,null,2));
socket.close();

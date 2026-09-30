import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import * as os from "node:os";
import type { MobilePairingState } from "@codex-forge/protocol";

export interface MobilePairingCredentials {
  token: string;
  code: string;
  expiresAt: string;
}

/** Validates pairing credentials and binds a pairing session to its first client address. */
export class MobilePairingGuard {
  private credentials: MobilePairingCredentials | null = null;
  private clientAddress = "";

  configure(credentials: MobilePairingCredentials) {
    this.credentials = { ...credentials };
    this.clientAddress = "";
  }

  /**
   * Authorizes access to the pairing page using only the QR token. The six-digit
   * code is intentionally NOT required here so it can act as a real second factor
   * that the user must type manually before any data is exposed.
   */
  authorizePage(input: { token: string; clientAddress: string; now?: number }) {
    if (!this.credentials || !input.clientAddress) return false;
    if (input.token !== this.credentials.token) return false;
    if ((input.now ?? Date.now()) > new Date(this.credentials.expiresAt).getTime()) return false;
    if (this.clientAddress && input.clientAddress !== this.clientAddress) return false;
    return true;
  }

  /**
   * Authorizes access to data endpoints. Requires both the QR token and the
   * six-digit code (which is displayed only on the desktop and never embedded in
   * the QR link), and binds the pairing session to the first client address.
   */
  authorize(input: { token: string; code: string; clientAddress: string; now?: number }) {
    if (!this.credentials || !input.clientAddress) return false;
    if (input.token !== this.credentials.token || input.code !== this.credentials.code) return false;
    if ((input.now ?? Date.now()) > new Date(this.credentials.expiresAt).getTime()) return false;
    if (this.clientAddress && input.clientAddress !== this.clientAddress) return false;
    if (!this.clientAddress) this.clientAddress = input.clientAddress;
    return true;
  }

  reset() {
    this.credentials = null;
    this.clientAddress = "";
  }
}

export interface MobileBridgeProjection {
  projects: Array<{ id: string; name: string }>;
  chats: Array<{ id: string; workspaceId: string; title: string; status: string }>;
}

interface MobileBridgeServiceOptions {
  getProjection: () => Promise<MobileBridgeProjection>;
  onAction: (action: unknown) => void;
  getLocalAddress?: () => string;
}

const stoppedState = (): MobilePairingState => ({
  status: "stopped",
  url: "",
  code: "",
  deviceName: "",
  expiresAt: ""
});

function getLocalIpv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}

function mobilePageHtml(token: string) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NewBrain Mobile</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#17191d;font:15px system-ui,-apple-system,sans-serif}
main{max-width:520px;margin:auto;padding:24px 20px 100px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}
h1{margin:0;font-size:29px}small{color:#6f7782}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#20b15a;margin-right:6px}
h2{font-size:14px;margin:28px 0 10px}.row{width:100%;display:flex;align-items:center;gap:10px;min-height:46px;border:0;border-bottom:1px solid #eef0f2;border-radius:0;background:transparent;color:#17191d;padding:0;text-align:left;font-weight:400}
.row b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.folder{font-size:20px}.status{color:#168f42}
footer{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:14px 20px}
footer div{max-width:480px;margin:auto;display:flex;gap:10px}input{flex:1;height:44px;border:1px solid #dfe3e8;border-radius:22px;padding:0 16px}
footer button{border:0;border-radius:22px;background:#0787f8;color:#fff;padding:0 20px;font-weight:650}
#gate{max-width:360px;margin:60px auto;text-align:center}#gate h1{font-size:26px;margin-bottom:8px}#gate p{color:#6f7782;margin:0 0 24px}
#gate input{width:100%;height:52px;font-size:22px;letter-spacing:8px;text-align:center;border:1px solid #dfe3e8;border-radius:12px;margin-bottom:14px}
#gate button{width:100%;height:48px;border:0;border-radius:12px;background:#0787f8;color:#fff;font-weight:650;font-size:16px}
#gate .err{color:#d1242f;min-height:20px;margin-top:12px}
</style></head><body>
<section id="gate"><h1>输入配对码</h1><p>在桌面端 NewBrain 上查看 6 位配对码，并在此输入以完成连接。</p>
<input id="code" inputmode="numeric" maxlength="6" placeholder="000000" autofocus><button id="connect">连接</button><div class="err" id="gate-err"></div></section>
<main hidden><header><div><h1>NewBrain</h1><small><span class="dot"></span>已连接桌面端</small></div><b>•••</b></header>
<section id="content">正在同步项目...</section></main><footer hidden><div><input placeholder="搜索聊天"><button>聊天</button></div></footer>
<script>
const token=${JSON.stringify(token)};let code="";
let state={projects:[],chats:[]};const content=document.querySelector('#content');const search=document.querySelector('main input');
const gate=document.querySelector('#gate');const main=document.querySelector('main');const footer=document.querySelector('footer');
const query=()=>'?token='+encodeURIComponent(token)+'&code='+encodeURIComponent(code);
async function action(payload){await fetch('/api/action'+query(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}
function row(label,meta,onClick,folder){const button=document.createElement('button');button.className='row';button.onclick=onClick;if(folder){const icon=document.createElement('span');icon.className='folder';icon.textContent='▱';button.append(icon)}const title=document.createElement('b');title.textContent=label;button.append(title);const suffix=document.createElement('span');suffix.className=meta?'status':'';suffix.textContent=meta||'›';button.append(suffix);return button}
function render(){const keyword=search.value.trim().toLowerCase();content.replaceChildren();const projectTitle=document.createElement('h2');projectTitle.textContent='项目';content.append(projectTitle);for(const p of state.projects.filter(x=>x.name.toLowerCase().includes(keyword))){content.append(row(p.name,'',()=>action({action:'select-project',workspaceId:p.id}),true))}const chatTitle=document.createElement('h2');chatTitle.textContent='聊天';content.append(chatTitle);for(const c of state.chats.filter(x=>x.title.toLowerCase().includes(keyword))){content.append(row(c.title,c.status,()=>action({action:'select-thread',workspaceId:c.workspaceId,threadId:c.id}),false))}}
async function refresh(){const response=await fetch('/api/state'+query());if(!response.ok){return false}state=await response.json();render();return true}
async function connect(){const value=document.querySelector('#code').value.trim();if(!/^[0-9]{6}$/.test(value)){document.querySelector('#gate-err').textContent='请输入 6 位数字配对码。';return}code=value;const ok=await refresh();if(!ok){code="";document.querySelector('#gate-err').textContent='配对码不正确或已过期。';return}gate.hidden=true;main.hidden=false;footer.hidden=false;setInterval(refresh,2000)}
document.querySelector('#connect').onclick=connect;document.querySelector('#code').addEventListener('keydown',(e)=>{if(e.key==='Enter')connect()});
search.addEventListener('input',render);footer.querySelector('button').onclick=()=>action({action:'new-chat'});
</script></body></html>`;
}

export class MobileBridgeService {
  private server: HttpServer | null = null;
  private state = stoppedState();
  private readonly guard = new MobilePairingGuard();
  private readonly options: MobileBridgeServiceOptions;

  constructor(options: MobileBridgeServiceOptions) {
    this.options = options;
  }

  getStatus() {
    return structuredClone(this.state);
  }

  async start(): Promise<MobilePairingState> {
    await this.closeServer();
    const token = randomUUID();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.guard.configure({ token, code, expiresAt });
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        const clientAddress = request.socket.remoteAddress ?? "";
        const requestToken = requestUrl.searchParams.get("token") ?? "";
        const isDataEndpoint = requestUrl.pathname === "/api/state" || requestUrl.pathname === "/api/action";

        if (!isDataEndpoint) {
          if (!this.guard.authorizePage({ token: requestToken, clientAddress })) {
            response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Pairing link expired.");
            return;
          }
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(mobilePageHtml(token));
          return;
        }

        const authorized = this.guard.authorize({
          token: requestToken,
          code: requestUrl.searchParams.get("code") ?? "",
          clientAddress
        });
        if (!authorized) {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Pairing code required.");
          return;
        }
        this.state = {
          ...this.state,
          status: "connected",
          deviceName: request.headers["user-agent"]?.slice(0, 80) || "移动设备"
        };
        if (requestUrl.pathname === "/api/state") {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify(await this.options.getProjection()));
          return;
        }
        if (requestUrl.pathname === "/api/action" && request.method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size > 64 * 1024) throw new Error("Mobile action payload is too large.");
            chunks.push(buffer);
          }
          let action: unknown;
          try { action = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { throw new Error("Invalid action payload."); }
          this.options.onAction(action);
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: false, detail: "Not found." }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: false, detail: error instanceof Error ? error.message : String(error) }));
      }
    });
    const host = this.options.getLocalAddress?.() ?? getLocalIpv4Address();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // Bind to the resolved LAN interface instead of 0.0.0.0 to reduce exposure.
      server.listen(0, host, resolve);
    });
    this.server = server;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    // The six-digit code is intentionally NOT embedded in the URL/QR; the user
    // must read it from the desktop and type it on the phone as a second factor.
    this.state = { status: "waiting", url: `http://${host}:${port}/?token=${token}`, code, deviceName: "", expiresAt };
    return this.getStatus();
  }

  async stop() {
    await this.closeServer();
    this.guard.reset();
    this.state = stoppedState();
    return this.getStatus();
  }

  private async closeServer() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

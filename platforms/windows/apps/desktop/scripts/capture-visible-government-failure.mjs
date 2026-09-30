import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
if (!page) throw new Error("No visible NewBrain renderer is available.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), 30_000);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolveCommand(payload.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const evaluated = await command("Runtime.evaluate", {
  expression: `(async () => {
    const catalog = await window.newbrain.listWorkspaces();
    const workspace = catalog.find((item) => item.name === "workspace");
    const snapshot = await window.newbrain.getSnapshot();
    const goal = await window.newbrain.getGoalExecution();
    const activeProjectRows = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')]
      .map((element) => ({ text: element.innerText.trim(), active: element.classList.contains("active") }));
    return {
      capturedAt: new Date().toISOString(),
      pageTitle: document.title,
      workspace: workspace ? {
        id: workspace.id,
        path: workspace.path,
        threads: workspace.threads.map((thread) => ({
          id: thread.id,
          title: thread.title,
          status: thread.status,
          updatedAt: thread.updatedAt
        }))
      } : null,
      activeProjectRows,
      standaloneTaskCount: document.querySelectorAll('[data-testid="sidebar-task-row"]').length,
      userMessages: [...document.querySelectorAll('.request-bubble')].map((element) => element.innerText.trim()),
      assistantText: [...document.querySelectorAll('.assistant-block')].map((element) => element.innerText.trim()),
      errorBanners: [...document.querySelectorAll('.error-banner, .alert-error')].map((element) => element.innerText.trim()),
      goal,
      snapshot: {
        chatStatus: snapshot?.chatStatus,
        session: snapshot?.session,
        messages: snapshot?.messages,
        runs: snapshot?.runs,
        events: snapshot?.events
      },
      bodyTail: document.body?.innerText?.slice(-12000) || ""
    };
  })()`,
  returnByValue: true,
  awaitPromise: true
});
const evidence = evaluated.result.value;
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const outputDirectory = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001", "round-1-real-project");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "failure.json"), `${JSON.stringify({
  caseId: "GOV-UI-MULTI-001",
  status: "FAIL",
  failedPhase: "round-1-outline-confirmation",
  laterRounds: [2, 3, 4, 5, 6].map((round) => ({ round, status: "NOT RUN" })),
  evidence
}, null, 2)}\n`, "utf8");
writeFileSync(resolve(outputDirectory, "failure.png"), Buffer.from(screenshot.data, "base64"));
console.log(JSON.stringify({
  outputDirectory,
  workspace: evidence.workspace,
  activeProjectRows: evidence.activeProjectRows,
  standaloneTaskCount: evidence.standaloneTaskCount,
  userMessageCount: evidence.userMessages.length,
  goalStatus: evidence.goal?.goal?.status,
  pendingQuestion: evidence.goal?.pendingQuestion || null,
  chatStatus: evidence.snapshot?.chatStatus,
  errorBanners: evidence.errorBanners
}, null, 2));
socket.close();

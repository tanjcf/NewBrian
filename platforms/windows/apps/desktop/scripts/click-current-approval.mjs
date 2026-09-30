import assert from "node:assert/strict";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()))
  .find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No visible NewBrain renderer is available.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const result = await new Promise((resolveResult, reject) => {
  const id = 1;
  const timeout = setTimeout(() => reject(new Error("Approval click timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== id) return;
    clearTimeout(timeout);
    resolveResult(payload.result?.result?.value);
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: {
      returnByValue: true,
      expression: `(() => {
        const button = document.querySelector('[data-testid="approval-approve-button"]');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return JSON.stringify({ clicked: false, dialog: document.querySelector('[data-testid="approval-dialog"]')?.innerText || '', body: document.body.innerText.slice(-1200) });
        button.click();
        return JSON.stringify({ clicked: true });
      })()`
    }
  }));
});
const state = JSON.parse(String(result));
assert.equal(state.clicked, true, `No enabled approval button is visible: ${JSON.stringify(state)}`);
console.log("Clicked the visible NewBrain approval button.");
socket.close();

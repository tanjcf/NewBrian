import assert from "node:assert/strict";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9666);
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No packaged NewBrain renderer is available.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("DOM inspection timed out.")), 10_000);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id !== 1) return;
    clearTimeout(timeout);
    resolve(payload.result?.result?.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `({
        label: document.querySelector('.chat-subsection-head .project-subsection-label')?.textContent?.trim() || '',
        newChatTitle: document.querySelector('.chat-subsection-head .chat-add-button')?.getAttribute('title') || '',
        body: document.body.innerText
      })`,
      returnByValue: true
    }
  }));
});
assert.equal(result.label, "聊天");
assert.equal(result.newChatTitle, "新建聊天");
assert.doesNotMatch(result.body, /Renderer failed to start/u);
console.log(JSON.stringify({ status: "PASS", label: result.label, newChatTitle: result.newChatTitle }, null, 2));
socket.close();

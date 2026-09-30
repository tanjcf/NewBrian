import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const session = await ensureElectronE2ESession(9341);
const page = session.pages.find(item => item.type === "page" && item.webSocketDebuggerUrl);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const data = JSON.parse(event.data);
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  clearTimeout(entry.timer);
  if (data.error || data.result?.exceptionDetails) entry.reject(new Error(JSON.stringify(data.error || data.result.exceptionDetails)));
  else entry.resolve(data.result);
});
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${params.expression || ''}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async expression => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expression) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Not ready: ${expression}`);
}
const output = resolve(process.env.NEWBRAIN_LAYOUT_EVIDENCE || "../../../../evidence/video-layout-n1");
await mkdir(output, { recursive: true });
try {
  await waitFor("Boolean(window.newbrain && document.querySelector('.task-column'))");
  const root = await mkdtemp(join(tmpdir(), "brain-layout-project-"));
  const projectId = await evaluate(`(async () => {
    const catalog = await window.newbrain.addWorkspace({ name: '视频创作', path: ${JSON.stringify(root)} });
    const local = catalog.find(item => item.path === ${JSON.stringify(root)});
    const project = await window.newbrain.createBrainProject({ name: '城市印象短片', primaryWorkspaceKey: 'video', localWorkspaceId: local.id });
    localStorage.setItem('brain.resource-panel-width', '480');
    localStorage.setItem('brain.workspaceSelection.v2', JSON.stringify({ version: 2, selectedWorkspaceKey: 'video', catalogs: { video: { projectId: project.id, conversationId: '' } } }));
    return project.id;
  })()`);
  await command("Page.reload");
  await waitFor("Boolean(document.querySelector('.video-script-workbench article'))");
  await waitFor("document.querySelector('.brain-resource-header')?.textContent.includes('城市印象短片')");
  const results = [];
  for (const width of [1520, 1920]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 936, deviceScaleFactor: 1, mobile: false });
    await waitFor("Boolean(document.querySelector('.task-column') && document.querySelector('.brain-resource-panel') && document.querySelector('.video-script-workbench article'))");
    await new Promise(resolve => setTimeout(resolve, 300));
    const sizes = await evaluate(`(() => {
      const rect = selector => { const el = document.querySelector(selector); if (!el) throw new Error('Missing layout element: ' + selector); const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, scroll:el.scrollWidth, client:el.clientWidth }; };
      return { chat:rect('.task-column'), tools:rect('.brain-resource-panel'), script:rect('.video-script-workbench article'), fields:[...document.querySelectorAll('.video-script-workbench article:first-of-type>label')].map(el=>{ const r=el.getBoundingClientRect();return { x:r.x,width:r.width }; }), cards:[...document.querySelectorAll('.new-chat-integrations button')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}) };
    })()`);
    assert.ok(sizes.chat.width >= 340, `Chat too narrow at ${width}`);
    assert.equal(sizes.tools.width, 480, `Original Tools width at ${width}`);
    assert.ok(sizes.tools.x + sizes.tools.width <= width + 1, `Tools overflow at ${width}`);
    assert.ok(sizes.chat.scroll <= sizes.chat.client + 1, `Chat overflows at ${width}`);
    assert.ok(sizes.cards[1].x >= sizes.cards[0].x + sizes.cards[0].width, "Original integration cards should stay in one row");
    results.push({ width, ...sizes });
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `layout-${width}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 1520, height: 936, deviceScaleFactor: 1, mobile: false });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const handle = await evaluate("(() => { const r=document.querySelector('.brain-resource-resize-handle').getBoundingClientRect();return { x:r.x+r.width/2,y:r.y+60 }; })()");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...handle, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x + 70, y: handle.y, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x + 70, y: handle.y, button: "left", clickCount: 1 });
  await waitFor("Number(localStorage.getItem('brain.resource-panel-width')) < 480");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const savedWidth = await evaluate("document.querySelector('.brain-resource-panel').getBoundingClientRect().width");
  assert.ok(savedWidth < results[0].tools.width - 40, `Dragging must change Tools width: ${results[0].tools.width} -> ${savedWidth}`);
  await command("Page.reload");
  await waitFor("Boolean(document.querySelector('.video-script-workbench article'))");
  const restored = await evaluate("document.querySelector('.brain-resource-panel').getBoundingClientRect().width");
  assert.ok(Math.abs(restored - savedWidth) < 2, "Tools width must survive reload");
  await evaluate(`(async () => {
    const local = (await window.newbrain.listWorkspaces()).find(item => item.path === ${JSON.stringify(root)});
    await window.newbrain.addWorkspaceThread({ workspaceId: local.id, title: '布局校验对话', summary: '', scope: 'chat', brainWorkspaceKey: 'video' });
  })()`);
  await command("Page.reload");
  await waitFor("[...document.querySelectorAll('.thread-row')].some(el => el.textContent.includes('布局校验对话'))");
  await evaluate("[...document.querySelectorAll('.thread-row')].find(el => el.textContent.includes('布局校验对话')).click()");
  await waitFor("document.querySelector('.task-topbar')?.getBoundingClientRect().height > 0");
  await evaluate("document.querySelector('.brain-resource-header [aria-label=\"隐藏侧栏\"]').click()");
  await waitFor("Boolean(document.querySelector('.brain-tools-restore-toggle'))");
  const overlap = await evaluate(`(() => {
    const restore = document.querySelector('.brain-tools-restore-toggle').getBoundingClientRect();
    return [...document.querySelectorAll('.task-topbar-actions button')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && Math.max(r.left,restore.left) < Math.min(r.right,restore.right) && Math.max(r.top,restore.top) < Math.min(r.bottom,restore.bottom);
    }).map(el => el.title || el.textContent);
  })()`);
  assert.deepEqual(overlap, [], 'Tools restore button must not overlap topbar actions');
  const collapsedScreenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "collapsed-toolbar.png"), Buffer.from(collapsedScreenshot.data, "base64"));
  await writeFile(join(output, "measurements.json"), JSON.stringify({ projectId, results, savedWidth, restored }, null, 2));
  console.log(JSON.stringify({ ok: true, output, results, savedWidth, restored }));
} finally {
  socket.close();
  session.close();
}

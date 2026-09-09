import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import PptxGenJS from "../../agentd/node_modules/pptxgenjs/dist/pptxgen.es.js";

const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
const session = await ensureElectronE2ESession(port);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
assert.ok(session.workspacePath, "The artifact test requires an isolated workspace.");

const projectPath = join(session.workspacePath, ".newbrain", "projects", "artifact-side-panel");
await mkdir(projectPath, { recursive: true });
await copyFile(resolve("..", "..", "..", "test-materials", "GOV-UI-MULTI-001", "安全工作纪要.docx"), join(projectPath, "安全工作纪要.docx"));
await copyFile(resolve("..", "..", "personal_intro_template.pdf"), join(projectPath, "年度总结示例.pdf"));
await writeFile(join(projectPath, "readme.txt"), "NewBrain artifact side panel\n", "utf8");
const presentation = new PptxGenJS();
presentation.layout = "LAYOUT_WIDE";
const firstSlide = presentation.addSlide();
firstSlide.background = { color: "F5F7FA" };
firstSlide.addText("NewBrain PPTX Preview", { x: 0.8, y: 0.7, w: 7.8, h: 0.7, fontSize: 28, bold: true, color: "173B67" });
firstSlide.addText("Selectable, offline presentation rendering", { x: 0.8, y: 1.7, w: 7.8, h: 0.5, fontSize: 18, color: "46596F" });
const secondSlide = presentation.addSlide();
secondSlide.addText("Second slide verified", { x: 0.8, y: 0.8, w: 7.8, h: 0.7, fontSize: 26, bold: true, color: "173B67" });
await presentation.writeFile({ fileName: join(projectPath, "newbrain-output.pptx") });

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const evaluate = (expression, timeoutMs = 15_000) => new Promise((resolveValue, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => reject(new Error(`CDP evaluation ${requestId} timed out.`)), timeoutMs);
  const listener = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== requestId) return;
    clearTimeout(timer);
    socket.removeEventListener("message", listener);
    if (message.error || message.result?.exceptionDetails) reject(new Error(message.error?.message || message.result.exceptionDetails.text));
    else resolveValue(message.result?.result?.value);
  };
  socket.addEventListener("message", listener);
  socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});
const waitFor = async (label, expression, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Timed out waiting for ${label}. Current DOM: ${JSON.stringify(await evaluate(expression))}`);
};
const captureScreenshot = async (targetPath) => {
  const screenshot = await new Promise((resolveImage, reject) => {
    const requestId = ++id;
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== requestId) return;
      socket.removeEventListener("message", listener);
      if (message.error) reject(new Error(message.error.message));
      else resolveImage(message.result.data);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id: requestId, method: "Page.captureScreenshot", params: { format: "png" } }));
  });
  await writeFile(targetPath, Buffer.from(screenshot, "base64"));
};

await evaluate(`(async () => {
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === ${JSON.stringify(projectPath)})) {
    catalog = await window.newbrain.addWorkspace({ name: "Artifact Preview E2E", path: ${JSON.stringify(projectPath)} });
  }
  const workspace = catalog.find((item) => item.path === ${JSON.stringify(projectPath)});
  if (!(workspace.threads || []).length) await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Artifact Viewer", summary: "PDF and DOCX side panel", scope: "project" });
  return true;
})()`);
socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
await new Promise((resolveWait) => setTimeout(resolveWait, 1500));

await waitFor("project", `Boolean([...document.querySelectorAll('.project-header-main')].find((item) => item.textContent?.includes('Artifact Preview E2E')))`);
await evaluate(`[...document.querySelectorAll('.project-header-main')].find((item) => item.textContent?.includes('Artifact Preview E2E'))?.click()`);
await waitFor("selected project", `Boolean([...document.querySelectorAll('.project-group.active .project-header-main')].find((item) => item.textContent?.includes('Artifact Preview E2E')))`);
await new Promise((resolveWait) => setTimeout(resolveWait, 500));
await evaluate(`window.newbrain.queueWorkspaceScan()`);
await new Promise((resolveWait) => setTimeout(resolveWait, 800));
assert.equal(await evaluate(`Boolean(document.querySelector('.left-section.tree-section'))`), false, "File tree must not remain in the left navigation.");
await evaluate(`document.querySelector('.preview-panel-toggle')?.click()`);
await waitFor("right file sidebar", `Boolean(document.querySelector('.preview-column .side-files-view'))`);
await waitFor("PDF file tree row", `Boolean([...document.querySelectorAll('.workspace-tree-item')].find((item) => item.textContent?.includes('年度总结示例.pdf')))`);

await evaluate(`(() => {
  const link = document.createElement('a');
  link.id = 'resolved-artifact-link-e2e';
  link.href = './%E5%B9%B4%E5%BA%A6%E6%80%BB%E7%BB%93%E7%A4%BA%E4%BE%8B.pdf';
  link.textContent = '年度总结示例.pdf';
  document.body.append(link);
  link.click();
})()`);
await waitFor("browser-resolved artifact link preview", `Boolean(document.querySelector('.workspace-artifact-pdf'))`);
assert.equal(await evaluate(`document.querySelectorAll('webview').length`), 0);
const workbenchState = JSON.parse(await evaluate(`(() => {
  const frame = document.querySelector('.workspace-frame');
  const conversation = document.querySelector('.task-column');
  const preview = document.querySelector('.preview-column');
  const sidebar = document.querySelector('.codex-sidebar');
  const composer = document.querySelector('.task-column .composer-card');
  const composerBounds = composer?.getBoundingClientRect();
  return JSON.stringify({
    active: frame?.classList.contains('artifact-workbench') || false,
    conversationVisible: Boolean(conversation && conversation.getBoundingClientRect().width > 300),
    previewDominant: Boolean(preview && conversation && preview.getBoundingClientRect().width > conversation.getBoundingClientRect().width * 1.5),
    projectSidebarHidden: sidebar ? getComputedStyle(sidebar).display === 'none' : false,
    pdfToolbar: Boolean(document.querySelector('.workspace-pdf-toolbar')),
    composerVisible: Boolean(composerBounds && composerBounds.top >= 0 && composerBounds.bottom <= window.innerHeight)
  });
})()`));
assert.deepEqual(workbenchState, {
  active: true,
  conversationVisible: true,
  previewDominant: true,
  projectSidebarHidden: true,
  pdfToolbar: true,
  composerVisible: true
});
await evaluate(`document.querySelector('.artifact-tab-add')?.click()`);
await waitFor("right file sidebar after PDF preview", `Boolean(document.querySelector('.preview-column .side-files-view'))`);
await evaluate(`[...document.querySelectorAll('.workspace-tree-item')].find((item) => item.textContent?.includes('安全工作纪要.docx'))?.click()`);
await waitFor("DOCX after PDF", `Boolean(document.querySelector('.workspace-artifact-docx'))`);
assert.equal(await evaluate(`document.querySelectorAll('.artifact-tab').length`), 2);
await evaluate(`document.querySelector('.artifact-tab')?.click()`);
await waitFor("embedded PDF viewer", `Boolean(document.querySelector('.workspace-artifact-pdf'))`);
await waitFor("rendered PDF canvas", `(() => {
  const canvas = document.querySelector('.workspace-artifact-pdf-page');
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100 || canvas.height < 100) return false;
  const pixels = canvas.getContext('2d')?.getImageData(0, 0, Math.min(canvas.width, 300), Math.min(canvas.height, 300)).data;
  if (!pixels) return false;
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) dark += 1;
  return dark > 20;
})()`);
await waitFor("selectable PDF text layer", `Boolean(document.querySelector('.workspace-artifact-pdf-text-layer span')?.textContent?.trim())`);
const selectedPdfText = await evaluate(`(() => {
  const text = document.querySelector('.workspace-artifact-pdf-text-layer span');
  if (!text?.firstChild) return '';
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString().trim();
})()`);
assert.ok(selectedPdfText.length > 0, "PDF text layer did not produce selectable text.");
assert.equal(await evaluate(`document.querySelector('.search-file-preview-state')?.textContent?.includes('二进制') || false`), false);
assert.equal(await evaluate(`document.querySelector('.search-file-preview-state.error')?.textContent?.includes('Worker was destroyed') || false`), false);
const evidenceDirectory = resolve("..", "..", "tmp", "e2e-evidence", "artifact-side-panel");
await mkdir(evidenceDirectory, { recursive: true });
await captureScreenshot(join(evidenceDirectory, "pdf-side-panel.png"));

await evaluate(`[...document.querySelectorAll('.artifact-tab')].find((item) => item.textContent?.includes('安全工作纪要.docx'))?.click()`);
await waitFor("embedded DOCX viewer", `Boolean(document.querySelector('.workspace-artifact-docx'))`);
await waitFor("DOCX rendered text", `Boolean(document.querySelector('.workspace-artifact-docx')?.getAttribute('srcdoc')?.includes('安全'))`);

await captureScreenshot(join(evidenceDirectory, "docx-side-panel.png"));
await evaluate(`document.querySelector('.artifact-tab-add')?.click()`);
await waitFor("right file sidebar after DOCX preview", `Boolean(document.querySelector('.preview-column .side-files-view'))`);
await waitFor("PPTX file tree row", `Boolean([...document.querySelectorAll('.workspace-tree-item')].find((item) => item.textContent?.includes('newbrain-output.pptx')))`);
await evaluate(`[...document.querySelectorAll('.workspace-tree-item')].find((item) => item.textContent?.includes('newbrain-output.pptx'))?.click()`);
await waitFor("PPTX preview surface", `Boolean(document.querySelector('.workspace-artifact-pptx') || document.querySelector('.search-file-preview-state.error'))`);
const pptxPreviewError = await evaluate(`document.querySelector('.search-file-preview-state.error')?.textContent || ''`);
assert.equal(pptxPreviewError, "", `PPTX preview failed: ${pptxPreviewError}`);
await waitFor("embedded PPTX viewer", `document.querySelector('.workspace-artifact-pptx')?.getAttribute('data-slide-count') === '2'`, 30_000);
await waitFor("PPTX first slide text", `document.querySelector('.workspace-artifact-pptx')?.textContent?.includes('NewBrain PPTX Preview')`);
await evaluate(`document.querySelector('.workspace-pptx-toolbar button[aria-label="下一页"]')?.click()`);
await waitFor("PPTX second slide", `document.querySelector('.workspace-artifact-pptx')?.getAttribute('data-current-slide') === '1' && document.querySelector('.workspace-artifact-pptx')?.textContent?.includes('Second slide verified')`);
await evaluate(`document.querySelector('.workspace-pptx-toolbar button[aria-label="上一页"]')?.click()`);
await waitFor("PPTX previous slide", `document.querySelector('.workspace-artifact-pptx')?.getAttribute('data-current-slide') === '0'`);
await captureScreenshot(join(evidenceDirectory, "pptx-side-panel.png"));
console.log(JSON.stringify({ ok: true, evidenceDirectory, verified: ["directory-tree", "pdf-side-panel", "docx-side-panel", "pptx-side-panel"] }));
socket.close();
session.close();

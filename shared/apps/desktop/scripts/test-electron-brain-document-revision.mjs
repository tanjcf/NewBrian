import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const source = "标题\n需要修改的正文\n结尾";
const replacement = "已经修改的正文";
const hash = `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9341);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
assert.ok(session.workspacePath, "The isolated Electron workspace is unavailable.");

const projectRoot = join(session.workspacePath, ".newbrain", "projects", "brain-document-revision");
await mkdir(join(projectRoot, "files"), { recursive: true });
await writeFile(join(projectRoot, "files", "note.md"), source, "utf8");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await new Promise((resolve) => setTimeout(resolve, 1_500));

let nextId = 0;
function evaluate(expression, timeoutMs = 15_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation ${id} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}

async function waitFor(label, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const diagnostics = await evaluate(`document.body?.innerText?.slice(0, 1200) || ""`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Renderer: ${diagnostics}`);
}

const seeded = JSON.parse(await evaluate(`(async () => {
  const path = ${JSON.stringify(projectRoot)};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Document Revision E2E", path });
  const workspace = catalog.find((item) => item.path === path);
  if (!workspace) throw new Error("workspace seed failed");
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "document", includeArchived: true });
  let project = projects.find((item) => item.name === "文档修改闭环 E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "文档修改闭环 E2E", primaryWorkspaceKey: "document", localWorkspaceId: workspace.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "document", includeArchived: true });
  let conversation = conversations.find((item) => item.title === "修改 note.md");
  if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "document", title: "修改 note.md" });
  let files = await window.newbrain.listBrainFiles({ projectId: project.id });
  let file = files.find((item) => item.storageKey === "files/note.md" && item.versionNo === 1);
  if (!file) file = await window.newbrain.registerBrainFile({ projectId: project.id, logicalName: "note.md", mimeType: "text/markdown", sizeBytes: ${Buffer.byteLength(source)}, contentHash: ${JSON.stringify(hash)}, storageKey: "files/note.md", versionNo: 1 });
  let annotations = await window.newbrain.listBrainAnnotations({ projectId: project.id });
  let annotation = annotations.find((item) => item.fileId === file.id);
  if (!annotation) annotation = await window.newbrain.createBrainAnnotation({ projectId: project.id, fileId: file.id, fileVersion: 1, instruction: "将正文改为已经修改的正文", anchor: { anchorId: "markdown:line:2", objectId: "markdown:line:2", format: "markdown", locator: { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 7 }, selectedText: "需要修改的正文" } });
  let changes = await window.newbrain.listBrainChangeSets({ projectId: project.id });
  let change = changes.find((item) => item.annotationId === annotation.id);
  if (!change) change = await window.newbrain.createBrainChangeSet({ projectId: project.id, annotationId: annotation.id, baseFileVersion: 1, changeSummary: "替换标注正文", diffJson: JSON.stringify({ operations: [{ start: 3, end: 10, replacement: ${JSON.stringify(replacement)} }] }) });
  localStorage.setItem("newbrain.lastSelectedWorkspaceId.v1", workspace.id);
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "document", catalogs: { document: { projectId: project.id, conversationId: conversation.id } } }));
  return JSON.stringify({ workspaceId: workspace.id, projectId: project.id, conversationId: conversation.id, fileId: file.id, changeSetId: change.id });
})()`));

await evaluate(`location.reload()`);
await new Promise((resolve) => setTimeout(resolve, 1_500));
await waitFor("BRAIN document project", `document.body?.innerText?.includes("文档修改闭环 E2E")`);
await evaluate(`(() => {
  const project = [...document.querySelectorAll('.brain-project-list button')].find((item) => item.textContent?.includes('文档修改闭环 E2E'));
  project?.click();
  return Boolean(project);
})()`);
await waitFor("BRAIN conversation", `document.body?.innerText?.includes("修改 note.md")`);
await evaluate(`(() => {
  const conversation = [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('修改 note.md'));
  conversation?.click();
  return Boolean(conversation);
})()`);
await waitFor("BRAIN file resource", `Boolean([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.md')))`);
const ingestProbe = JSON.parse(await evaluate(`(async () => {
  try {
    return JSON.stringify({ ok: true, result: await window.newbrain.ingestBrainFile({ projectId: ${JSON.stringify(seeded.projectId)}, fileId: ${JSON.stringify(seeded.fileId)} }) });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
})()`));
assert.equal(ingestProbe.ok, true, `Document ingest IPC failed: ${ingestProbe.error || "unknown error"}`);
assert.ok(ingestProbe.result.anchors.some((anchor) => anchor.anchorId === "markdown:line:2"), "Document ingest did not return the expected structural anchor.");
await evaluate(`([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.md')))?.click()`);
await waitFor("document revision controls", `document.body?.innerText?.includes("替换标注正文")`);
await waitFor("document preview content", `document.querySelector('.search-file-preview')?.textContent?.includes("需要修改的正文")`);
await evaluate(`([...document.querySelectorAll('.document-annotation-toolbar button')].find((item) => item.textContent?.includes('画笔标注')))?.click()`);
await waitFor("annotation mode", `document.querySelector('.document-annotation-toolbar button')?.textContent?.includes('结束标注')`);
await waitFor("Rust-supervised structural anchors", `document.querySelector('.document-anchor-picker')?.textContent?.includes('markdown:line:2')`);
await evaluate(`([...document.querySelectorAll('.document-annotation-toolbar button')].find((item) => item.textContent?.includes('结束标注')))?.click()`);

await evaluate(`([...document.querySelectorAll('.document-change-set-list button')].find((item) => item.textContent?.trim() === '预览'))?.click()`);
await waitFor("before/after preview", `document.querySelector('.document-change-preview')?.textContent?.includes(${JSON.stringify(replacement)})`);
await evaluate(`([...document.querySelectorAll('.document-change-set-list button')].find((item) => item.textContent?.trim() === '接受'))?.click()`);
await waitFor("accepted change set", `document.querySelector('.document-change-set-list')?.textContent?.includes("已接受")`);
await evaluate(`([...document.querySelectorAll('.document-change-set-list button')].find((item) => item.textContent?.trim() === '导出新版本'))?.click()`);
await waitFor("exported version", `document.querySelector('.document-change-set-list')?.textContent?.includes("已导出 v2")`);
await evaluate(`location.reload()`);
await new Promise((resolve) => setTimeout(resolve, 1_500));
await waitFor("reloaded BRAIN document project", `document.body?.innerText?.includes("文档修改闭环 E2E")`);
await evaluate(`([...document.querySelectorAll('.brain-project-list button')].find((item) => item.textContent?.includes('文档修改闭环 E2E')))?.click()`);
await waitFor("reloaded BRAIN conversation", `document.body?.innerText?.includes("修改 note.md")`);
await evaluate(`([...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('修改 note.md')))?.click()`);
await waitFor("exported file resource", `Boolean([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.v2.md') && item.textContent?.includes('版本 2')))`);
await evaluate(`([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.v2.md') && item.textContent?.includes('版本 2')))?.click()`);
await waitFor("reopened exported revision", `document.querySelector('.search-file-preview')?.textContent?.includes(${JSON.stringify(replacement)}) && document.querySelector('.search-file-preview')?.textContent?.includes('note.v2.md')`);

const durable = JSON.parse(await evaluate(`(async () => JSON.stringify({
  files: await window.newbrain.listBrainFiles({ projectId: ${JSON.stringify(seeded.projectId)} }),
  changes: await window.newbrain.listBrainChangeSets({ projectId: ${JSON.stringify(seeded.projectId)} })
}))()`));
assert.ok(durable.files.some((file) => file.versionNo === 2 && /note\.v2\.md$/.test(file.storageKey)), "Exported file version is not durable.");
assert.ok(durable.changes.some((change) => change.id === seeded.changeSetId && change.resultFileVersion === 2), "Change set result version is not durable.");
assert.equal(await readFile(join(projectRoot, "files", "note.md"), "utf8"), source, "Source file was overwritten.");
assert.equal(await readFile(join(projectRoot, "files", "note.v2.md"), "utf8"), source.replace("需要修改的正文", replacement));
assert.ok((await stat(join(projectRoot, "files", "note.v2.md"))).size > 0);

socket.close();
session.close();
console.log(JSON.stringify({ ok: true, caseId: "BRAIN-DOC-REVISION-E2E", projectId: seeded.projectId }, null, 2));

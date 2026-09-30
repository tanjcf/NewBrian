import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const annotationText = "修改标注：扩产公告";
const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9342);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
assert.ok(session.workspacePath, "The isolated Electron workspace is unavailable.");

const projectRoot = join(session.workspacePath, ".newbrain", "projects", "brain-pdf-annotation");
await mkdir(join(projectRoot, "files"), { recursive: true });

const sourceDoc = await PDFDocument.create();
sourceDoc.addPage([420, 300]);
const sourceBytes = Buffer.from(await sourceDoc.save());
const sourceHash = `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`;
await writeFile(join(projectRoot, "files", "note.pdf"), sourceBytes);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await new Promise((resolve) => setTimeout(resolve, 1_500));

let nextId = 0;
function evaluate(expression, timeoutMs = 20_000) {
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

async function waitFor(label, expression, timeoutMs = 15_000) {
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
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN PDF Annotation E2E", path });
  const workspace = catalog.find((item) => item.path === path);
  if (!workspace) throw new Error("workspace seed failed");
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "document", includeArchived: true });
  let project = projects.find((item) => item.name === "PDF中文标注 E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "PDF中文标注 E2E", primaryWorkspaceKey: "document", localWorkspaceId: workspace.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "document", includeArchived: true });
  let conversation = conversations.find((item) => item.title === "标注 note.pdf");
  if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "document", title: "标注 note.pdf" });
  let files = await window.newbrain.listBrainFiles({ projectId: project.id });
  let file = files.find((item) => item.storageKey === "files/note.pdf" && item.versionNo === 1);
  if (!file) file = await window.newbrain.registerBrainFile({
    projectId: project.id,
    logicalName: "note.pdf",
    mimeType: "application/pdf",
    sizeBytes: ${sourceBytes.length},
    contentHash: ${JSON.stringify(sourceHash)},
    storageKey: "files/note.pdf",
    versionNo: 1
  });
  let annotations = await window.newbrain.listBrainAnnotations({ projectId: project.id });
  let annotation = annotations.find((item) => item.fileId === file.id);
  if (!annotation) annotation = await window.newbrain.createBrainAnnotation({
    projectId: project.id,
    fileId: file.id,
    fileVersion: 1,
    instruction: ${JSON.stringify(annotationText)},
    anchor: {
      anchorId: "pdf:page:1:rect",
      objectId: "pdf:page:1",
      format: "pdf",
      page: 1,
      rect: { x: 40, y: 80, width: 160, height: 48 },
      transform: { coordinateSpace: "pdf-points", basisWidth: 420, basisHeight: 300, scale: 1 },
      locator: { kind: "pdf-text", page: 1 },
      selectedText: ${JSON.stringify(annotationText)}
    }
  });
  let changes = await window.newbrain.listBrainChangeSets({ projectId: project.id });
  let change = changes.find((item) => item.annotationId === annotation.id);
  if (!change) change = await window.newbrain.createBrainChangeSet({
    projectId: project.id,
    annotationId: annotation.id,
    baseFileVersion: 1,
    changeSummary: "写入中文PDF标注",
    diffJson: JSON.stringify({
      format: "pdf",
      kind: "add-annotation",
      page: 1,
      rect: { x: 40, y: 80, width: 160, height: 48 },
      text: ${JSON.stringify(annotationText)}
    })
  });
  localStorage.setItem("newbrain.lastSelectedWorkspaceId.v1", workspace.id);
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({
    version: 2,
    selectedWorkspaceKey: "document",
    catalogs: { document: { projectId: project.id, conversationId: conversation.id } }
  }));
  return JSON.stringify({ workspaceId: workspace.id, projectId: project.id, conversationId: conversation.id, fileId: file.id, changeSetId: change.id });
})()`));

await evaluate(`location.reload()`);
await new Promise((resolve) => setTimeout(resolve, 1_500));
await waitFor("BRAIN PDF project", `document.body?.innerText?.includes("PDF中文标注 E2E")`);
await evaluate(`([...document.querySelectorAll('.brain-project-list button')].find((item) => item.textContent?.includes('PDF中文标注 E2E')))?.click()`);
await waitFor("BRAIN conversation", `document.body?.innerText?.includes("标注 note.pdf")`);
await evaluate(`([...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('标注 note.pdf')))?.click()`);
await waitFor("PDF resource", `Boolean([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.pdf')))`);
await evaluate(`([...document.querySelectorAll('.brain-resource-row')].find((item) => item.textContent?.includes('note.pdf')))?.click()`);
await waitFor("PDF change set", `document.body?.innerText?.includes("写入中文PDF标注")`);
await evaluate(`([...document.querySelectorAll('.document-change-set-list button')].find((item) => item.textContent?.trim() === '接受'))?.click()`);
await waitFor("accepted change set", `document.querySelector('.document-change-set-list')?.textContent?.includes("已接受")`);
await evaluate(`([...document.querySelectorAll('.document-change-set-list button')].find((item) => item.textContent?.trim() === '导出新版本'))?.click()`);
await waitFor("exported PDF version", `document.querySelector('.document-change-set-list')?.textContent?.includes("已导出 v2")`);

const exportedPath = join(projectRoot, "files", "note.v2.pdf");
const exportedBytes = await readFile(exportedPath);
assert.ok(exportedBytes.length > sourceBytes.length, "Exported PDF should embed annotation content/font.");

const verify = JSON.parse(await evaluate(`(async () => {
  const files = await window.newbrain.listBrainFiles({ projectId: ${JSON.stringify(seeded.projectId)} });
  const changes = await window.newbrain.listBrainChangeSets({ projectId: ${JSON.stringify(seeded.projectId)} });
  return JSON.stringify({
    hasV2: files.some((file) => file.versionNo === 2 && /note\\.v2\\.pdf$/.test(file.storageKey)),
    accepted: changes.some((change) => change.id === ${JSON.stringify(seeded.changeSetId)} && change.resultFileVersion === 2)
  });
})()`));
assert.equal(verify.hasV2, true, "Exported PDF version was not registered.");
assert.equal(verify.accepted, true, "Change set did not record PDF export version.");

socket.close();
session.close();
console.log(JSON.stringify({
  ok: true,
  caseId: "BRAIN-PDF-CJK-ANNOTATION-E2E",
  projectId: seeded.projectId,
  exportedBytes: exportedBytes.length,
  annotationText
}, null, 2));

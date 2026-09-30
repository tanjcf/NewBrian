import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9342);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const listener = (event) => { const payload = JSON.parse(event.data); if (payload.id !== id) return; clearTimeout(timer); socket.removeEventListener("message", listener); if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text)); else resolve(payload.result); };
    socket.addEventListener("message", listener); socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error(`Timed out waiting for ${expression}: ${await evaluate("document.body?.innerText?.slice(0, 1800)")}`);
}
function hash(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
async function choose(selectTestId, value) {
  return evaluate(`(() => { const select = document.querySelector('[data-testid="${selectTestId}"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === ${JSON.stringify(value)}; })()`);
}

const root = await mkdtemp(join(tmpdir(), "brain-data-ui-"));
const csvBytes = Buffer.from("date,value,label\n2026-01-01,10,alpha\n2026-01-02,20,beta\n2026-01-03,30,gamma\n", "utf8");
const csvPath = join(root, "prices.csv"); await writeFile(csvPath, csvBytes);
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet("Summary").addRows([["date", "value"], ["2026-02-01", 3], ["2026-02-02", 9]]);
workbook.addWorksheet("Second").addRows([["date", "value"], ["2026-03-01", 30], ["2026-03-02", 40]]);
const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());
const xlsxPath = join(root, "prices.xlsx"); await writeFile(xlsxPath, xlsxBytes);

const seeded = await evaluate(`(async () => {
  const path = ${JSON.stringify(root)};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Data E2E", path });
  const local = catalog.find((item) => item.path === path); if (!local) return { ok: false, reason: "workspace-missing" };
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "data" });
  let project = projects.find((item) => item.name === "BRAIN Data E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "BRAIN Data E2E", primaryWorkspaceKey: "data", localWorkspaceId: local.id });
  else project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "data" });
  let conversation = conversations[0]; if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "data", title: "数据工作台验收" });
  const files = await window.newbrain.listBrainFiles({ projectId: project.id });
  const entries = ${JSON.stringify([{ name: "prices.csv", mime: "text/csv", key: "prices.csv", size: csvBytes.byteLength, hash: hash(csvBytes) }, { name: "prices.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key: "prices.xlsx", size: xlsxBytes.byteLength, hash: hash(xlsxBytes) }])};
  for (const entry of entries) if (!files.some((file) => file.storageKey === entry.key)) await window.newbrain.registerBrainFile({ projectId: project.id, logicalName: entry.name, mimeType: entry.mime, sizeBytes: entry.size, contentHash: entry.hash, storageKey: entry.key });
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "data", catalogs: { data: { projectId: project.id, conversationId: conversation.id } } }));
  return { ok: true };
})()`);
assert.equal(seeded?.ok, true, JSON.stringify(seeded));
await command("Page.reload", { ignoreCache: true });
await waitFor("Boolean(document.querySelector('.brain-conversation-list'))");
await waitFor(`Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('数据工作台验收')))`, 30_000);
await evaluate(`(() => { [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('数据工作台验收'))?.click(); return true; })()`);
await waitFor(`Boolean([...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '数据导入'))`);
await evaluate(`(() => { [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '数据导入')?.click(); return true; })()`);
await waitFor("Boolean(document.querySelector('[data-testid=brain-data-workspace]'))");
await waitFor("[...document.querySelector('[data-testid=brain-data-file-select]')?.options || []].some((item) => item.textContent?.includes('prices.csv'))");
const csvFileId = await evaluate("[...document.querySelector('[data-testid=brain-data-file-select]').options].find((item) => item.textContent.includes('prices.csv'))?.value || ''");
assert.ok(await choose("brain-data-file-select", csvFileId));
await evaluate("document.querySelector('[data-testid=brain-data-import]')?.click()");
await waitFor("document.querySelector('[data-testid=brain-data-workspace]')?.textContent?.includes('已导入 3 行')");
await waitFor("Boolean(document.querySelector('[data-testid=brain-data-chart]'))");
await evaluate("document.querySelector('[data-testid=brain-data-analysis]')?.click()");
await waitFor("document.querySelector('[data-testid=brain-data-workspace]')?.textContent?.includes('分析结果已保存')");
await waitFor("document.querySelector('[data-testid=brain-data-analysis-result]')?.textContent?.includes('中位')");
await evaluate("(() => { const select = [...document.querySelectorAll('select')].find((item) => item.getAttribute('aria-label') === '图表类型'); if (!select) return false; select.value = 'scatter'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
await waitFor("Boolean(document.querySelector('[data-testid=brain-data-chart] circle'))");
await waitFor("[...document.querySelector('[data-testid=brain-data-file-select]')?.options || []].some((item) => item.textContent?.includes('prices.xlsx'))");
const xlsxFileId = await evaluate("[...document.querySelector('[data-testid=brain-data-file-select]').options].find((item) => item.textContent.includes('prices.xlsx'))?.value || ''");
assert.ok(await choose("brain-data-file-select", xlsxFileId));
await waitFor("Boolean([...document.querySelectorAll('select')].find((item) => item.getAttribute('aria-label') === '选择工作表'))");
const sheetSelect = await evaluate("[...document.querySelectorAll('select')].find((item) => item.getAttribute('aria-label') === '选择工作表')?.value || ''");
assert.equal(sheetSelect, "Summary");
await evaluate("(() => { const select = [...document.querySelectorAll('select')].find((item) => item.getAttribute('aria-label') === '选择工作表'); if (!select) return false; select.value = 'Second'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
await evaluate("document.querySelector('[data-testid=brain-data-import]')?.click()");
await waitFor("document.querySelector('[data-testid=brain-data-workspace]')?.textContent?.includes('已导入 2 行')");
const observation = await evaluate(`(() => ({ workspace: Boolean(document.querySelector('[data-testid=brain-data-workspace]')), analysis: document.querySelector('[data-testid=brain-data-analysis-result]')?.textContent || '', scatter: Boolean(document.querySelector('[data-testid=brain-data-chart] circle')), datasets: document.querySelectorAll('.brain-data-card').length, error: document.body.innerText.includes('A JavaScript error occurred in the main process') }))()`);
assert.equal(observation.error, false, JSON.stringify(observation)); assert.equal(observation.scatter, true, JSON.stringify(observation)); assert.ok(observation.datasets >= 2, JSON.stringify(observation));
console.log(JSON.stringify({ ok: true, caseId: "BRAIN-DATA-WORKSPACE-E2E", observation, fixtureRoot: root }, null, 2));
socket.close(); await session.close();

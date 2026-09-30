import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const marketRequests = [];
const marketServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const query = JSON.parse(body);
    marketRequests.push(query);
    const bars = Array.from({ length: 12 }, (_, index) => {
      const open = 100 + index;
      const close = open + (index % 2 === 0 ? 2 : -1);
      return {
        symbol: query.symbol,
        exchange: "XSHG",
        timezone: "Asia/Shanghai",
        interval: query.interval,
        adjustment: query.adjustment,
        timestamp: `2026-08-${String(index + 1).padStart(2, "0")}T15:00:00+08:00`,
        open,
        high: Math.max(open, close) + 1,
        low: Math.min(open, close) - 1,
        close,
        volume: 10_000 + index * 500,
        turnover: (10_000 + index * 500) * close,
        changePercent: ((close - open) / open) * 100,
        source: { provider: "BRAIN E2E market adapter", dataset: "verified-fixture", fetchedAt: "2026-08-22T00:00:00Z" }
      };
    });
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ bars }));
  });
});
await new Promise((resolve) => marketServer.listen(0, "127.0.0.1", resolve));
const address = marketServer.address();
assert.ok(address && typeof address === "object");
process.env.BRAIN_MARKET_DATA_URL = `http://127.0.0.1:${address.port}/bars`;

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9344);
const session = await ensureElectronE2ESession(debugPort);
try {
  const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert.ok(page, "No debuggable Electron renderer page was found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  function command(method, params = {}, waitLimitMs = 30_000) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} test wait exceeded`)), waitLimitMs);
      const listener = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text));
        else resolve(payload.result);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  async function waitFor(expression, waitLimitMs = 30_000) {
    const stopCheckingAt = Date.now() + waitLimitMs;
    while (Date.now() < stopCheckingAt) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Test wait exceeded for ${expression}: ${await evaluate("document.body?.innerText?.slice(0, 1800)")}`);
  }

  const root = await mkdtemp(join(tmpdir(), "brain-quant-ui-"));
  const seeded = await evaluate(`(async () => {
    const path = ${JSON.stringify(root)};
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Quant E2E", path });
    const local = catalog.find((item) => item.path === path); if (!local) return { ok: false, reason: "workspace-missing" };
    let projects = await window.newbrain.listBrainProjects({ workspaceKey: "quant" });
    let project = projects.find((item) => item.name === "BRAIN Quant E2E");
    if (!project) project = await window.newbrain.createBrainProject({ name: "BRAIN Quant E2E", primaryWorkspaceKey: "quant", localWorkspaceId: local.id });
    let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "quant" });
    let conversation = conversations[0];
    if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "quant", title: "量化工作台验收" });
    localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "quant", catalogs: { quant: { projectId: project.id, conversationId: conversation.id } } }));
    return { ok: true, projectId: project.id };
  })()`);
  assert.equal(seeded?.ok, true, JSON.stringify(seeded));
  await command("Page.reload", { ignoreCache: true });
  await waitFor(`Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('量化工作台验收')))`);
  await evaluate(`(() => { [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('量化工作台验收'))?.click(); return true; })()`);
  await waitFor("Boolean(document.querySelector('[data-testid=brain-quant-workspace]'))");
  await waitFor("document.querySelector('[data-testid=brain-quant-market-status]')?.textContent?.includes('已加载 12 条真实行情')");
  await waitFor("document.querySelectorAll('[data-testid=brain-quant-market-chart] rect').length >= 24");

  await evaluate(`(() => { [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '组合')?.click(); return true; })()`);
  await waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view') === 'portfolio'");
  await evaluate("document.querySelector('[data-testid=brain-quant-buy]')?.click()");
  await waitFor("document.querySelector('[data-testid=brain-quant-positions]')?.textContent?.includes('600519')");
  await waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.textContent?.includes('已模拟买入 600519 100 股')");

  await evaluate(`(() => { [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '雷达')?.click(); return true; })()`);
  await waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view') === 'radar'");
  await evaluate(`(() => { [...document.querySelectorAll('.brain-quant-schedule-form button')].find((item) => item.textContent?.includes('创建模拟计划'))?.click(); return true; })()`);
  await waitFor("document.querySelector('[data-testid=brain-quant-workspace]')?.textContent?.includes('策略计划已保存，仅进入模拟任务队列')");

  const observation = await evaluate(`(async () => ({
    activeView: document.querySelector('[data-testid=brain-quant-workspace]')?.getAttribute('data-active-view'),
    schedules: (await window.newbrain.listQuantStrategySchedules({ projectId: ${JSON.stringify(seeded.projectId)} })).length,
    activity: await window.newbrain.getQuantActivity({ projectId: ${JSON.stringify(seeded.projectId)}, prices: { "600519": 110 } }),
    liveBrokerText: document.body.innerText.includes('真实下单')
  }))()`);
  assert.equal(observation.activeView, "radar", JSON.stringify(observation));
  assert.equal(observation.schedules, 1, JSON.stringify(observation));
  assert.equal(observation.activity.fills.length, 1, JSON.stringify(observation));
  assert.equal(observation.activity.snapshot.positions[0].quantity, 100, JSON.stringify(observation));
  assert.equal(observation.liveBrokerText, false, JSON.stringify(observation));
  assert.ok(marketRequests.length >= 1);
  console.log(JSON.stringify({ ok: true, caseId: "BRAIN-QUANT-WORKSPACE-E2E", observation, marketRequests: marketRequests.length }, null, 2));
  socket.close();
} finally {
  session.close();
  await new Promise((resolve) => marketServer.close(resolve));
}

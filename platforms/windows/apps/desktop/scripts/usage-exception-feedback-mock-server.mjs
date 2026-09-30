import { createServer } from "node:http";

const port = Number(process.env.NEWBRAIN_USAGE_FEEDBACK_PORT || 18941);
const state = { offline: false, modelRequests: 0, chatRequests: 0, uploads: [], requests: [] };
const analysis = JSON.stringify({
  title: "文档生成任务无法完成",
  symptomSummary: "文档生成后任务持续运行且没有完成结果。",
  possibleCause: "生成流程的完成事件可能未正确投影。",
  category: "document_generation_stuck",
  stableFeatures: ["document_generation", "completion_event_missing"],
  contextSummary: "用户触发文档生成后长时间无完成状态。"
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  const body = await readBody(request);
  state.requests.push(`${request.method} ${url.pathname}`);
  if (url.pathname === "/__state") return json(response, state);
  if (url.pathname === "/__offline" && request.method === "POST") {
    state.offline = Boolean(body?.offline);
    return json(response, { ok: true, offline: state.offline });
  }
  if (url.pathname === "/v1/models") return json(response, { data: [{ id: "newbrain-e2e-model" }] });
  if (url.pathname === "/v1/responses") {
    state.modelRequests += 1;
    const prompt = JSON.stringify(body || {});
    if (!prompt.includes("用户主动报告的使用异常")) state.chatRequests += 1;
    return json(response, {
      id: `response-${state.modelRequests}`,
      object: "response",
      status: "completed",
      output_text: analysis,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: analysis }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }
    });
  }
  if (url.pathname === "/api/desktop/v1/error-reports" && request.method === "POST") {
    if (state.offline) return json(response, { message: "offline" }, 503);
    state.uploads.push({ authorization: request.headers.authorization || "", body });
    return json(response, { id: `server-error-${state.uploads.length}`, status: "OPEN" });
  }
  if (url.pathname === "/api/agreements/public") return json(response, { items: [] });
  return json(response, { message: "not found", path: url.pathname }, 404);
});

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

server.listen(port, "127.0.0.1", () => process.stdout.write(`READY ${port}\n`));
process.on("SIGTERM", () => server.close());

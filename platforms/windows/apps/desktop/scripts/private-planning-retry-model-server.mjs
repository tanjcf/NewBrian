import { createServer } from "node:http";

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export async function startPrivatePlanningRetryModelServer() {
  let responseCount = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, { data: [{ id: "newbrain-retry-e2e", name: "NewBrain Retry E2E", owned_by: "newbrain" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    request.on("end", () => {
      responseCount += 1;
      const content = responseCount === 1
        ? "The user asks my name. I should answer directly in Chinese."
        : "我是 NewBrain，你的智能协作助手。\n\n[www.gov.cn）整理的最新消息：](https://www.gov.cn/)";
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "close"
      });
      response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}\n\n`);
      response.write(`data: ${JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }]
        }
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind retry E2E model server.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getResponseCount: () => responseCount,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

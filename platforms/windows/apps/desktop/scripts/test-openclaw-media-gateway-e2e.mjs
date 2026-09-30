/**
 * OpenClaw-style image/video media gateway E2E against a local mock Auto tools server.
 * Proves wait=false submit → /auto/tools/jobs poll → succeeded reply without live vendor keys.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function findRepoRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, "shared", "apps", "desktop", "src", "main", "media-generation-turn.ts");
    if (existsSync(candidate)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not locate BRAIN repo root from OpenClaw media E2E script.");
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const turnModuleUrl = pathToFileURL(join(repoRoot, "shared", "apps", "desktop", "src", "main", "media-generation-turn.ts")).href;
const { executeMediaGenerationTurn } = await import(turnModuleUrl);

const jobs = new Map();
let invokeCount = 0;
let pollCount = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const body = bodyText ? JSON.parse(bodyText) : {};

  if (request.method === "POST" && url.pathname === "/v1/auto/tools/invoke") {
    invokeCount += 1;
    const tool = String(body.name || body.tool || body.tool_name || "");
    assert.ok(tool === "image_generate" || tool === "video_generate", `unexpected tool ${tool}`);
    assert.equal(body.wait, false, "OpenClaw path must submit with wait=false");
    const id = `job_${tool}_${invokeCount}`;
    jobs.set(id, {
      id,
      kind: tool === "video_generate" ? "video" : "image",
      state: "RUNNING",
      polls: 0,
      result_json: JSON.stringify({
        url: tool === "video_generate" ? "https://example.test/out.mp4" : "https://example.test/out.png"
      })
    });
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      tool,
      job_id: id,
      kind: jobs.get(id).kind,
      state: "RUNNING",
      status: "running"
    }));
    return;
  }

  const pollMatch = url.pathname.match(/^\/v1\/auto\/tools\/jobs\/([^/]+)$/);
  if (request.method === "GET" && pollMatch) {
    pollCount += 1;
    const job = jobs.get(decodeURIComponent(pollMatch[1]));
    if (!job) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, message: "missing job" }));
      return;
    }
    job.polls += 1;
    const succeeded = job.polls >= 2;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: succeeded,
      tool: job.kind === "video" ? "video_generate" : "image_generate",
      job_id: job.id,
      kind: job.kind,
      state: succeeded ? "SUCCEEDED" : "RUNNING",
      status: succeeded ? "succeeded" : "running",
      result_json: succeeded ? job.result_json : undefined,
      reply: succeeded
        ? `${job.kind === "video" ? "视频" : "图片"}已生成完成（任务 \`${job.id}\`）。\n\n${JSON.parse(job.result_json).url}`
        : ""
    }));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false, path: url.pathname }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const gatewayBaseUrl = `http://127.0.0.1:${address.port}/v1`;

const image = await executeMediaGenerationTurn({
  gatewayBaseUrl,
  bearerToken: "e2e-token",
  model: "hy-image-v3",
  prompt: "画一只狐狸",
  kind: "image",
  toolName: "image_generate",
  requestId: "req-image-1",
  workspaceId: "ws-1",
  threadId: "th-1",
  pollIntervalMs: 20
});
assert.equal(image.via, "auto_tools");
assert.equal(image.job.state, "SUCCEEDED");
assert.match(image.content, /example\.test\/out\.png|图片|生成/i);

const video = await executeMediaGenerationTurn({
  gatewayBaseUrl,
  bearerToken: "e2e-token",
  model: "hy-video-v1",
  prompt: "生成一段短视频",
  kind: "video",
  toolName: "video_generate",
  requestId: "req-video-1",
  workspaceId: "ws-1",
  threadId: "th-1",
  pollIntervalMs: 20
});
assert.equal(video.via, "auto_tools");
assert.equal(video.job.state, "SUCCEEDED");
assert.match(video.content, /example\.test\/out\.mp4|视频|生成/i);

assert.equal(invokeCount, 2);
assert.ok(pollCount >= 4, `expected polls across both jobs, got ${pollCount}`);

server.close();
console.log(JSON.stringify({
  ok: true,
  caseId: "OPENCLAW-MEDIA-GATEWAY-E2E",
  invokeCount,
  pollCount,
  imageJobId: image.job.id,
  videoJobId: video.job.id
}, null, 2));

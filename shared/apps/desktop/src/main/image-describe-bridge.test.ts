import assert from "node:assert/strict";
import test from "node:test";

const {
  describeImageForBridge,
  describeImageWithRemoteVision,
  isLocalVisionBridgeDisabled
} = await import(new URL("./image-describe-bridge.ts", import.meta.url).href);

test("remote vision describe posts input_image to /responses and reads output text", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const result = await describeImageWithRemoteVision({
    apiUrl: "https://gateway.example/v1/responses",
    bearerToken: "token",
    model: "qwen3-vl-plus",
    dataUrl: "data:image/png;base64,abc",
    fetchImpl: (async (url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      return new Response(JSON.stringify({
        output_text: "图中是一只狗。"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch
  });

  assert.equal(result.source, "remote");
  assert.equal(result.visionModel, "qwen3-vl-plus");
  assert.equal(result.description, "图中是一只狗。");
  assert.equal(calls[0]?.url, "https://gateway.example/v1/responses");
  assert.equal(calls[0]?.body.model, "qwen3-vl-plus");
  assert.equal(calls[0]?.body.stream, false);
  const input = calls[0]?.body.input as Array<{ content: Array<{ type: string }> }>;
  assert.ok(input[0]?.content.some((part) => part.type === "input_image"));
});

test("bridge prefers remote vision then falls back to local", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "newbrain-vision-"));
  const filePath = join(dir, "x.png");
  await writeFile(filePath, Buffer.from("png"));
  try {
    let localCalled = false;
    const result = await describeImageForBridge({
      filePath,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      bridgeModel: {
        provider: "DashScope",
        model: "qwen3-vl-plus",
        capabilities: ["vision"]
      },
      remote: {
        apiUrl: "https://gateway.example/v1/responses",
        bearerToken: "token",
        fetchImpl: (async () => new Response("upstream down", { status: 503 })) as typeof fetch
      },
      local: {
        enabled: true,
        fetchImpl: (async () => {
          localCalled = true;
          return new Response(JSON.stringify({
            message: { content: "本地描述：蓝色天空。" }
          }), { status: 200 });
        }) as typeof fetch,
        environment: {}
      }
    });

    assert.equal(localCalled, true);
    assert.equal(result.source, "local");
    assert.match(result.description, /蓝色天空/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bridge fails closed when remote and local are both unavailable", async () => {
  await assert.rejects(
    () => describeImageForBridge({
      filePath: "C:/tmp/x.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      bridgeModel: undefined,
      remote: {
        apiUrl: "https://gateway.example/v1/responses",
        bearerToken: "token"
      },
      local: {
        enabled: false,
        environment: { NEWBRAIN_VISION_BRIDGE_LOCAL: "0" }
      }
    }),
    /没有可用的远程视觉模型|本地识图桥接已关闭/
  );
});

test("local vision bridge can be disabled via env", () => {
  assert.equal(isLocalVisionBridgeDisabled({ NEWBRAIN_VISION_BRIDGE_LOCAL: "0" }), true);
  assert.equal(isLocalVisionBridgeDisabled({}), false);
});

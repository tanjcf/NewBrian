import assert from "node:assert/strict";
import test from "node:test";

const {
  NO_IMAGE_BRIDGE_MESSAGE,
  formatBridgedImageText,
  pickBridgeVisionModel,
  resolveImageHandleMode,
  resolvePreferredBridgeVisionModelFromEnv,
  resolveTurnImages
} = await import(new URL("./turn-image-resolution.ts", import.meta.url).href);
const { isVisionCapableModel } = await import(new URL("./model-auto-router.ts", import.meta.url).href);

const deepseek = {
  id: "1",
  provider: "DeepSeek",
  model: "deepseek-v4-flash",
  label: "flash"
};

const qwenVl = {
  id: "2",
  provider: "DashScope",
  model: "qwen3-vl-plus",
  label: "qwen-vl",
  capabilities: ["vision", "multimodal"]
};

const gpt4o = {
  id: "3",
  provider: "OpenAI",
  model: "gpt-4o",
  label: "gpt-4o"
};

test("vision-capable main model uses native image parts", async () => {
  assert.equal(resolveImageHandleMode(qwenVl), "native");
  assert.equal(isVisionCapableModel(qwenVl), true);

  const resolved = await resolveTurnImages({
    mainModel: qwenVl,
    images: [{
      name: "shot.png",
      path: "C:/tmp/shot.png",
      mimeType: "image/png",
      header: "Attachment 1: shot.png",
      readBytes: async () => Buffer.from("png-bytes")
    }],
    describeImage: async () => {
      throw new Error("bridge must not run for native vision models");
    }
  });

  assert.equal(resolved.mode, "native");
  assert.equal(resolved.images.length, 1);
  assert.equal(resolved.images[0]?.kind, "native");
  if (resolved.images[0]?.kind === "native") {
    assert.match(resolved.images[0].dataUrl, /^data:image\/png;base64,/);
  }
});

test("Auto outbound model=auto with vision pool uses native image parts", async () => {
  const autoLiteral = { model: "auto", provider: "gateway", label: "Auto" };
  assert.equal(resolveImageHandleMode(autoLiteral), "describe_bridge");
  assert.equal(
    resolveImageHandleMode(autoLiteral, {
      requestedModel: "auto",
      availableModels: [deepseek, qwenVl],
      parentSelectedModel: "kimi-k2.6"
    }),
    "native"
  );
  // Parent Auto picked text → do not emit image_url (child must be vision to keep native).
  assert.equal(
    resolveImageHandleMode(autoLiteral, {
      requestedModel: "auto",
      availableModels: [deepseek, qwenVl],
      parentSelectedModel: "deepseek-v4-pro"
    }),
    "describe_bridge"
  );
  const resolved = await resolveTurnImages({
    mainModel: autoLiteral,
    requestedModel: "auto",
    parentSelectedModel: "kimi-k2.6",
    availableModels: [deepseek, qwenVl, {
      id: "18",
      provider: "百度智能云千帆",
      model: "kimi-k2.6",
      label: "kimi"
    }],
    images: [{
      name: "shot.png",
      path: "C:/tmp/shot.png",
      mimeType: "image/png",
      header: "Attachment 1: shot.png",
      readBytes: async () => Buffer.from("png-bytes")
    }],
    describeImage: async () => {
      throw new Error("Auto+vision must not describe-bridge");
    }
  });
  assert.equal(resolved.mode, "native");
  assert.equal(resolved.images[0]?.kind, "native");
});

test("kimi-k2.6-BD uses native image input (official chat.completions multimodal)", async () => {
  const kimi = {
    id: "18",
    provider: "百度智能云千帆",
    model: "kimi-k2.6-BD",
    label: "kimi-k2.6-BD"
  };
  assert.equal(isVisionCapableModel(kimi), true);
  assert.equal(resolveImageHandleMode(kimi), "native");
  const resolved = await resolveTurnImages({
    mainModel: kimi,
    images: [{
      name: "chapter.png",
      path: "C:/tmp/chapter.png",
      mimeType: "image/png",
      header: "Attachment 1: chapter.png",
      readBytes: async () => Buffer.from("png-bytes")
    }],
    describeImage: async () => {
      throw new Error("kimi-k2.6-BD must use native image_url parts");
    }
  });
  assert.equal(resolved.mode, "native");
  assert.equal(resolved.images[0]?.kind, "native");
  assert.match((resolved.images[0] as { dataUrl: string }).dataUrl, /^data:image\/png;base64,/);
});

test("text-only main model uses describe-bridge and injects Chinese description", async () => {
  assert.equal(resolveImageHandleMode(deepseek), "describe_bridge");

  const resolved = await resolveTurnImages({
    mainModel: deepseek,
    availableModels: [deepseek, qwenVl],
    preferredBridgeModel: "qwen3-vl-plus",
    images: [{
      name: "photo.jpg",
      path: "C:/tmp/photo.jpg",
      mimeType: "image/jpeg",
      header: "Attachment 1: photo.jpg",
      readBytes: async () => Buffer.from("jpeg-bytes")
    }],
    describeImage: async (input) => {
      assert.equal(input.bridgeModel?.model, "qwen3-vl-plus");
      return {
        description: "图中是一只橙色的猫坐在窗台上。",
        visionModel: "qwen3-vl-plus",
        source: "remote"
      };
    }
  });

  assert.equal(resolved.mode, "describe_bridge");
  assert.equal(resolved.images[0]?.kind, "bridged");
  if (resolved.images[0]?.kind === "bridged") {
    assert.equal(resolved.images[0].source, "remote");
    assert.match(formatBridgedImageText(resolved.images[0]), /远程识图桥接/);
    assert.match(formatBridgedImageText(resolved.images[0]), /橙色的猫/);
  }
});

test("DeepSeek is never treated as native vision; bridge picks a VL catalog model", () => {
  assert.equal(isVisionCapableModel(deepseek), false);
  assert.equal(resolveImageHandleMode(deepseek), "describe_bridge");
  assert.equal(
    pickBridgeVisionModel([deepseek, gpt4o, qwenVl], "qwen3-vl-plus")?.model,
    "qwen3-vl-plus"
  );
  assert.equal(
    pickBridgeVisionModel([deepseek, gpt4o], undefined)?.model,
    "gpt-4o"
  );
  assert.equal(pickBridgeVisionModel([deepseek], undefined), undefined);
});

test("no vision bridge available yields a clear Chinese error", async () => {
  await assert.rejects(
    () => resolveTurnImages({
      mainModel: deepseek,
      availableModels: [deepseek],
      images: [{
        name: "a.png",
        path: "C:/a.png",
        mimeType: "image/png",
        header: "Attachment 1: a.png",
        readBytes: async () => Buffer.from("x")
      }],
      describeImage: async () => {
        throw new Error("授权模型目录中没有可用的远程视觉模型。；本地识图服务不可用。");
      }
    }),
    (error: unknown) =>
      error instanceof Error
      && error.message.startsWith(NO_IMAGE_BRIDGE_MESSAGE)
  );
});

test("preferred bridge vision model can be read from env", () => {
  assert.equal(
    resolvePreferredBridgeVisionModelFromEnv({
      NEWBRAIN_BRIDGE_VISION_MODEL: " qwen3-vl-plus "
    }),
    "qwen3-vl-plus"
  );
  assert.equal(
    resolvePreferredBridgeVisionModelFromEnv({
      NEWBRAIN_DEFAULT_VISION_MODEL: "gpt-4o"
    }),
    "gpt-4o"
  );
});

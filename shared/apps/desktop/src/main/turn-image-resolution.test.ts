import assert from "node:assert/strict";
import test from "node:test";

const {
  IMAGE_OMITTED_UNSUPPORTED,
  pickBridgeVisionModel,
  resolveImageHandleMode,
  resolvePreferredBridgeVisionModelFromEnv,
  resolveTurnImages
} = await import(new URL("./turn-image-resolution.ts", import.meta.url).href);
const { isVisionCapableModel, modelSupportsImageInput } = await import(new URL("./model-auto-router.ts", import.meta.url).href);

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

test("Auto outbound model=auto keeps images only for the selected model", async () => {
  const autoLiteral = { model: "auto", provider: "gateway", label: "Auto" };
  assert.equal(resolveImageHandleMode(autoLiteral), "omit");
  assert.equal(
    resolveImageHandleMode(autoLiteral, {
      requestedModel: "auto",
      availableModels: [deepseek, qwenVl],
      parentSelectedModel: "kimi-k2.6"
    }),
    "native"
  );
  assert.equal(
    resolveImageHandleMode(autoLiteral, {
      requestedModel: "auto",
      availableModels: [deepseek, qwenVl],
      parentSelectedModel: "deepseek-v4-pro"
    }),
    "native"
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

test("DeepSeek V4 keeps native image parts and does not call a vision model", async () => {
  assert.equal(isVisionCapableModel(deepseek), false);
  assert.equal(modelSupportsImageInput(deepseek), true);
  assert.equal(resolveImageHandleMode(deepseek), "native");

  const resolved = await resolveTurnImages({
    mainModel: deepseek,
    availableModels: [deepseek, qwenVl],
    images: [{
      name: "photo.jpg",
      path: "C:/tmp/photo.jpg",
      mimeType: "image/jpeg",
      header: "Attachment 1: photo.jpg",
      readBytes: async () => Buffer.from("jpeg-bytes")
    }],
    describeImage: async () => {
      throw new Error("DeepSeek V4 must not start a side vision call");
    }
  });

  assert.equal(resolved.mode, "native");
  assert.equal(resolved.images[0]?.kind, "native");
});

test("a model without image input omits the image instead of calling vision", async () => {
  const ernie = { id: "9", provider: "百度", model: "ernie-5.1", label: "ernie-5.1" };
  assert.equal(modelSupportsImageInput(ernie), false);
  assert.equal(resolveImageHandleMode(ernie), "omit");
  const resolved = await resolveTurnImages({
    mainModel: ernie,
    availableModels: [ernie, qwenVl],
    preferredBridgeModel: "qwen3-vl-plus",
    images: [{
      name: "photo.jpg",
      path: "C:/tmp/photo.jpg",
      mimeType: "image/jpeg",
      header: "Attachment 1: photo.jpg",
      readBytes: async () => Buffer.from("jpeg-bytes")
    }],
    describeImage: async () => {
      throw new Error("omitted images must not call a vision model");
    }
  });
  assert.equal(resolved.mode, "omit");
  assert.equal(resolved.images[0]?.kind, "omitted");
  if (resolved.images[0]?.kind === "omitted") {
    assert.equal(resolved.images[0].text, IMAGE_OMITTED_UNSUPPORTED);
  }
});

test("bridge catalog helper still prefers an explicit VL model", () => {
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

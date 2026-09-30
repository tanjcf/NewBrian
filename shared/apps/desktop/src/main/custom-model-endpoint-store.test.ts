import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DesktopSecretProtector } from "./desktop-secret-vault.ts";
import { CustomModelEndpointStore } from "./custom-model-endpoint-store.ts";

const protector: DesktopSecretProtector = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8")
};

async function withStore(run: (store: CustomModelEndpointStore, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "custom-model-"));
  try {
    await run(new CustomModelEndpointStore(directory, protector), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("saves a custom endpoint without returning the API key", async () => {
  await withStore(async (store, directory) => {
    const saved = await store.save({
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-user-secret",
      model: "deepseek-chat"
    });
    assert.equal(saved.endpoints.length, 1);
    assert.equal(saved.selectedId, saved.endpoints[0]?.id);
    assert.equal(JSON.stringify(saved).includes("sk-user-secret"), false);
    const catalog = await readFile(join(directory, "catalog.json"), "utf8");
    assert.equal(catalog.includes("sk-user-secret"), false);
    const resolved = await store.resolveChatRequest(saved.selectedId);
    assert.equal(resolved?.apiKey, "sk-user-secret");
    assert.equal(resolved?.model, "deepseek-chat");
    assert.equal(resolved?.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(resolved?.wireApi, "chat.completions");
  });
});

test("delete removes the endpoint and its key", async () => {
  await withStore(async (store) => {
    const saved = await store.save({
      label: "Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "local-key",
      model: "llama3"
    });
    const id = saved.endpoints[0]?.id || "";
    const deleted = await store.delete(id);
    assert.equal(deleted.endpoints.length, 0);
    assert.equal(deleted.selectedId, "");
    assert.equal(await store.resolveChatRequest(id), null);
  });
});

test("select clears when the caller picks an official model", async () => {
  await withStore(async (store) => {
    const saved = await store.save({
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      model: "gpt-4o"
    });
    const cleared = await store.select("");
    assert.equal(cleared.selectedId, "");
    assert.equal(cleared.endpoints.length, 1);
    const selected = await store.select(saved.endpoints[0]?.id || "");
    assert.equal(selected.selectedId, saved.endpoints[0]?.id);
  });
});

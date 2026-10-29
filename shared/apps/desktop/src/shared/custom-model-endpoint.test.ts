import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomModelEndpointError,
  isCustomModelSelection,
  normalizeCustomModelBaseUrl,
  normalizeCustomModelEndpointDraft,
  preserveCustomModelSelection
} from "./custom-model-endpoint.ts";

test("accepts https endpoints and local http endpoints", () => {
  assert.equal(normalizeCustomModelBaseUrl(" https://api.openai.com/v1/ "), "https://api.openai.com/v1");
  assert.equal(normalizeCustomModelBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  assert.equal(normalizeCustomModelBaseUrl("http://localhost:11434/v1"), "http://localhost:11434/v1");
});

test("rejects public http, credentials, and non-http protocols", () => {
  assert.throws(() => normalizeCustomModelBaseUrl("http://api.example.com/v1"), CustomModelEndpointError);
  assert.throws(() => normalizeCustomModelBaseUrl("https://user:secret@api.example.com/v1"), CustomModelEndpointError);
  assert.throws(() => normalizeCustomModelBaseUrl("file:///tmp/model"), CustomModelEndpointError);
});

test("requires a display name, model id, and API key", () => {
  const draft = normalizeCustomModelEndpointDraft({
    label: " DeepSeek ",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: " sk-test ",
    model: " deepseek-chat "
  });
  assert.deepEqual(draft, {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-test",
    model: "deepseek-chat"
  });
  assert.throws(() => normalizeCustomModelEndpointDraft({
    label: " ",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-test",
    model: "deepseek-chat"
  }), /显示名/);
});

test("preserves only custom model selections across a catalog refresh", () => {
  assert.equal(preserveCustomModelSelection(" custom:11111111-1111-1111-1111-111111111111 "), "custom:11111111-1111-1111-1111-111111111111");
  assert.equal(preserveCustomModelSelection("deepseek-v4-flash"), "");
  assert.equal(isCustomModelSelection("custom:abc"), true);
});

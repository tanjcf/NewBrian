import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { fetchModelResponseWithHeadersTimeout } from "./model-response-request.ts";

test("does not impose a fixed deadline while waiting for model response headers", async () => {
  const fetchImpl: typeof fetch = async () => new Promise((resolve) => {
    setTimeout(() => resolve(new Response("ready", { status: 200 })), 25);
  });
  const response = await fetchModelResponseWithHeadersTimeout("https://gateway.example/v1/responses", {
    method: "POST",
  }, { fetchImpl });
  assert.equal(await response.text(), "ready");
});

test("preserves explicit user cancellation instead of reporting a headers timeout", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancelled by user");
  const fetchImpl: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const pending = fetchModelResponseWithHeadersTimeout("https://gateway.example/v1/responses", {
    signal: controller.signal,
  }, { fetchImpl });
  controller.abort(cancellation);

  await assert.rejects(pending, /cancelled by user/);
});

test("does not abort the response body after headers arrive within the headers budget", async () => {
  let requestSignal: AbortSignal | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Response("stream-body", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const response = await fetchModelResponseWithHeadersTimeout(
    "https://gateway.example/v1/responses",
    { method: "POST", signal: new AbortController().signal },
    { fetchImpl },
  );
  assert.equal(response.status, 200);
  assert.ok(requestSignal);
  assert.equal(requestSignal.aborted, false);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(requestSignal.aborted, false, "headers timeout must not kill an active stream body");
  assert.equal(await response.text(), "stream-body");
});

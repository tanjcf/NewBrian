const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveChannelEndpoints, rewriteEndpointText } = require("./prepare-package-resources.cjs");

test("production channel uses the live sinnauze gateway and web app", () => {
  const previous = {
    gateway: process.env.NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL,
    preview: process.env.NEWBRAIN_PRODUCTION_PREVIEW_URL
  };
  delete process.env.NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL;
  delete process.env.NEWBRAIN_PRODUCTION_PREVIEW_URL;
  try {
    assert.deepEqual(resolveChannelEndpoints("production"), {
      gatewayBaseUrl: "https://api.sinnauze.cn/v1",
      previewUrl: "https://www.sinnauze.cn"
    });
  } finally {
    if (previous.gateway === undefined) delete process.env.NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL;
    else process.env.NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL = previous.gateway;
    if (previous.preview === undefined) delete process.env.NEWBRAIN_PRODUCTION_PREVIEW_URL;
    else process.env.NEWBRAIN_PRODUCTION_PREVIEW_URL = previous.preview;
  }
});

test("test channel stays on the shared fixture and does not call production", () => {
  const previous = {
    gateway: process.env.NEWBRAIN_TEST_GATEWAY_BASE_URL,
    preview: process.env.NEWBRAIN_TEST_PREVIEW_URL
  };
  delete process.env.NEWBRAIN_TEST_GATEWAY_BASE_URL;
  delete process.env.NEWBRAIN_TEST_PREVIEW_URL;
  try {
    assert.deepEqual(resolveChannelEndpoints("test"), {
      gatewayBaseUrl: "http://203.0.113.10:8790/v1",
      previewUrl: "http://203.0.113.10:3000"
    });
  } finally {
    if (previous.gateway === undefined) delete process.env.NEWBRAIN_TEST_GATEWAY_BASE_URL;
    else process.env.NEWBRAIN_TEST_GATEWAY_BASE_URL = previous.gateway;
    if (previous.preview === undefined) delete process.env.NEWBRAIN_TEST_PREVIEW_URL;
    else process.env.NEWBRAIN_TEST_PREVIEW_URL = previous.preview;
  }
});

test("production rewrite keeps the gateway path and moves preview hosts", () => {
  const updated = rewriteEndpointText(
    [
      "http://127.0.0.1:8790/v1",
      "https://api.sinnauze.cn/v1",
      "http://127.0.0.1:3000",
      "https://www.sinnauze.cn/app/download"
    ].join("\n"),
    "https://api.sinnauze.cn/v1",
    "https://www.sinnauze.cn"
  );
  assert.equal(updated, [
    "https://api.sinnauze.cn/v1",
    "https://api.sinnauze.cn/v1",
    "https://www.sinnauze.cn",
    "https://www.sinnauze.cn/app/download"
  ].join("\n"));
});

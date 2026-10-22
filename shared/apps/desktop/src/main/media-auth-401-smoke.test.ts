/**
 * MEDIA-AUTH-401-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Image/media tool HTTP 401 must surface a clear Chinese message (offline; no live gateway).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MEDIA_GENERATION_AUTH_USER_MESSAGE,
  MEDIA_GENERATION_MISSING_MODEL_USER_MESSAGE,
  MediaGenerationHttpError,
  isMediaGenerationAuthenticationError,
  mapMediaGenerationAuthUserMessage,
  mapMediaGenerationMissingModelUserMessage
} from "./media-generation-gateway.ts";

export const CASE_ID = "MEDIA-AUTH-401-SMOKE-001";

test(`${CASE_ID} maps media 401/403 to clear Chinese guidance`, () => {
  const auth401 = new MediaGenerationHttpError(
    401,
    "Auto 媒体工具失败（401）：Unauthorized",
    { error: "Unauthorized", status: 401 }
  );
  assert.equal(isMediaGenerationAuthenticationError(auth401), true);
  assert.equal(mapMediaGenerationAuthUserMessage(auth401), MEDIA_GENERATION_AUTH_USER_MESSAGE);
  assert.match(MEDIA_GENERATION_AUTH_USER_MESSAGE, /重新登录/);
  assert.match(MEDIA_GENERATION_AUTH_USER_MESSAGE, /不是缺模型|不要去.*模型配置/);
  assert.doesNotMatch(MEDIA_GENERATION_AUTH_USER_MESSAGE, /undefined|null|silent/i);

  const auth403 = new MediaGenerationHttpError(403, "Auto 媒体工具失败（403）：Forbidden", null);
  assert.equal(mapMediaGenerationAuthUserMessage(auth403), MEDIA_GENERATION_AUTH_USER_MESSAGE);

  assert.equal(
    mapMediaGenerationAuthUserMessage("Auto 媒体工具失败（401）：token expired"),
    MEDIA_GENERATION_AUTH_USER_MESSAGE
  );
  assert.equal(mapMediaGenerationAuthUserMessage("媒体生成需要已登录的网关凭证。"), MEDIA_GENERATION_AUTH_USER_MESSAGE);
  assert.equal(mapMediaGenerationAuthUserMessage("provider unavailable"), null);
  assert.equal(mapMediaGenerationAuthUserMessage(new MediaGenerationHttpError(500, "boom", null)), null);
});

test(`${CASE_ID} maps missing media model 404 separately from auth 401`, () => {
  const missing = new MediaGenerationHttpError(
    404,
    "Auto 媒体工具失败（404）：image generation model is not available",
    { detail: "image generation model is not available" }
  );
  assert.equal(mapMediaGenerationAuthUserMessage(missing), null);
  assert.equal(
    mapMediaGenerationMissingModelUserMessage(missing),
    MEDIA_GENERATION_MISSING_MODEL_USER_MESSAGE
  );
  assert.match(MEDIA_GENERATION_MISSING_MODEL_USER_MESSAGE, /hy-image-v3|混元生图|模型配置/);
});

test(`${CASE_ID} auto media tool catch path maps auth failures before raw English output`, () => {
  const source = readFileSync(new URL("./auto-media-agent-tools.ts", import.meta.url), "utf8");
  assert.match(source, /mapMediaGenerationAuthUserMessage/);
  assert.match(source, /executeWithMediaAuthenticationRetry/);
  assert.match(source, /MEDIA_GENERATION_AUTH_USER_MESSAGE/);
  const executeStart = source.indexOf("async function executeAutoMediaTool");
  assert.ok(executeStart >= 0);
  const execute = source.slice(executeStart, source.indexOf("export function registerAutoMediaAgentTools"));
  assert.match(execute, /MEDIA_GENERATION_AUTH_USER_MESSAGE/);
  const outerCatchMarker = "const authMapped = mapMediaGenerationAuthUserMessage(error);";
  const outerCatchAt = execute.indexOf(outerCatchMarker);
  assert.ok(outerCatchAt >= 0, "outer executeAutoMediaTool catch must map auth errors");
  const afterMap = execute.slice(outerCatchAt);
  assert.match(afterMap, /if \(authMapped\) return \{ ok: false, output: authMapped \}/);
  assert.ok(
    afterMap.indexOf("if (authMapped)") < afterMap.indexOf("error instanceof Error ? error.message"),
    "auth mapping must run before falling back to the raw error message"
  );
  assert.match(afterMap, /mapMediaGenerationMissingModelUserMessage/);
});

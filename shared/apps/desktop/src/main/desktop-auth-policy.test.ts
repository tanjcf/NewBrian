import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./desktop-auth-policy.ts", import.meta.url).href);

test("normalizes user identity and masks audit email", () => {
  const user = policy.buildDesktopAuthUserFromApi({ email: " USER@Example.COM ", name: " 张三 ", role: "admin", amr: ["pwd"] });
  assert.equal(user.display_name, "张三");
  assert.equal(user.plan, "管理员");
  assert.equal(user.avatar_text, "张");
  assert.equal(policy.maskEmail(" USER@Example.COM "), "us***@example.com");
  assert.equal(policy.maskEmail("a@example.com"), "***");
});

test("maps account capability flags from the API contract", () => {
  assert.deepEqual(policy.buildDesktopAuthAccountFromApi({
    id: "account-1",
    planType: "team",
    isConversationClassifierEnabledForWorkspace: true,
    isDelinquent: true
  }), {
    id: "account-1",
    plan_type: "team",
    structure: "",
    conversation_classifier_enabled: true,
    finserv_enabled: false,
    fedramp_compliant: false,
    delinquent: true,
    residency_region: "",
    compute_residency: ""
  });
});

test("formats authenticated errors without duplicating detail", () => {
  assert.equal(policy.extractDesktopAuthErrorMessage({ code: "DENIED", message: "No access", detail: "No access", request_id: "req-1" }, 403), "DENIED: No access | request_id=req-1");
  assert.equal(policy.extractDesktopAuthErrorMessage(null, 401), "认证失败 (401)");
});

test("classifies connection and retryable gateway failures", () => {
  assert.equal(policy.normalizeConnectionErrorMessage(new Error("fetch failed")), "无法连接认证服务，请检查网络或服务器地址。");
  assert.equal(policy.isRetryableModelGatewayError(new Error("HTTP 503 unavailable")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("HTTP 400 invalid")), false);
  assert.equal(policy.isRetryableModelGatewayError(new Error("fetch failed")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("AgentHostClientError: fetch failed")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("无法连接模型网关；endpoint=http://127.0.0.1:8790/v1")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("连接模型网关超时；请稍后重试。")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("Model response stream inactive for 30000ms.")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("Model response did not include assistant content or tool calls.")), true);
  assert.equal(policy.isRetryableModelGatewayError(new Error("Model response stream ended before a terminal event.")), true);
  const nested = new Error("fetch failed");
  (nested as Error & { cause?: Error }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(policy.isRetryableModelGatewayError(nested), true);
});

test("merges Set-Cookie values by cookie name without attributes", () => {
  assert.equal(policy.createCookieHeaderFromSetCookie([
    "session=old; Path=/; HttpOnly",
    "theme=dark; Path=/",
    "session=new; Path=/; Secure",
    "invalid-cookie"
  ]), "session=new; theme=dark");
});

test("reads Set-Cookie headers across modern, legacy, and standard Fetch implementations", () => {
  assert.deepEqual(policy.readSetCookieHeaders({ headers: { getSetCookie: () => ["a=1", "b=2"] } }), ["a=1", "b=2"]);
  assert.deepEqual(policy.readSetCookieHeaders({ headers: { raw: () => ({ "set-cookie": ["legacy=1"] }) } }), ["legacy=1"]);
  assert.deepEqual(policy.readSetCookieHeaders({ headers: { get: () => "single=1" } }), ["single=1"]);
  assert.deepEqual(policy.readSetCookieHeaders({ headers: { get: () => null } }), []);
});

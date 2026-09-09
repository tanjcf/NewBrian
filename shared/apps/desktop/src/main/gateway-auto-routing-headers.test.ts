import assert from "node:assert/strict";
import test from "node:test";
import { readGatewayAutoRoutingHeaders } from "./gateway-auto-routing-headers.ts";

test("reads selected model and routing reason headers case-insensitively", () => {
  const headers = new Headers({
    "X-Newbrain-Selected-Model": "deepseek-v4-flash",
    "X-Newbrain-Routing-Reason": "greeting_direct,task_class=chat",
    "X-Newbrain-Model-Alias": "auto"
  });
  const parsed = readGatewayAutoRoutingHeaders(headers);
  assert.equal(parsed.selectedModel, "deepseek-v4-flash");
  assert.equal(parsed.modelAlias, "auto");
  assert.match(parsed.routingReason, /greeting_direct/);
});

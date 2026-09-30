import assert from "node:assert/strict";
import test from "node:test";

const { normalizeDesktopBillingPayload } = await import(new URL("./desktop-billing-policy.ts", import.meta.url).href);

test("selects the active subscription and aggregates usage fallbacks", () => {
  const result = normalizeDesktopBillingPayload({
    subscription: {
      subscriptions: [
        { id: "expired", status: "expired", plan_name: "Old" },
        { id: "active", status: "active", plan_name: "Pro", vendor_name: "OmniRoute" }
      ],
      invoices: [{ id: "invoice-1" }]
    },
    usage: {
      records: [
        { prompt_tokens: 10, completion_tokens: 5 },
        { input_tokens: 20, output_tokens: 7 }
      ]
    }
  });

  assert.equal(result.summary.id, "active");
  assert.equal(result.summary.provider_name, "OmniRoute");
  assert.equal(result.summary.monthly_tokens_used, 42);
  assert.equal(result.summary.monthly_tasks_used, 2);
  assert.deepEqual(result.billing_history, [{ id: "invoice-1" }]);
});

test("uses bootstrap entitlements when subscription summary is absent", () => {
  const result = normalizeDesktopBillingPayload({
    bootstrap: { entitlements: { plan_name: "Team", monthly_tokens_quota: "1000" } },
    usage: { summary: { total_requests: 8 } }
  });

  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.summary.plan_name, "Team");
  assert.equal(result.summary.monthly_tokens_quota, 1000);
  assert.equal(result.summary.monthly_tasks_used, 8);
});

test("does not invent a subscription from usage-only data", () => {
  const result = normalizeDesktopBillingPayload({ usage: { items: [{ input_tokens: 4 }] } });
  assert.deepEqual(result.subscriptions, []);
  assert.equal(result.summary.monthly_tokens_used, 4);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildWalletPaymentUrl } from "./wallet-payment-url.ts";

test("wallet payment opens the online payment wallet page", () => {
  assert.equal(
    buildWalletPaymentUrl("https://www.sinnauze.cn"),
    "https://www.sinnauze.cn/app/online-payment?mode=wallet"
  );
  assert.equal(
    buildWalletPaymentUrl("http://203.0.113.10:3000/preview"),
    "http://203.0.113.10:3000/app/online-payment?mode=wallet"
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createBillingHandler } from "../api/billing.js";

const subject = "37e1921b-3711-4f2e-8fb9-e36690ceef75";
const id = "7f93fef4-b7a1-462a-8f66-15e9da0f9ce1";
const providerId = "810ed1e2-ce3c-4234-acd9-9ad2bbac3943";
const merchant = "78a2157e-9a49-4683-ae7b-5aa58924501b";
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "server",
  PLATEGA_MERCHANT_ID: merchant, PLATEGA_SECRET: "platega", PLATEGA_RETURN_URL: "https://cortex.example/return",
  CORTEX_BILLING_TOKEN: "edge", CORTEX_BILLING_TEST_KEY: "sandbox"
};

async function request(handler, body, headers = {}, query = {}) {
  const res = {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(json) { return { code: this.code, json }; }
  };
  return handler({ method: "POST", headers, query, body }, res);
}

test("disabled billing never contacts Platega or Supabase", async () => {
  const handler = createBillingHandler({}, () => assert.fail("network call"));
  assert.equal((await request(handler, { operation: "checkout" })).json.error, "payments_disabled");
});

test("webhook authenticates and rechecks ID, amount, currency and provider status", async () => {
  let amount = 398, settled = 0;
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, async (url, options) => {
    const parsed = new URL(url);
    if (parsed.host === "app.platega.io") {
      assert.equal(parsed.pathname, "/transaction/" + providerId);
      return Response.json({ id: providerId, status: "CONFIRMED", payload: "cortex:" + id,
        paymentDetails: { currency: "RUB", amount }, mechantId: merchant });
    }
    if (parsed.pathname === "/rest/v1/cortex_payments") {
      assert.equal(parsed.searchParams.get("mode"), "eq.live");
      return Response.json([{ id, subject, mode: "live", amount: 39900 }]);
    }
    settled++;
    assert.equal(JSON.parse(options.body).p_amount, 39900);
    assert.equal(JSON.parse(options.body).p_state, "confirmed");
    return Response.json({ id });
  });
  const notify = (secret, status) => request(handler, { id: providerId, status }, { "x-merchantid": merchant, "x-secret": secret }, { webhook: "1" });
  assert.equal((await notify("bad", "CONFIRMED")).code, 401);
  assert.equal((await notify("platega", "CONFIRMED")).code, 409);
  assert.equal(settled, 0);
  amount = 399;
  assert.equal((await notify("platega", "PENDING")).code, 200);
  assert.equal(settled, 1);
});

test("payment status is scoped to the account and webhook writes exclude test mode", async () => {
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "test" }, async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("subject"), "eq." + subject);
    assert.equal(parsed.searchParams.get("mode"), "eq.test");
    return Response.json([]);
  });
  assert.equal((await request(handler, { operation: "status", subject, id })).code, 401);
  assert.equal((await request(handler, { operation: "status", subject, id }, { authorization: "Bearer edge" })).code, 404);
  assert.equal((await request(handler, { id: providerId }, {}, { webhook: "1" })).code, 503);
});

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

test("test-mode payment simulation needs the server gateway and separate sandbox key", async () => {
  let settled = 0;
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "test" }, async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/rest/v1/cortex_payments") return Response.json([
      { id, subject, mode: "test", plan: "pro", amount: 39900, provider_id: providerId, state: "pending" }
    ]);
    assert.equal(path, "/rest/v1/rpc/cortex_billing_payment");
    const payload = JSON.parse(options.body);
    assert.equal(payload.p_state, "confirmed");
    assert.equal(payload.p_mode, "test");
    settled++;
    return Response.json({ id, subject, mode: "test", state: "confirmed", plan: "pro", amount: 39900 });
  });
  const body = { operation: "simulate", subject, id, state: "confirmed" };
  assert.equal((await request(handler, body, { authorization: "Bearer wrong" })).code, 401);
  assert.equal((await request(handler, body, { authorization: "Bearer edge" })).code, 400);
  assert.equal(settled, 0);
  const result = await request(handler, body,
    { authorization: "Bearer edge", "x-cortex-billing-test-key": "sandbox" });
  assert.equal(result.code, 200);
  assert.equal(result.json.state, "confirmed");
  assert.equal(result.json.test, true);
  assert.equal(settled, 1);
});

test("checkout rejects missing or invalid account email before reserving an order", async () => {
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, () => assert.fail("network call"));
  for (const email of [undefined, {}, "no-at.example", "buyer@example..com", "buyer@example.com\n", "a".repeat(65) + "@example.com"]) {
    const response = await request(handler, { operation: "checkout", subject, plan: "pro", email }, { authorization: "Bearer edge" });
    assert.deepEqual(response, { code: 400, json: { error: "invalid_email" } });
  }
});

for (const operation of ["checkout", "renew"]) {
  test(operation + " forwards the authenticated buyer email unchanged in Platega metadata", async () => {
    const email = "Subscriber+renew@example.com";
    const order = { id, subject, mode: "live", plan: "pro", amount: 39900 };
    const redirect = "https://pay.platega.io/checkout";
    const calls = [];
    const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, async (url, options) => {
      const { pathname } = new URL(url);
      const payload = JSON.parse(options.body);
      calls.push(pathname);
      if (pathname === "/rest/v1/rpc/cortex_billing_order") {
        assert.deepEqual(payload, { p_subject: subject, p_plan: "pro", p_mode: "live" });
        return Response.json(order);
      }
      if (pathname === "/transaction/process") {
        assert.deepEqual(payload.metadata, { user_email: email });
        assert.deepEqual(payload.paymentDetails, { currency: "RUB", amount: 399 });
        assert.equal(payload.payload, "cortex:" + id);
        return Response.json({ transactionId: providerId, redirect });
      }
      assert.equal(pathname, "/rest/v1/rpc/cortex_billing_payment");
      assert.equal(payload.p_state, "pending");
      return Response.json({ ...order, state: "pending", checkout_url: redirect });
    });
    const response = await request(handler, { operation, subject, plan: "pro", email }, { authorization: "Bearer edge" });
    assert.equal(response.code, 200);
    assert.equal(response.json.checkout_url, redirect);
    assert.deepEqual(calls, ["/rest/v1/rpc/cortex_billing_order", "/transaction/process", "/rest/v1/rpc/cortex_billing_payment"]);
  });
}

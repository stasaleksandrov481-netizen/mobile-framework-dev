import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBillingHandler } from "../api/billing.js";

const subject = "37e1921b-3711-4f2e-8fb9-e36690ceef75";
const id = "7f93fef4-b7a1-462a-8f66-15e9da0f9ce1";
const invoice = (BigInt("0x" + id.replaceAll("-", "").slice(0, 15)) + 1n).toString();
const sum = "399.00";
const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "server",
  ROBOKASSA_MERCHANT_LOGIN: "cortex-test", ROBOKASSA_PASSWORD_1: "first",
  ROBOKASSA_PASSWORD_2: "second", ROBOKASSA_LIVE_APPROVED: "true",
  CORTEX_BILLING_TOKEN: "edge", CORTEX_BILLING_TEST_KEY: "sandbox"
};
const md5 = input => createHash("md5").update(input, "utf8").digest("hex");
async function request(handler, body, headers = {}, query = {}) {
  const res = {
    code: 200, setHeader() {},
    status(code) { this.code = code; return this; },
    json(json) { return { code: this.code, json }; },
    send(value) { return { code: this.code, text: value }; }
  };
  return handler({ method: "POST", headers, query, body }, res);
}
const auth = { authorization: "Bearer edge" };

test("billing is OFF without explicit Robokassa merchant approval and keys", async () => {
  const handler = createBillingHandler({ ...env, ROBOKASSA_LIVE_APPROVED: "false", CORTEX_BILLING_MODE: "live" }, () => assert.fail("network"));
  assert.equal((await request(handler, { operation: "checkout", plan: "pro", subject, email: "buyer@example.com" }, auth)).json.error, "payments_disabled");
  assert.equal((await request(handler, { OutSum: sum }, {}, { webhook: "1" })).code, 503);
});
test("missing and invalid account emails fail before reserving a Robokassa invoice", async () => {
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, () => assert.fail("network"));
  for (const email of [undefined, {}, "no-at.example", "buyer@example..com", "buyer@example.com\n", "a".repeat(65) + "@example.com"]) {
    assert.deepEqual(await request(handler, { operation: "checkout", subject, plan: "pro", email }, auth),
      { code: 400, json: { error: "invalid_email" } });
  }
});
for (const operation of ["checkout", "renew"]) {
  test(operation + " builds signed Robokassa link using server-side order and signed buyer email", async () => {
    const email = "Subscriber+renew@example.com";
    const order = { id, subject, mode: "live", plan: "pro", amount: 39900 };
    const calls = [];
    const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, async (url, options) => {
      const { pathname } = new URL(url);
      calls.push(pathname);
      const payload = JSON.parse(options.body);
      if (pathname === "/rest/v1/rpc/cortex_billing_order") {
        assert.deepEqual(payload, { p_subject: subject, p_plan: "pro", p_mode: "live" });
        return Response.json(order);
      }
      assert.equal(pathname, "/rest/v1/rpc/cortex_billing_payment");
      assert.equal(payload.p_provider, id);
      assert.equal(payload.p_state, "pending");
      assert.equal(payload.p_amount, 39900);
      return Response.json({ ...order, state: "pending", checkout_url: payload.p_url });
    });
    const response = await request(handler, { operation, subject, plan: "pro", email }, auth);
    assert.equal(response.code, 200);
    const url = new URL(response.json.checkout_url);
    assert.equal(url.origin, "https://auth.robokassa.ru");
    assert.equal(url.pathname, "/Merchant/Index.aspx");
    assert.equal(url.searchParams.get("MerchantLogin"), "cortex-test");
    assert.equal(url.searchParams.get("Email"), email);
    assert.equal(url.searchParams.get("OutSum"), sum);
    assert.equal(url.searchParams.get("InvId"), invoice);
    assert.equal(url.searchParams.get("Shp_order"), id);
    assert.equal(url.searchParams.get("SignatureValue"), md5("cortex-test:" + sum + ":" + invoice + ":first:Shp_order=" + id));
    assert.deepEqual(calls, ["/rest/v1/rpc/cortex_billing_order", "/rest/v1/rpc/cortex_billing_payment"]);
  });
}
test("ResultURL rejects forged signatures, unexpected amounts and invoice mismatch before confirming", async () => {
  let amount = "398.000000", saved = 0;
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === "/rest/v1/cortex_payments") return Response.json([{ id, mode: "live", amount: 39900, provider_id: id }]);
    assert.equal(pathname, "/rest/v1/rpc/cortex_billing_payment");
    saved++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.p_state, "confirmed");
    assert.equal(payload.p_provider, id);
    return Response.json({ id, mode: "live", state: "confirmed" });
  });
  function notify(outSum, invoiceId = invoice, secret = "second") {
    const body = { OutSum: outSum, InvId: invoiceId, Shp_order: id,
      SignatureValue: md5(outSum + ":" + invoiceId + ":" + secret + ":Shp_order=" + id) };
    return request(handler, body, {}, { webhook: "1" });
  }
  assert.equal((await notify(amount, invoice, "wrong")).code, 401);
  assert.equal(saved, 0);
  assert.equal((await notify(amount)).code, 409);
  assert.equal(saved, 0);
  amount = "399.000000";
  assert.equal((await notify(amount, "3")).code, 409);
  assert.equal(saved, 0);
  assert.deepEqual(await notify(amount), { code: 200, text: "OK" + invoice });
  assert.deepEqual(await notify(amount), { code: 200, text: "OK" + invoice });
  assert.equal(saved, 2);
});
test("status is limited to signed-in subject, with no gateway polling", async () => {
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "test" }, async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("subject"), "eq." + subject);
    assert.equal(parsed.searchParams.get("mode"), "eq.test");
    return Response.json([]);
  });
  assert.equal((await request(handler, { operation: "status", subject, id })).code, 401);
  assert.equal((await request(handler, { operation: "status", subject, id }, auth)).code, 404);
  assert.equal((await request(handler, { OutSum: sum }, {}, { webhook: "1" })).code, 503);
});
test("refund API stays unavailable without verified Robokassa operation key and Password #3", async () => {
  const handler = createBillingHandler({ ...env, CORTEX_BILLING_MODE: "live" }, async url => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/cortex_admin_billing");
    return Response.json({ ok: true });
  });
  const token = "a".repeat(42);
  assert.deepEqual(await request(handler, { operation: "refund", id }, { authorization: "Bearer " + token }),
    { code: 409, json: { error: "refund_unavailable" } });
});

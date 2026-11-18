import assert from "node:assert/strict";
import test from "node:test";
import { processTelegramStarsUpdate } from "../lib/telegram-stars-webhook.ts";
import { verifyTelegramStarsReceipt } from "../lib/telegram-stars.ts";

const id = "7f93fef4-b7a1-462a-8f66-15e9da0f9ce1";
const charge = "test-provider-charge-1234";
const user = 712345678;
const stars = 399;

function precheckout(idValue = id, amount = stars, buyer = user) {
  return { update_id: 123456,
    pre_checkout_query: { id: "precheckout-1", from: { id: buyer }, currency: "XTR",
      total_amount: amount, invoice_payload: `cortex-stars:${idValue}` } };
}

function payment(idValue = id, amount = stars, buyer = user, receipt = charge) {
  return { update_id: 123457, message: { from: { id: buyer }, successful_payment: {
    currency: "XTR", total_amount: amount, invoice_payload: `cortex-stars:${idValue}`,
    telegram_payment_charge_id: receipt,
  } } };
}

function refund(receipt = charge) {
  return { update_id: 123458, message: { refunded_payment: {
    currency: "XTR", telegram_payment_charge_id: receipt,
  } } };
}

test("End-to-end mocked Stars flow: no receipt, no entitlement; confirmed once, then revoked once", async () => {
  let phase = "invoiced", grants = 0, revocations = 0;
  let history = [], telegramAnswers = [];
  const realLedgerCheck = receipt => verifyTelegramStarsReceipt("dummy", receipt,
    async (_token, _method, { offset }) => ({ transactions: offset === 0 ? history : [] }));
  const rpc = async (name, params) => {
    if (name === "cortex_stars_precheckout") {
      const accepted = phase === "invoiced" && params.p_id === id &&
        params.p_buyer === user && params.p_stars === stars;
      if (accepted) phase = "prechecked";
      return { data: { ok: accepted }, error: null };
    }
    if (name === "cortex_stars_confirm") {
      if (params.p_id !== id || params.p_buyer !== user ||
          params.p_stars !== stars || params.p_charge !== charge) return { data: { ok: false } };
      if (phase === "prechecked") { phase = "paid"; grants++; }
      return { data: { ok: phase === "paid" || phase === "refunded" } };
    }
    if (name === "cortex_stars_refund") {
      if (params.p_charge !== charge) return { data: { ok: false } };
      if (phase === "paid") { phase = "refunded"; revocations++; }
      return { data: { ok: phase === "refunded" } };
    }
    throw new Error("unexpected database RPC: " + name);
  };
  const services = {
    rpc,
    verify: realLedgerCheck,
    telegram: async (name, params) => {
      telegramAnswers.push({ name, params });
      return true;
    },
  };

  assert.equal(await processTelegramStarsUpdate(precheckout(), services), 200);
  assert.deepEqual(telegramAnswers[0].params, { pre_checkout_query_id: "precheckout-1", ok: true });
  assert.equal(phase, "prechecked");

  // JSON forged with secret in an external request is still no payment proof.
  assert.equal(await processTelegramStarsUpdate(payment(), services), 503);
  assert.deepEqual([phase, grants], ["prechecked", 0]);
  history = [{ id: charge, date: 1794930000, amount: stars,
    source: { type: "user", transaction_type: "invoice_payment", user: { id: user },
      invoice_payload: `cortex-stars:${id}` } }];

  assert.equal(await processTelegramStarsUpdate(payment(id, stars, user + 1), services), 503);
  assert.equal(await processTelegramStarsUpdate(payment(id, 1), services), 503);
  assert.equal(await processTelegramStarsUpdate(payment(id, stars, user, "another-charge"), services), 503);
  assert.equal(grants, 0);

  assert.equal(await processTelegramStarsUpdate(payment(), services), 200);
  assert.equal(phase, "paid");
  assert.equal(grants, 1);
  assert.equal(await processTelegramStarsUpdate(payment(), services), 200);
  assert.equal(grants, 1);

  assert.equal(await processTelegramStarsUpdate(refund(), services), 503);
  assert.equal(revocations, 0);
  history.unshift({ id: charge, date: 1794930060, amount: -stars,
    receiver: { type: "user", user: { id: user } } });
  assert.equal(await processTelegramStarsUpdate(refund(), services), 200);
  assert.deepEqual([phase, revocations], ["refunded", 1]);
  assert.equal(await processTelegramStarsUpdate(refund(), services), 200);
  assert.equal(revocations, 1);
  assert.equal(await processTelegramStarsUpdate(payment(), services), 503);
  assert.equal(grants, 1);
});

test("Mismatched precheckout and provider failures never approve fake payment", async () => {
  let reserveCalls = 0;
  const services = {
    rpc: async () => { reserveCalls++; return { data: { ok: false } }; },
    verify: async () => false,
    telegram: async (_method, params) => {
      assert.equal(params.ok, false);
      return true;
    },
  };
  assert.equal(await processTelegramStarsUpdate(precheckout(id, 1), services), 200);
  assert.equal(reserveCalls, 1);
  assert.equal(await processTelegramStarsUpdate(precheckout("bad-id"), services), 200);
  assert.equal(reserveCalls, 1);
  assert.equal(await processTelegramStarsUpdate({ message: { successful_payment: { currency: "RUB" } } }, services), 409);
  assert.equal(await processTelegramStarsUpdate(payment(), services), 503);
});

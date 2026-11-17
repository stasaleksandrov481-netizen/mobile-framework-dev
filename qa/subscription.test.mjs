import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const webAssets = new URL("../app/src/main/assets/web/", import.meta.url);
const source = readFileSync(new URL("subscription.js", webAssets), "utf8");
const subscription = runInNewContext(source + "\nCortexSubscription;", { Cortex: { state: { account: { id: "user" } } } });
const ui = {
  detail: (_title, _hint, content) => content,
  esc: value => String(value ?? ""),
  button: (label, _icon, action, value) => `<button data-action="${action}" data-value="${value}">${label}</button>`,
};

test("a paid checkout requires an enabled, positive current server price", () => {
  const catalog = { checkout: true, plans: [{ code: "start", price_kopecks: 19900 }] };
  assert.equal(subscription.checkoutPlan(catalog, "start")?.amount, 19900);
  assert.equal(subscription.checkoutPlan(catalog, "free"), null);
  assert.equal(subscription.checkoutPlan({ ...catalog, checkout: false }, "start"), null);
  assert.equal(subscription.checkoutPlan({ checkout: true, plans: [{ code: "start", price_kopecks: 0 }] }, "start"), null);
});

test("the app shows server quotas and terms, and describes Telegram as planned", () => {
  const markup = subscription.page({ connection: { subscription: {
    checkout: true, quota: { plan: "free" },
    plans: [{ code: "pro", price_kopecks: 39900, daily_tokens: 100000, advanced_tokens: 20000, context_chars: 32000 }],
    payments: [{ id: "11111111-2222-4333-8444-555555555555", plan: "pro", amount: 39900, state: "confirmed" }],
  } } }, ui);
  assert.match(markup, /399\s*₽/);
  assert.match(markup, /100\s*000 токенов в день/);
  assert.match(markup, /32\s*000 символов контекста/);
  assert.match(markup, /data-value="offer"/);
  assert.match(markup, /data-action="subscription-copy-order"/);
  assert.match(markup, /После запуска рассылки одноразовое приглашение будет приходить на почту аккаунта/);
  assert.doesNotMatch(markup, /https:\/\/t\.me\//);
});

test("the app hides stale prices when the server catalog is unavailable", () => {
  const markup = subscription.page({ connection: {} }, ui);
  assert.match(markup, /Актуальные цены пока не загрузились/);
  assert.doesNotMatch(markup, /₽|data-action="subscription-checkout"/);
});

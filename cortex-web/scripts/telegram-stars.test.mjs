import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readBoundedJson } from "../lib/bounded-json.ts";
import { findTelegramStarsPurchase, plainBotCommand, starsInvoiceUrl, starsPayloadId, starsPlan, telegramConfigurationValid,
  telegramBotApi, verifyTelegramStarsReceipt, webhookSecretValid } from "../lib/telegram-stars.ts";

const order = "7f93fef4-b7a1-462a-8f66-15e9da0f9ce1";

test("Stars invoice payloads reject arbitrary IDs, currencies and injection strings", () => {
  assert.equal(starsPayloadId(`cortex-stars:${order}`), order);
  for (const value of [null, "", `${order}`, `cortex:${order}`, `cortex-stars:${order}?price=1`,
    `cortex-stars:${order}\n`, `cortex-stars:../../secrets`, {}]) {
    assert.equal(starsPayloadId(value), null);
  }
  assert.equal(starsPlan("pro"), true);
  assert.equal(starsPlan("admin"), false);
});

test("Webhook secret is mandatory and constant-time compared", () => {
  const secret = "test_telegram_webhook_secret_1234567890";
  assert.equal(webhookSecretValid(secret, secret), true);
  assert.equal(webhookSecretValid(secret + "x", secret), false);
  assert.equal(webhookSecretValid(secret.slice(1), secret), false);
  assert.equal(webhookSecretValid(secret, undefined), false);
  assert.equal(webhookSecretValid("", "short"), false);
  assert.equal(webhookSecretValid(secret + "🤖", secret), false);
  assert.equal(telegramConfigurationValid("1234567890:" + "T".repeat(35), secret), true);
  assert.equal(telegramConfigurationValid("invalid", secret), false);
  assert.equal(telegramConfigurationValid("1234567890:" + "T".repeat(35), undefined), false);
});

test("Only clean Telegram invoice deep links can reach clients", () => {
  assert.equal(starsInvoiceUrl("https://t.me/$invoice-token"), "https://t.me/$invoice-token");
  for (const link of ["https://evil.t.me/x", "http://t.me/x", "javascript:alert(1)",
    "https://t.me@evil.test/invoice", "https://t.me/x#token", "https://t.me/x?next=evil.test", "/invoice"]) {
    assert.equal(starsInvoiceUrl(link), null);
  }
});

test("Oversize checkout and webhook bodies are rejected regardless of Content-Length", async () => {
  const make = (body, headers = {}) => new Request("https://example.test", {
    method: "POST", headers, body,
  });
  assert.deepEqual(await readBoundedJson(make('{"plan":"pro"}'), 1024), { plan: "pro" });
  await assert.rejects(readBoundedJson(make("x".repeat(2048)), 1024), /body_limit_exceeded/);
  await assert.rejects(readBoundedJson(make("{}", { "content-length": "4000" }), 1024), /invalid_body/);
  await assert.rejects(readBoundedJson(make("not json"), 1024), SyntaxError);
});

test("Bot calls validate tokens, never follow redirects, and reject provider failures", async () => {
  const botToken = "1234567890:" + "T".repeat(35); // syntactically valid dummy, never a credential
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: true, result: "https://t.me/$test-invoice" });
  };
  assert.equal(await telegramBotApi(botToken, "createInvoiceLink", {
    currency: "XTR", prices: [{ label: "PRO", amount: 75 }], provider_token: "",
  }, mock), "https://t.me/$test-invoice");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.parse(calls[0].options.body).currency, "XTR");
  await assert.rejects(telegramBotApi("not-a-bot-token", "createInvoiceLink", {}, mock), /telegram_not_configured/);
  await assert.rejects(telegramBotApi(botToken, "createInvoiceLink", {}, async () => Response.json({ ok: false })),
    /telegram_provider_unavailable/);
});

test("A forged successful_payment cannot grant access without an exact Telegram ledger match", async () => {
  const charge = "charge-00001234";
  const buyer = 1234567890;
  const genuine = {
    id: charge, amount: 399, date: 1794930000,
    source: { type: "user", transaction_type: "invoice_payment", user: { id: buyer },
      invoice_payload: `cortex-stars:${order}` },
  };
  let calls = 0;
  const ledger = async (_token, method, params) => {
    calls++;
    assert.equal(method, "getStarTransactions");
    assert.deepEqual(params, { offset: 0, limit: 100 });
    return { transactions: [genuine] };
  };
  const receipt = { kind: "payment", charge, buyer, orderId: order, stars: 399 };
  assert.equal(await verifyTelegramStarsReceipt("dummy", receipt, ledger), true);
  for (const fake of [
    { charge: "another-charge" }, { buyer: 42 }, { stars: 1 },
    { orderId: "4f39b0ae-b4c8-4d96-a896-dd5a52de4f48" },
  ]) assert.equal(await verifyTelegramStarsReceipt("dummy", { ...receipt, ...fake }, ledger), false);
  assert.equal(calls, 5);
});

test("Out-of-order histories, stale receipts and refunded transactions fail closed", async () => {
  const charge = "charge-refunded";
  const buyer = 1234567890;
  const paid = {
    id: charge, amount: 199, date: 1794930000,
    source: { type: "user", transaction_type: "invoice_payment", user: { id: buyer },
      invoice_payload: `cortex-stars:${order}` },
  };
  const refunded = { id: charge, amount: -199, date: 1794930050,
    receiver: { type: "user", user: { id: buyer } } };
  const payment = { kind: "payment", orderId: order, charge, buyer, stars: 199 };
  const onePage = rows => async () => ({ transactions: rows });
  assert.equal(await verifyTelegramStarsReceipt("dummy", payment, onePage([refunded, paid])), false);
  assert.equal(await verifyTelegramStarsReceipt("dummy", { kind: "refund", charge }, onePage([refunded, paid])), true);
  assert.equal(await verifyTelegramStarsReceipt("dummy", { kind: "refund", charge }, onePage([paid])), false);
  assert.equal(await verifyTelegramStarsReceipt("dummy", payment, onePage([{ ...paid, amount: 1 }])), false);
  assert.equal(await verifyTelegramStarsReceipt("dummy", payment, onePage([{ ...paid,
    source: { ...paid.source, transaction_type: "paid_media_payment" } }])), false);
  assert.equal(await verifyTelegramStarsReceipt("dummy", payment, onePage([paid, refunded])), false);
  assert.equal(await verifyTelegramStarsReceipt("dummy", payment, onePage([])), false);
});

test("Receipt verification scans recent pages but never assumes a missing receipt paid", async () => {
  const receipt = { kind: "payment", orderId: order, charge: "page2-charge", buyer: 42, stars: 799 };
  const filler = Array.from({ length: 100 }, (_, i) => ({
    id: `filler-${i}`, amount: 4, date: 1794940000 - i,
  }));
  const calls = [];
  const api = async (_token, _method, params) => {
    calls.push(params.offset);
    return { transactions: params.offset === 0 ? filler : [{
      id: receipt.charge, amount: receipt.stars, date: 1794930000,
      source: { type: "user", transaction_type: "invoice_payment", user: { id: receipt.buyer },
        invoice_payload: `cortex-stars:${order}` },
    }] };
  };
  assert.equal(await verifyTelegramStarsReceipt("dummy", receipt, api), true);
  assert.deepEqual(calls, [0, 100]);
  assert.equal(await verifyTelegramStarsReceipt("dummy", receipt,
    async () => ({ transactions: filler })), false);
});

test("A lost webhook can be recovered only by scanning an exact real purchase", async () => {
  const buyer = 144556677;
  const orderData = { id: order, buyer, stars: 799 };
  const purchase = { id: "verified-real-charge", date: 1794930000, amount: 799,
    source: { type: "user", transaction_type: "invoice_payment", user: { id: buyer },
      invoice_payload: `cortex-stars:${order}` } };
  const ledger = rows => async () => ({ transactions: rows });
  assert.equal(await findTelegramStarsPurchase("dummy", orderData, ledger([purchase])), purchase.id);
  assert.equal(await findTelegramStarsPurchase("dummy", { ...orderData, stars: 1 }, ledger([purchase])), null);
  assert.equal(await findTelegramStarsPurchase("dummy", { ...orderData, buyer: 3 }, ledger([purchase])), null);
  assert.equal(await findTelegramStarsPurchase("dummy", { ...orderData, id: "not-an-order" }, ledger([purchase])), null);
  assert.equal(await findTelegramStarsPurchase("dummy", orderData, ledger([{
    ...purchase, source: { ...purchase.source, invoice_payload: "cortex-stars:somebody-else" },
  }])), null);
  assert.equal(await findTelegramStarsPurchase("dummy", orderData, ledger([
    { id: purchase.id, date: purchase.date + 1, amount: -799, receiver: { type: "user" } }, purchase,
  ])), null);
});

test("Bot commands give no privileged data or payment access", () => {
  assert.match(plainBotCommand("/start"), /cortexapp.ru/);
  assert.match(plainBotCommand("/paysupport"), /support@cortexapp.ru/);
  assert.match(plainBotCommand("/paysupport@CortexSupportBot"), /support@cortexapp.ru/);
  assert.equal(plainBotCommand("/admin"), null);
  assert.equal(plainBotCommand("/start" + "x".repeat(256)), null);
});

test("Deployment remains gated and payment entitlement requires authenticated SQL settlement", () => {
  const route = readFileSync(new URL("../app/api/telegram/stars/checkout/route.ts", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("../app/api/telegram/webhook/route.ts", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/telegram-stars-webhook.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../supabase/migrations/20261118105407_cortex_telegram_stars.sql", import.meta.url), "utf8");
  assert.match(route, /CORTEX_TELEGRAM_STARS_ENABLED !== "true"/);
  assert.match(route, /getUser\(jwt\)/);
  assert.match(route, /provider_token: ""/);
  assert.match(route, /cortex_stars_new_order/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /processTelegramStarsUpdate/);
  assert.match(engine, /cortex_stars_confirm/);
  assert.match(engine, /cortex_stars_refund/);
  assert.match(engine, /cortex_stars_claim_bot_command/);
  assert.match(webhook, /verifyTelegramStarsReceipt/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /telegram_charge_id text unique/);
  assert.match(sql, /cortex_billing_payment\(p_id,'live',p_id,'confirmed'/);
  assert.match(sql, /left join public\.cortex_stars_orders s on s\.id = p\.id/);
  assert.match(sql, /'stars_collected'/);
  assert.match(sql, /grant execute on function public.cortex_stars_new_order\(text\) to authenticated/);
  assert.match(sql, /cortex_admin_stars_prices/);
  assert.match(sql, /p_charge text/);
  assert.match(sql, /cortex_stars_my_status/);
  assert.match(sql, /cortex_stars_reconcile_start/);
  assert.match(sql, /cortex_stars_admin_refund_prepare/);
  assert.match(sql, /cortex_telegram_command_updates/);
  assert.match(sql, /auth\.jwt\(\)->>'aal' <> 'aal2'/);
  assert.match(sql, /item\.status in \('paid','refunded'\) and item\.telegram_charge_id = p_charge/);
});

test("The server seeds exact Stars price parity but does not enable real sales", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261118105407_cortex_telegram_stars.sql", import.meta.url), "utf8");
  assert.match(sql, /\('start',199,false\),\('pro',399,false\),\('ultra',799,false\)/);
  assert.match(sql, /cortex_stars_public_prices/);
  assert.match(sql, /grant execute on function public\.cortex_stars_public_prices\(\) to anon,authenticated/);
  assert.match(sql, /grant execute on function public\.cortex_stars_my_status\(uuid\) to authenticated/);
});

test("Payment selection is a separate page and never passes client-selected amount or account ID", () => {
  const page = readFileSync(new URL("../app/payment/page.tsx", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../lib/public-catalog.ts", import.meta.url), "utf8");
  const methods = readFileSync(new URL("../components/PaymentMethods.tsx", import.meta.url), "utf8");
  const pricing = readFileSync(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
  const pricingButton = readFileSync(new URL("../components/PricingBuyButton.tsx", import.meta.url), "utf8");
  assert.match(page, /starsConfigured=/);
  assert.match(pricing, /<PricingBuyButton plan=\{plan\.code\}/);
  assert.match(pricingButton, /href=\{`\/payment\?plan=\$\{plan\}`\}/);
  assert.match(methods, /Robokassa/);
  assert.doesNotMatch(methods, /Platega/);
  assert.match(methods, /payment-option--unavailable/);
  assert.match(methods, /Банковская карта|банковской картой/);
  assert.doesNotMatch(methods, /selectMethod\("card"\)|Оплата Stars скоро/);
  assert.match(methods, /!starsAvailable \|\| processing/);
  assert.match(methods, /Оплата звёздами сейчас недоступна/);
  assert.match(methods, /Telegram Stars/);
  assert.match(methods, /JSON\.stringify\(\{ plan \}\)/);
  assert.doesNotMatch(methods, /JSON\.stringify\(\{.*(?:subject|amount|stars).*\}\)/);
  assert.match(methods, /useVerifiedCortexSession\(\)/);
  assert.match(methods, /target="_blank" rel="noopener noreferrer"/);
  assert.match(methods, /Не удалось создать счёт/);
  assert.match(page, /loadPublicStarsPrices/);
  assert.match(catalog, /cortex_stars_public_prices/);
  assert.match(methods, /starsPrice\.stars/);
  assert.match(methods, /cortex_stars_my_status/);
  assert.match(methods, /\/api\/telegram\/stars\/reconcile/);
  assert.match(methods, /Проверить статус оплаты/);
  const recovery = readFileSync(new URL("../app/api/telegram/stars/reconcile/route.ts", import.meta.url), "utf8");
  assert.match(recovery, /getUser\(auth\.slice\(7\)\)/);
  assert.match(recovery, /cortex_stars_reconcile_start/);
  assert.match(recovery, /findTelegramStarsPurchase/);
  assert.match(recovery, /cortex_stars_confirm/);
});

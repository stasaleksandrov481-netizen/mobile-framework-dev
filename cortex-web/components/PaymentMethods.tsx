"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useVerifiedCortexSession } from "@/lib/use-verified-cortex-session";
import { settleWithTimeout } from "@/lib/settle-with-timeout";

type Plan = "start" | "pro" | "ultra";
type Price = { code: Plan; price_kopecks: number };
type StarsPrice = { plan: Plan; stars: number; enabled: boolean };

const plans: { code: Plan; name: string; detail: string }[] = [
  { code: "start", name: "Start", detail: "Базовый платный тариф" },
  { code: "pro", name: "Pro", detail: "Больше возможностей ИИ" },
  { code: "ultra", name: "Ultra", detail: "Максимальные лимиты" },
];

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

function safeInvoice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://t.me" && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname.length > 1 ? url.href : null;
  } catch { return null; }
}

function paymentError(code: unknown): string {
  switch (code) {
    case "stars_disabled": return "Оплата звёздами ещё не включена. Попробуй позже.";
    case "login_required": return "Сначала войди в аккаунт и подтверди почту.";
    case "payment_pending":
    case "payment_processing":
    case "other_checkout_pending":
    case "payment_pending_other_provider": return "Сначала заверши предыдущую оплату или дождись её завершения.";
    case "rate_limited": return "Слишком много попыток. Попробуй через 15 минут.";
    case "funding_unavailable": return "Подписка временно недоступна. Попробуй позже.";
    default: return "Не удалось создать счёт. Деньги не списаны. Попробуй позже.";
  }
}

type PaymentProps = {
  initialPlan: Plan; prices: Price[]; starsPrices: StarsPrice[]; starsConfigured: boolean;
};

export function PaymentMethods({ initialPlan, ...props }: PaymentProps) {
  const { session } = useVerifiedCortexSession();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  return <PaymentScreen key={session?.key ?? "anonymous"} {...props} session={session} plan={plan} setPlan={setPlan} />;
}

function PaymentScreen({ plan, setPlan, prices, starsPrices, starsConfigured, session }: Omit<PaymentProps, "initialPlan"> & {
  session: ReturnType<typeof useVerifiedCortexSession>["session"];
  plan: Plan;
  setPlan: (plan: Plan) => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState<{ id: string; url: string; stars: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "refunded">("pending");
  const price = prices.find(item => item.code === plan);
  const starsPrice = starsPrices.find(item => item.plan === plan);
  const starsAvailable = starsConfigured && starsPrice?.enabled === true;

  function selectPlan(value: Plan) {
    if (processing || checking || value === plan) return;
    setPlan(value);
    setInvoice(null);
    setPaymentStatus("pending");
    setError("");
  }

  async function checkStarsPayment() {
    if (!invoice || checking || !session?.isCurrent()) return;
    setChecking(true);
    setError("");
    try {
      // RLS is closed; this RPC verifies auth.uid and live auth.sessions again.
      const { data, error: statusError } = await settleWithTimeout(session.client.rpc("cortex_stars_my_status", { p_id: invoice.id }), 8_000);
      if (statusError || !data || data.id !== invoice.id || data.stars !== invoice.stars) throw new Error();
      let state = data.status;
      if (state === "prechecked") {
        // The original webhook may have been delayed. This self-scoped,
        // rate-limited server check verifies Telegram's independent ledger.
        const token = await session.getToken();
        const check = await fetch("/api/telegram/stars/reconcile", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: invoice.id }), signal: AbortSignal.timeout(15_000),
        });
        if (check.ok) {
          const result: unknown = await check.json();
          if (!result || typeof result !== "object") throw new Error();
          state = (result as { status?: unknown }).status;
        } else if (check.status !== 202 && check.status !== 429) throw new Error();
      }
      if (!session.isCurrent()) return;
      setPaymentStatus(state === "paid" ? "paid" : state === "refunded" ? "refunded" : "pending");
    } catch { setError("Не удалось проверить статус. Повтори проверку через несколько секунд."); }
    finally { setChecking(false); }
  }

  async function createStarsInvoice() {
    if (processing || !starsAvailable) return;
    setProcessing(true);
    setError("");
    setInvoice(null);
    try {
      if (!session?.isCurrent()) { setError(paymentError("login_required")); return; }
      const token = await session.getToken();
      const response = await fetch("/api/telegram/stars/checkout", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }), signal: AbortSignal.timeout(14_000),
      });
      const result: unknown = await response.json();
      if (!session.isCurrent()) return;
      if (!result || typeof result !== "object") throw new Error();
      const data = result as { error?: unknown; id?: unknown; stars?: unknown; invoice_url?: unknown };
      const link = response.ok ? safeInvoice(data.invoice_url) : null;
      if (link && typeof data.id === "string" && /^[a-f0-9-]{36}$/i.test(data.id) &&
          Number.isInteger(data.stars) && Number(data.stars) > 0 && Number(data.stars) <= 10000) {
        setInvoice({ id: data.id, url: link, stars: Number(data.stars) });
        setPaymentStatus("pending");
      } else {
        setError(paymentError(data.error));
      }
    } catch { setError("Сервис оплаты временно недоступен. Попробуй позже."); }
    finally { setProcessing(false); }
  }

  return <main className="payment-shell">
    <div className="payment-container">
      <header className="payment-header">
        <Link href="/" className="payment-brand"><Image src="/cortex-mark.svg" alt="" width={34} height={34} />CORTEX</Link>
        <Link href="/pricing" className="payment-back">Вернуться к тарифам</Link>
      </header>
      <div className="payment-heading">
        <h1>Оплата подписки</h1>
        <p>Один месяц доступа. Без автоматических списаний.</p>
      </div>

      <div className="payment-layout">
        <section className="payment-panel" aria-labelledby="payment-plan-title">
          <div className="payment-section-title"><h2 id="payment-plan-title">Тариф</h2></div>
          <div className="payment-options">
            {plans.map(item => <button key={item.code} type="button" className={`payment-option ${plan === item.code ? "is-active" : ""}`}
              onClick={() => selectPlan(item.code)} aria-pressed={plan === item.code} disabled={processing || checking}>
              <span className="payment-radio" aria-hidden="true" />
              <span className="payment-option-body"><strong>{item.name}</strong><small>{item.detail}</small></span>
              <span className="payment-plan-price">{prices.length ? money.format((prices.find(p => p.code === item.code)?.price_kopecks || 0) / 100) : "—"}</span>
            </button>)}
          </div>
          <p className="payment-hint">{price ? "Цена в рублях относится к оплате картой. Стоимость в Stars указана ниже." : "Точные цены временно не загрузились."}</p>
        </section>

        <section className="payment-panel" aria-labelledby="payment-method-title">
          <div className="payment-section-title"><h2 id="payment-method-title">Способ оплаты</h2></div>
          <div className="payment-options">
            <div className="payment-option payment-option--unavailable" aria-label="Robokassa пока не подключена">
              <span className="payment-radio" aria-hidden="true" />
              <span className="payment-option-body"><strong>Robokassa</strong><small>Оплата банковской картой</small></span>
              <span className="payment-method-tag">Не подключена</span>
            </div>
            <div className={`payment-option ${starsAvailable ? "is-active" : "payment-option--unavailable"}`}
              aria-label={starsAvailable ? "Выбрана оплата Telegram Stars" : "Оплата Telegram Stars пока не активирована"}>
              <span className="payment-radio" aria-hidden="true" />
              <span className="payment-option-body"><strong>Telegram Stars</strong><small>Оплата звёздами в Telegram</small></span>
              <span className="payment-method-tag">{starsPrice ? `${starsPrice.stars} XTR` : "Недоступно"}</span>
            </div>
          </div>
          <div className="payment-action-area">
            {error && <p className="payment-error" role="alert">{error}</p>}
            {invoice ? <>
                <p className="payment-success" role="status">{paymentStatus === "paid" ? "Платёж подтверждён, подписка активирована." :
                  paymentStatus === "refunded" ? "Платёж возвращён, доступ отозван." :
                    `Счёт на ${invoice.stars} Stars создан. Подтверди платёж в Telegram.`}</p>
                {paymentStatus === "pending" && <a className="payment-submit" href={invoice.url} target="_blank" rel="noopener noreferrer">Открыть счёт в Telegram <span aria-hidden="true">↗</span></a>}
                <button className="payment-check" type="button" disabled={checking} onClick={() => void checkStarsPayment()}>
                  {checking ? "Проверяем…" : "Проверить статус оплаты"}
                </button>
              </> : <button className="payment-submit" type="button" disabled={!starsAvailable || processing}
                onClick={() => void createStarsInvoice()}>
                {processing ? "Создаём счёт…" : starsAvailable ? `Оплатить ${starsPrice?.stars} Stars` : "Оплата временно недоступна"}
                {!processing && <span aria-hidden="true">↗</span>}
              </button>}
            {!starsAvailable && <p className="payment-notice" role="status">Оплата звёздами сейчас недоступна.</p>}
            {starsPrice && <p className="payment-disclaimer">Стоимость покупки звёзд в Telegram зависит от региона и способа пополнения.</p>}
            <p className="payment-disclaimer">Подписка активируется только после подтверждения платежа. <Link href="/offer">Условия и возвраты</Link>.</p>
          </div>
        </section>
      </div>
    </div>
  </main>;
}

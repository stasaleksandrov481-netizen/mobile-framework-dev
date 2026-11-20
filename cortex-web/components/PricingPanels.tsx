"use client";

import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Image from "next/image";
import UiIcon from "@/components/UiIcon";

const packs = [
  { amount: 10_000, name: "Малый" },
  { amount: 50_000, name: "Средний" },
  { amount: 100_000, name: "Большой" },
  { amount: 500_000, name: "Максимальный" },
] as const;
const format = new Intl.NumberFormat("ru-RU");

export default function PricingPanels({ plans }: { plans: ReactNode }) {
  const [tab, setTab] = useState<"plans" | "tokens">("plans");
  const [amount, setAmount] = useState("50000");
  const tokens = Number(amount);
  const amountValid = amount.length > 0 && Number.isSafeInteger(tokens) && tokens >= 1 && tokens <= 10_000_000;

  function tabsKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "plans" ? "tokens" : "plans";
    setTab(next);
    document.getElementById(next === "plans" ? "cortex-plan-tab" : "cortex-token-tab")?.focus();
  }

  return <div className="pricing-content">
    <div className="pricing-switch" role="tablist" aria-label="Варианты оплаты CORTEX" onKeyDown={tabsKeyboard}>
      <span className={`pricing-switch-highlight${tab === "tokens" ? " pricing-switch-highlight--right" : ""}`} aria-hidden="true" />
      <button id="cortex-plan-tab" type="button" role="tab" aria-controls="cortex-plan-panel"
        aria-selected={tab === "plans"} tabIndex={tab === "plans" ? 0 : -1} onClick={() => setTab("plans")}>Тарифы</button>
      <button id="cortex-token-tab" type="button" role="tab" aria-controls="cortex-token-panel"
        aria-selected={tab === "tokens"} tabIndex={tab === "tokens" ? 0 : -1} onClick={() => setTab("tokens")}>Токены</button>
    </div>

    <div id="cortex-plan-panel" role="tabpanel" aria-labelledby="cortex-plan-tab"
      className={`pricing-panel${tab === "plans" ? " pricing-panel--active" : ""}`}
      hidden={tab !== "plans"} tabIndex={0}>
      {plans}
    </div>

    <div id="cortex-token-panel" role="tabpanel" aria-labelledby="cortex-token-tab"
      className={`pricing-panel${tab === "tokens" ? " pricing-panel--active" : ""}`}
      hidden={tab !== "tokens"} tabIndex={0}>
      <div className="token-shop">
        <div className="token-shop-heading">
          <span className="token-shop-eyebrow">РАЗОВОЕ ПОПОЛНЕНИЕ</span>
          <h2>Пакеты токенов</h2>
          <p>Выберите готовый пакет или укажите своё количество.</p>
        </div>

        <div className="token-pack-grid" role="group" aria-label="Готовые пакеты токенов">
          {packs.map(pack => <button
            key={pack.amount}
            className={`token-pack${tokens === pack.amount && amountValid ? " token-pack--selected" : ""}`}
            type="button"
            aria-pressed={tokens === pack.amount && amountValid}
            onClick={() => setAmount(String(pack.amount))}>
            <span className="token-pack-top">
              <Image src="/cortex-mark.svg" alt="" width={27} height={27} />
              <span>{pack.name}</span>
            </span>
            <span className="token-pack-number">{format.format(pack.amount)}</span>
            <span className="token-pack-unit">токенов</span>
            <span className="token-pack-bottom">
              {tokens === pack.amount && amountValid ? "Выбрано" : "Выбрать пакет"}
              <UiIcon name={tokens === pack.amount && amountValid ? "check" : "arrow-right"} size={16} />
            </span>
          </button>)}
        </div>

        <div className="token-shop-lower">
          <div className="token-custom">
            <div className="token-custom-heading">
              <Image src="/cortex-mark.svg" alt="" width={28} height={28} />
              <div>
                <label htmlFor="token-quantity">Своё количество</label>
                <p>От 1 до 10 000 000 токенов</p>
              </div>
            </div>
            <div className="token-shop-input-wrap">
              <input id="token-quantity" type="text" inputMode="numeric" autoComplete="off"
                value={amount} maxLength={8} onChange={event => setAmount(event.target.value.replace(/\D/g, "").slice(0, 8))}
                aria-invalid={!amountValid} aria-describedby="token-range" />
              <span>токенов</span>
            </div>
            <p id="token-range" className={amountValid ? "token-range" : "token-range token-range--error"}>
              {amountValid ? "Можно указать любое целое количество." : "Введите число от 1 до 10 000 000."}
            </p>
          </div>
          <div className="token-shop-checkout">
            <div className="token-shop-total"><span>Выбрано</span><strong>{amountValid ? `${format.format(tokens)} токенов` : "Укажите количество"}</strong></div>
            <div className="token-shop-total"><span>К оплате</span><strong>Цена уточняется</strong></div>
            <button className="pricing-buy" type="button" disabled aria-describedby="token-payment-note">
              Покупка пока недоступна <UiIcon name="arrow-right" size={17} />
            </button>
            <p id="token-payment-note">Начисление после оплаты ещё не подключено. Деньги не списываются.</p>
          </div>
        </div>
      </div>
    </div>
  </div>;
}

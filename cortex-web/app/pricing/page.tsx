import type { Metadata } from "next";
import Link from "next/link";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";

export const metadata: Metadata = {
  title: "Тарифы и цены — CORTEX",
  description: "Стоимость подписок CORTEX и дневные лимиты облачного ИИ.",
};

const planInfo = {
  guest: ["Guest", "Облачный ИИ без регистрации"],
  free: ["Free", "Облачный ИИ с аккаунтом CORTEX"],
  start: ["Start", "Больше контекста и доступ к продвинутым моделям"],
  pro: ["Pro", "Расширенный анализ экрана и многошаговые задачи"],
  ultra: ["Ultra", "Максимальный контекст и максимальная квота продвинутых моделей"],
};

type Plan = {
  code: keyof typeof planInfo;
  price_kopecks: number;
  daily_tokens: number;
  advanced_tokens: number;
};

const numbers = new Intl.NumberFormat("ru-RU");
const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

async function loadPlans(): Promise<Plan[] | null> {
  try {
    const url = new URL("/rest/v1/cortex_plans", cortexSupabaseUrl);
    url.searchParams.set("select", "code,price_kopecks,daily_tokens,advanced_tokens");
    url.searchParams.set("order", "rank");
    const response = await fetch(url, {
      headers: { apikey: cortexPublishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== Object.keys(planInfo).length) return null;
    if (!rows.every(row => row && Object.hasOwn(planInfo, row.code) &&
        Number.isSafeInteger(row.price_kopecks) && Number.isSafeInteger(row.daily_tokens) &&
        Number.isSafeInteger(row.advanced_tokens))) return null;
    return rows;
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const plans = await loadPlans();
  return (
    <div className="shell">
      <main className="simple-page legal-page">
        <Link className="legal-back" href="/">← На главную</Link>
        <h1>Тарифы CORTEX</h1>
        <p className="legal-lead">Подписка увеличивает дневной лимит облачного ИИ. Локальные команды, сценарии, напоминания и настройки островка доступны бесплатно и без лимита токенов.</p>
        {plans ? (
          <dl className="pricing-list">
            {plans.map(plan => (
              <div className="pricing-row" key={plan.code}>
                <dt><strong>{planInfo[plan.code][0]}</strong><span>{planInfo[plan.code][1]}</span></dt>
                <dd>
                  <strong>{plan.price_kopecks ? `${rubles.format(plan.price_kopecks / 100)} / месяц` : "Бесплатно"}</strong>
                  <span>{numbers.format(plan.daily_tokens)} токенов в день{plan.advanced_tokens > 0 && `, из них ${numbers.format(plan.advanced_tokens)} для продвинутых моделей`}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : <p role="status">Цены и лимиты временно не загрузились. Обновите страницу через несколько минут.</p>}
        <p>Лимиты обновляются ежедневно в 03:00 по московскому времени. Продление подписки оформляется вручную на следующий месяц. Оплата на этапе согласования с Platega пока закрыта.</p>
        <nav className="legal-links" aria-label="Документы CORTEX">
          <Link href="/questions">Частые вопросы</Link>
          <Link href="/terms">Пользовательское соглашение</Link>
          <Link href="/privacy">Политика конфиденциальности</Link>
          <Link href="/support">Поддержка</Link>
        </nav>
      </main>
    </div>
  );
}

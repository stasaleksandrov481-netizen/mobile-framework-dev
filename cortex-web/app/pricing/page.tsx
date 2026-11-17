import type { Metadata } from "next";
import Link from "next/link";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";

export const metadata: Metadata = {
  title: "Тарифы и цены — CORTEX",
  description: "Что входит в подписки CORTEX, сколько они стоят и как получить доступ к закрытому каналу для подписчиков.",
};

export const revalidate = 300;

const planInfo = {
  guest: { name: "Guest", use: "Попробовать облачный ИИ без аккаунта." },
  free: { name: "Free", use: "Пользоваться облачным ИИ каждый день с аккаунтом CORTEX." },
  start: { name: "Start", use: "Подготовить сценарий, разобрать инструкцию или решить сложный вопрос в одном диалоге." },
  pro: { name: "Pro", use: "Вести несколько рабочих диалогов, сравнивать материалы и пошагово уточнять результат." },
  ultra: { name: "Ultra", use: "Разбирать длинные материалы и продолжать разговор по проекту с большим объёмом предыдущего контекста." },
} as const;

type Plan = {
  code: keyof typeof planInfo;
  price_kopecks: number;
  daily_tokens: number;
  advanced_tokens: number;
  context_chars: number;
};

const freeCodes = ["guest", "free"] as const;
const paidCodes = ["start", "pro", "ultra"] as const;
const numbers = new Intl.NumberFormat("ru-RU");
const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

async function loadPlans(): Promise<Map<Plan["code"], Plan> | null> {
  try {
    const url = new URL("/rest/v1/cortex_plans", cortexSupabaseUrl);
    url.searchParams.set("select", "code,price_kopecks,daily_tokens,advanced_tokens,context_chars");
    const response = await fetch(url, {
      headers: { apikey: cortexPublishableKey },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== Object.keys(planInfo).length) return null;
    if (!rows.every(row => row && Object.hasOwn(planInfo, row.code) &&
        [row.price_kopecks, row.daily_tokens, row.advanced_tokens, row.context_chars].every(
          value => Number.isSafeInteger(value) && value >= 0
        ) && (row.code === "guest" || row.code === "free" ? row.price_kopecks === 0 : row.price_kopecks > 0))) return null;
    const plans = new Map<Plan["code"], Plan>(rows.map(row => [row.code, row]));
    return plans.size === Object.keys(planInfo).length ? plans : null;
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const plans = await loadPlans();
  return (
    <div className="shell">
      <main className="simple-page legal-page pricing-page">
        <Link className="legal-back" href="/">← На главную</Link>
        <h1>Тарифы CORTEX</h1>
        <p className="legal-lead">Локальные команды, сценарии, напоминания и настройки островка доступны бесплатно. Подписка даёт доступ к продвинутым моделям, увеличивает объём контекста и дневной лимит облачного ИИ.</p>

        <section aria-labelledby="paid-plans">
          <h2 id="paid-plans">Платные тарифы</h2>
          {plans ? (
            <div className="pricing-cards">
              {paidCodes.map(code => {
                const plan = plans.get(code)!;
                return (
                  <article className="pricing-card" key={code}>
                    <h3>{planInfo[code].name}</h3>
                    <p className="pricing-price"><strong>{rubles.format(plan.price_kopecks / 100)}</strong> / месяц</p>
                    <p className="pricing-use">{planInfo[code].use}</p>
                    <ul>
                      <li>{numbers.format(plan.daily_tokens)} токенов в день</li>
                      {plan.advanced_tokens > 0 ? <li>{numbers.format(plan.advanced_tokens)} токенов в день для продвинутых моделей</li> : null}
                      <li>До {numbers.format(plan.context_chars)} символов контекста в запросе</li>
                    </ul>
                  </article>
                );
              })}
            </div>
          ) : <p role="status">Цены и лимиты временно не загрузились. Обновите страницу через несколько минут.</p>}
        </section>

        <aside className="legal-notice pricing-community" aria-labelledby="pricing-community">
          <strong id="pricing-community">Закрытый Telegram для подписчиков</strong>
          <p>Готовим канал с обновлениями, обсуждением идей и прямой связью с командой. После запуска рассылки покупатели Start, Pro и Ultra будут получать одноразовое приглашение на почту аккаунта.</p>
          <Link href="/support#subscriber-telegram">Подробнее о приглашениях</Link>
        </aside>

        <section aria-labelledby="free-plans">
          <h2 id="free-plans">Бесплатный доступ</h2>
          <dl className="pricing-list">
            {freeCodes.map(code => (
              <div className="pricing-row" key={code}>
                <dt><strong>{planInfo[code].name}</strong><span>{planInfo[code].use}</span></dt>
                <dd>
                  <strong>Бесплатно</strong>
                  {plans ? <span>{numbers.format(plans.get(code)!.daily_tokens)} токенов в день</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <p>Лимиты обновляются в 03:00 по Москве. Оплата и продление оформляются из аккаунта на экране «Подписка» в приложении. Каждый месяц оплачивается отдельно. Списание автоматически не повторяется.</p>
        <nav className="legal-links" aria-label="Документы CORTEX">
          <Link href="/questions">Частые вопросы</Link>
          <Link href="/terms">Пользовательское соглашение</Link>
          <Link href="/offer">Публичная оферта и возвраты</Link>
          <Link href="/privacy">Политика конфиденциальности</Link>
          <Link href="/support">Поддержка</Link>
        </nav>
      </main>
    </div>
  );
}

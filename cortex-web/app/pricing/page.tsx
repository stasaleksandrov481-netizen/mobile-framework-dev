import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicPlans } from "@/lib/public-catalog";

export const metadata: Metadata = {
  title: "Тарифы и цены — CORTEX",
  description: "Стоимость подписок CORTEX и дневные лимиты облачного ИИ.",
};

// Reuse the public price catalog via ISR instead of querying Supabase on every visit.
export const revalidate = 300;

const planInfo = {
  guest: ["Guest", "Облачный ИИ без регистрации"],
  free: ["Free", "Облачный ИИ с аккаунтом CORTEX"],
  start: ["Start", "Больше контекста и доступ к продвинутым моделям"],
  pro: ["Pro", "Расширенный анализ экрана и многошаговые задачи"],
  ultra: ["Ultra", "Максимальный контекст и максимальная квота продвинутых моделей"],
};

const numbers = new Intl.NumberFormat("ru-RU");
const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export default async function PricingPage() {
  const plans = await loadPublicPlans();
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
                  {plan.price_kopecks > 0 && <Link className="pricing-pay-link" href={`/payment?plan=${plan.code}`}>Выбрать оплату</Link>}
                </dd>
              </div>
            ))}
          </dl>
        ) : <p role="status">Цены и лимиты временно не загрузились. Обновите страницу через несколько минут.</p>}
        <p>Лимиты обновляются ежедневно в 03:00 по московскому времени. Продление подписки оформляется отдельным платежом, без автоматического списания. На странице оплаты можно проверить доступность Telegram Stars; Platega появится после подключения.</p>
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

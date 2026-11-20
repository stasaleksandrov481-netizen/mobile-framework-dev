import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicPlans } from "@/lib/public-catalog";
import DocGlow from "@/components/DocGlow";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import PricingBuyButton from "@/components/PricingBuyButton";
import PricingPanels from "@/components/PricingPanels";
import "../restored-pages.css";

export const metadata: Metadata = {
  title: "Тарифы и цены — CORTEX",
  description: "Стоимость подписок CORTEX и дневные лимиты облачного ИИ.",
};

// Reuse the public price catalog via ISR instead of querying Supabase on every visit.
export const revalidate = 300;

// Guest (AI without an account) is not offered on the site: every plan
// starts from a CORTEX account. The catalog row stays for server limits.
const planInfo = {
  free: ["Free", "С аккаунтом CORTEX"],
  start: ["Start", "Продвинутые модели"],
  pro: ["Pro", "Анализ экрана и длинные задачи"],
  ultra: ["Ultra", "Максимум контекста"],
} as const;

const numbers = new Intl.NumberFormat("ru-RU");
const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export default async function PricingPage() {
  const plans = (await loadPublicPlans())?.filter(plan => plan.code !== "guest");
  return (
    <div className="page">
      <DocGlow />
      <SiteHeader />
      <main className="simple-page legal-page pricing-page">
        <Link className="legal-back" href="/">← На главную</Link>
        <p className="legal-eyebrow">Тарифы</p>
        <h1>Платите только за облачный ИИ</h1>
        <p className="legal-lead">Локальные команды бесплатны всегда. Подписка увеличивает дневной лимит облачного ИИ.</p>
        <PricingPanels plans={plans ? (
          <div className="plan-grid">
            {plans.map(plan => {
              const code = plan.code as keyof typeof planInfo;
              return (
                <section className={`plan-card${plan.code === "pro" ? " plan-card--featured" : ""}`} key={plan.code} aria-labelledby={`plan-${plan.code}`}>
                  <header className="plan-head">
                    <h2 id={`plan-${plan.code}`}>{planInfo[code][0]}</h2>
                    <p className="plan-desc">{planInfo[code][1]}</p>
                  </header>
                  <p className="plan-price">
                    <strong>{plan.price_kopecks ? rubles.format(plan.price_kopecks / 100) : "0 ₽"}</strong>
                    {plan.price_kopecks > 0 && <span>/ мес</span>}
                  </p>
                  <div className="plan-limit">
                    <strong>{numbers.format(plan.daily_tokens)}</strong>
                    <span>токенов в день</span>
                    {plan.advanced_tokens > 0 && <small>{numbers.format(plan.advanced_tokens)} на продвинутые модели</small>}
                  </div>
                  {plan.price_kopecks > 0
                    ? <PricingBuyButton plan={plan.code} />
                    : <span className="plan-included">Включено</span>}
                </section>
              );
            })}
          </div>
        ) : <p role="status">Цены и лимиты временно не загрузились. Обновите страницу через несколько минут.</p>} />
        <p className="plan-note">Лимиты обновляются в 03:00 по Москве. Без автосписаний: продление оформляется отдельным платежом. Оплата через Telegram Stars, картой через Robokassa после подключения.</p>
        <nav className="legal-links" aria-label="Документы CORTEX">
          <Link href="/questions">Частые вопросы</Link>
          <Link href="/terms">Пользовательское соглашение</Link>
          <Link href="/offer">Публичная оферта и возвраты</Link>
          <Link href="/privacy">Политика конфиденциальности</Link>
          <Link href="/support">Поддержка</Link>
        </nav>
      </main>
    <SiteFooter />
    </div>
  );
}

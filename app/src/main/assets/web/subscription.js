"use strict";

const CortexSubscription = (() => {
  const names = { guest: "Guest", free: "Free", start: "Start", pro: "Pro", ultra: "Ultra" };
  const descriptions = { guest: "ИИ без аккаунта", free: "Для повседневных вопросов",
    start: "Расширенный контекст и сложные запросы", pro: "Продвинутые модели, анализ экрана и многошаговые задачи",
    ultra: "Максимальный контекст и приоритет облачных запросов" };
  const states = { pending: "Ожидает оплаты", confirmed: "Оплачен", canceled: "Отменён", refunded: "Возвращён" };
  const defaults = [
    { code: "guest", price_kopecks: 0, daily_tokens: 16000, advanced_tokens: 0 },
    { code: "free", price_kopecks: 0, daily_tokens: 35000, advanced_tokens: 0 },
    { code: "start", price_kopecks: 19900, daily_tokens: 40000, advanced_tokens: 4000 },
    { code: "pro", price_kopecks: 39900, daily_tokens: 100000, advanced_tokens: 20000 },
    { code: "ultra", price_kopecks: 79900, daily_tokens: 200000, advanced_tokens: 60000 }
  ];
  const number = new Intl.NumberFormat("ru-RU");
  const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2, minimumFractionDigits: 0 });
  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (!Number.isFinite(+parsed)) return "—";
    return parsed.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  }
  const count = value => Number.isSafeInteger(value) && value >= 0;
  function balance(quota, esc) {
    const known = quota?.unit === "tokens" && count(quota.limit) && count(quota.remaining);
    if (quota?.unit === "tokens" && quota.unlimited === true) {
      return '<section class="cortex-quota-card glass-card"><h2>Лимит ИИ</h2><strong>Безлимит</strong></section>';
    }
    if (!known) return '<section class="cortex-quota-card glass-card"><h2>Лимит ИИ</h2><p>Остаток пока недоступен</p></section>';
    const reset = date(quota.reset_at);
    const remaining = Math.min(quota.remaining, quota.limit);
    return `<section class="cortex-quota-card glass-card"><h2>Лимит ИИ</h2>
      <p class="quota-amount"><strong>${esc(number.format(remaining))}</strong> из ${esc(number.format(quota.limit))} токенов</p>
      <progress aria-label="Остаток токенов ИИ" value="${remaining}" max="${Math.max(1, quota.limit)}"></progress>
      ${reset === "—" ? "" : `<p>Обновление · ${esc(reset)} МСК</p>`}
    </section>`;
  }

  function page(ctx, ui) {
    const { detail, esc, button } = ui;
    const subscription = ctx.connection.subscription;
    const quota = ctx.connection.quota || subscription?.quota;
    const current = quota?.plan || (Cortex.state.account ? "free" : "guest");
    const plans = Array.isArray(subscription?.plans) ? subscription.plans : defaults;
    const paid = ["start", "pro", "ultra"].includes(current);
    const canBuy = subscription?.checkout === true;
    const loadError = ctx.connection.subscriptionError;
    const hero = `${balance(quota, esc)}<section class="sub-hero"><header><span>Текущий тариф</span><strong>${esc(names[current])}</strong></header>
      ${paid && quota?.ends_at ? `<p class="sub-note">Подписка до ${esc(date(quota.ends_at))} МСК</p>` : ""}
      ${paid ? `<p class="sub-note">Продление вручную</p>` : ""}</section>`;
    const catalogue = plans.map(plan => {
      if (!Object.hasOwn(names, plan.code)) return "";
      const selected = plan.code === current;
      const action = plan.code === "free" && current === "guest" ? button("Войти для Free", "", "go", "account", "outline") :
        canBuy && plan.price_kopecks > 0 ? button(selected ? "Продлить" : paid ? "Сменить на " + names[plan.code] : "Выбрать " + names[plan.code], "",
          selected ? "subscription-renew" : "subscription-checkout", plan.code, "outline") : "";
      return `<article class="sub-plan${selected ? " sub-current" : ""}"><header><h3>${names[plan.code]}</h3>
        <span>${plan.price_kopecks ? esc(money.format(plan.price_kopecks / 100)) + " / мес." : "Бесплатно"}</span></header>
        <p>${descriptions[plan.code]}</p>
        ${count(plan.daily_tokens) ? `<strong>${esc(number.format(plan.daily_tokens))} токенов в день</strong>` : ""}
        ${count(plan.advanced_tokens) && plan.advanced_tokens > 0 ?
          `<small>Из них ${esc(number.format(plan.advanced_tokens))} для продвинутых моделей</small>` : ""}
        ${action}</article>`;
    }).join("");
    const payments = Array.isArray(subscription?.payments) ? subscription.payments : [];
    const history = payments.length ? `<ul class="sub-payments">${payments.map(payment =>
      `<li><div><strong>${esc(names[payment.plan])} · ${esc(money.format(payment.amount / 100))}</strong>
       <small>${esc(date(payment.created_at))} · ${esc(states[payment.state])}</small></div>
       ${payment.state === "pending" ? button("Проверить", "", "subscription-status", payment.id, "quiet") : ""}</li>`).join("")}</ul>` : "<p>Платежей пока нет.</p>";
    return detail("Подписка", "", `<div class="sub-page">${hero}
      ${loadError ? `<p class="sub-status" role="status">${esc(loadError)} ${button("Обновить", "", "subscription-refresh", "", "quiet")}</p>` : ""}
      <section class="sub-section"><h2>Тарифы</h2>${!canBuy ? `<p class="sub-status">${current === "guest" ? "Для покупки понадобится аккаунт." : "Оплата подписок пока закрыта."}</p>` : ""}
      <div class="sub-plans">${catalogue}</div></section>
      <p class="sub-note">Локальные команды, сценарии, напоминания и настройки островка бесплатны и безлимитны.</p>
      <section class="sub-section"><h2>История платежей</h2>${history}</section>
      <nav class="sub-legal" aria-label="Документы и помощь">
        ${button("Политика конфиденциальности", "", "subscription-info", "privacy", "quiet")}
        ${button("Пользовательское соглашение", "", "subscription-info", "terms", "quiet")}
        ${button("Поддержка", "", "subscription-info", "support", "quiet")}
      </nav></div>`);
  }
  return { page, balance };
})();

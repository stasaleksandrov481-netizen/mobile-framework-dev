"use strict";

const CortexSubscription = (() => {
  const names = { guest: "Guest", free: "Free", start: "Start", pro: "Pro", ultra: "Ultra" };
  const descriptions = { guest: "ИИ без аккаунта", free: "Для повседневных вопросов",
    start: "Подготовить сценарий, разобрать инструкцию или решить сложный вопрос в одном диалоге.",
    pro: "Вести несколько рабочих диалогов, сравнивать материалы и пошагово уточнять результат.",
    ultra: "Разбирать длинные материалы и продолжать работу над проектом с большим объёмом контекста." };
  const states = { pending: "Ожидает оплаты", confirmed: "Оплачен", canceled: "Отменён", refunded: "Возвращён" };
  const paidCodes = ["start", "pro", "ultra"];
  const orderId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const number = new Intl.NumberFormat("ru-RU");
  const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2, minimumFractionDigits: 0 });
  function formatAmount(kopecks) {
    return money.format(kopecks / 100);
  }
  function checkoutPlan(subscription, code) {
    if (subscription?.checkout !== true || !paidCodes.includes(code) || !Array.isArray(subscription?.plans)) return null;
    const plan = subscription.plans.find(plan => plan?.code === code);
    return Number.isSafeInteger(plan?.price_kopecks) && plan.price_kopecks > 0
      ? { code, name: names[code], amount: plan.price_kopecks } : null;
  }
  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (!Number.isFinite(+parsed)) return "—";
    return parsed.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  }
  function page(ctx, ui) {
    const { detail, esc, button } = ui;
    const subscription = ctx.connection.subscription;
    const quota = ctx.connection.quota || subscription?.quota;
    const current = Object.hasOwn(names, quota?.plan) ? quota.plan : (Cortex.state.account ? "free" : "guest");
    const plans = Array.isArray(subscription?.plans) ? subscription.plans : [];
    const paid = paidCodes.includes(current);
    const canBuy = subscription?.checkout === true;
    const loadError = ctx.connection.subscriptionError;
    const hero = `<section class="sub-hero"><header><span>Текущий тариф</span><strong>${esc(names[current])}</strong></header>
      ${paid && quota?.ends_at ? `<p class="sub-note">Подписка до ${esc(date(quota.ends_at))} МСК</p>` : ""}
      ${paid ? `<p class="sub-note">Продление вручную</p>` : ""}</section>`;
    const catalogue = plans.map(plan => {
      if (!plan || !Object.hasOwn(names, plan.code) || !Number.isSafeInteger(plan.price_kopecks) || plan.price_kopecks < 0) return "";
      const selected = plan.code === current;
      const action = plan.code === "free" && current === "guest" ? button("Войти для Free", "", "go", "account", "outline") :
        checkoutPlan(subscription, plan.code) ? button(selected ? "Продлить" : paid ? "Сменить на " + names[plan.code] : "Выбрать " + names[plan.code], "",
          selected ? "subscription-renew" : "subscription-checkout", plan.code, "outline") : "";
      return `<article class="sub-plan${selected ? " sub-current" : ""}"><header><h3>${names[plan.code]}</h3>
        <span>${plan.price_kopecks ? esc(formatAmount(plan.price_kopecks)) + " / мес." : "Бесплатно"}</span></header>
        <p>${descriptions[plan.code]}</p>
        <ul class="sub-plan-details">
          ${Number.isSafeInteger(plan.daily_tokens) && plan.daily_tokens > 0 ? `<li>${number.format(plan.daily_tokens)} токенов в день</li>` : ""}
          ${Number.isSafeInteger(plan.advanced_tokens) && plan.advanced_tokens > 0 ? `<li>${number.format(plan.advanced_tokens)} токенов в день для продвинутых моделей</li>` : ""}
          ${Number.isSafeInteger(plan.context_chars) && plan.context_chars > 0 ? `<li>До ${number.format(plan.context_chars)} символов контекста в запросе</li>` : ""}
        </ul>${action}</article>`;
    }).join("");
    const payments = Array.isArray(subscription?.payments) ? subscription.payments : [];
    const history = payments.length ? `<ul class="sub-payments">${payments.map(payment =>
      `<li><div><strong>${esc(names[payment.plan])} · ${esc(money.format(payment.amount / 100))}</strong>
       <small>${esc(date(payment.created_at))} · ${esc(states[payment.state])}</small></div>
       <div class="sub-payment-actions">
         ${orderId.test(payment.id || "") ? button("Копировать номер", "", "subscription-copy-order", payment.id, "quiet") : ""}
         ${payment.state === "pending" ? button("Проверить", "", "subscription-status", payment.id, "quiet") : ""}
       </div></li>`).join("")}</ul>` : "<p>Платежей пока нет.</p>";
    return detail("Подписка", "", `<div class="sub-page">${hero}
      ${loadError ? `<p class="sub-status" role="status">${esc(loadError)} ${button("Обновить", "", "subscription-refresh", "", "quiet")}</p>` : ""}
      <section class="sub-section"><h2>Тарифы</h2>${!canBuy ? `<p class="sub-status">${current === "guest" ? "Для покупки понадобится аккаунт." : "Оплата подписок пока закрыта."}</p>` : ""}
      ${catalogue ? `<div class="sub-plans">${catalogue}</div>` : "<p>Актуальные цены пока не загрузились.</p>"}</section>
      <section class="sub-community">
        <h2>Закрытый Telegram для подписчиков</h2>
        <p>Готовится для Start, Pro и Ultra. После запуска рассылки одноразовое приглашение будет приходить на почту аккаунта.</p>
        ${button("Подробнее о приглашениях", "", "subscription-info", "support#subscriber-telegram", "quiet")}
      </section>
      <p class="sub-note">Локальные команды, сценарии, напоминания и настройки островка бесплатны и безлимитны.</p>
      <section class="sub-section"><h2>История платежей</h2>${history}</section>
      <nav class="sub-legal" aria-label="Документы и помощь">
        ${button("Политика конфиденциальности", "", "subscription-info", "privacy", "quiet")}
        ${button("Пользовательское соглашение", "", "subscription-info", "terms", "quiet")}
        ${button("Публичная оферта и возвраты", "", "subscription-info", "offer", "quiet")}
        ${button("Тарифы на сайте", "", "subscription-info", "pricing", "quiet")}
        ${button("Поддержка", "", "subscription-info", "support", "quiet")}
      </nav></div>`);
  }
  return { page, checkoutPlan, formatAmount, validOrderId: value => orderId.test(value || "") };
})();

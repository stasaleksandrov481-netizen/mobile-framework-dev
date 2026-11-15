"use strict";

const CortexSubscription = (() => {
  const names = { guest: "Guest", free: "Free", start: "Start", pro: "Pro", ultra: "Ultra" };
  const descriptions = { guest: "ИИ без аккаунта", free: "Для повседневных вопросов",
    start: "Расширенный контекст и сложные запросы", pro: "Продвинутые модели, анализ экрана и многошаговые задачи",
    ultra: "Максимальный контекст и приоритет облачных запросов" };
  const states = { pending: "Ожидает оплаты", confirmed: "Оплачен", canceled: "Отменён", refunded: "Возвращён" };
  const defaults = [
    { code: "guest", price_kopecks: 0, daily_tokens: 5000, advanced_tokens: 0 },
    { code: "free", price_kopecks: 0, daily_tokens: 15000, advanced_tokens: 0 },
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
  function page(ctx, ui) {
    const { detail, esc, button } = ui;
    const subscription = ctx.connection.subscription;
    const quota = ctx.connection.quota || subscription?.quota;
    const current = quota?.plan || (Cortex.state.account ? "free" : "guest");
    const plans = Array.isArray(subscription?.plans) ? subscription.plans : defaults;
    const paid = ["start", "pro", "ultra"].includes(current);
    const canBuy = subscription?.checkout === true;
    const loadError = ctx.connection.subscriptionError;
    const percent = quota?.unlimited ? 100 : Math.max(0, Math.min(100, Math.round(100 * (quota?.remaining ?? 0) / (quota?.limit || 1))));
    const hero = `<section class="sub-hero"><header><span>Текущий тариф</span><strong>${esc(names[current])}</strong></header>
      <div class="sub-balance"><strong>${quota?.unlimited ? "∞" : quota ? esc(number.format(quota.remaining)) : "—"}</strong>
      <span>токенов осталось${quota && !quota.unlimited ? ` из ${esc(number.format(quota.limit))}` : ""}</span></div>
      <div class="sub-meter" role="progressbar" aria-label="Остаток токенов" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="--sub-percent:${percent}%"></i></div>
      <dl><div><dt>Сброс лимита</dt><dd>${esc(date(quota?.reset_at))} МСК</dd></div>
      <div><dt>Подписка до</dt><dd>${esc(date(quota?.ends_at))}</dd></div></dl>
      ${paid ? `<p class="sub-note">Продление вручную</p>` : ""}</section>`;
    const catalogue = plans.map(plan => {
      if (!Object.hasOwn(names, plan.code)) return "";
      const selected = plan.code === current;
      const action = plan.code === "free" && current === "guest" ? button("Войти для Free", "", "go", "account", "outline") :
        canBuy && plan.price_kopecks > 0 ? button(selected ? "Продлить" : paid ? "Сменить на " + names[plan.code] : "Выбрать " + names[plan.code], "",
          selected ? "subscription-renew" : "subscription-checkout", plan.code, "outline") : "";
      return `<article class="sub-plan${selected ? " sub-current" : ""}"><header><h3>${names[plan.code]}</h3>
        <span>${plan.price_kopecks ? esc(money.format(plan.price_kopecks / 100)) + " / мес." : "Бесплатно"}</span></header>
        <p>${descriptions[plan.code]}</p><strong>${esc(number.format(plan.daily_tokens))} токенов в день</strong>
        ${plan.advanced_tokens ? `<small>${esc(number.format(plan.advanced_tokens))} из них для сложного ИИ</small>` : ""}${action}</article>`;
    }).join("");
    const payments = Array.isArray(subscription?.payments) ? subscription.payments : [];
    const history = payments.length ? `<ul class="sub-payments">${payments.map(payment =>
      `<li><div><strong>${esc(names[payment.plan])} · ${esc(money.format(payment.amount / 100))}</strong>
       <small>${esc(date(payment.created_at))} · ${esc(states[payment.state])}</small></div>
       ${payment.state === "pending" ? button("Проверить", "", "subscription-status", payment.id, "quiet") : ""}</li>`).join("")}</ul>` : "<p>Платежей пока нет.</p>";
    const features = `<details class="sub-compare"><summary>Сравнить возможности</summary><div><table><thead><tr><th scope="col">Тариф</th>
      <th scope="col">Токены в день</th><th scope="col">Сложный ИИ</th></tr></thead><tbody>${plans.map(plan =>
        `<tr><th scope="row">${esc(names[plan.code])}</th><td>${esc(number.format(plan.daily_tokens))}</td>
         <td>${plan.advanced_tokens ? esc(number.format(plan.advanced_tokens)) : "—"}</td></tr>`).join("")}</tbody></table></div></details>`;
    return detail("Подписка", "", `<div class="sub-page">${hero}
      ${loadError ? `<p class="sub-status" role="status">${esc(loadError)} ${button("Обновить", "", "subscription-refresh", "", "quiet")}</p>` : ""}
      <section class="sub-section"><h2>Тарифы</h2>${!canBuy ? `<p class="sub-status">${current === "guest" ? "Для покупки понадобится аккаунт." : "Оплата подписок пока закрыта."}</p>` : ""}
      <div class="sub-plans">${catalogue}</div>${features}</section>
      <p class="sub-note">Локальные команды, сценарии, напоминания и настройки островка бесплатны и безлимитны.</p>
      <section class="sub-section"><h2>История платежей</h2>${history}</section></div>`);
  }
  return { page };
})();

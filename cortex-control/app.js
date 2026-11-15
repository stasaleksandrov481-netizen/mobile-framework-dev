import { createClient } from "@supabase/supabase-js";
import { projectUrl, publishableKey } from "./project.js";

const db = createClient(projectUrl, publishableKey, {
  auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
});
const app = document.querySelector("#app");
const feedback = document.querySelector("#feedback");
const redirectTo = "https://cortex-control-phi.vercel.app/";
const labels = {
  overview: "Обзор", support: "Обращения", updates: "Версии", maintenance: "Техработы",
  roles: "Доступы", quota: "Лимиты ИИ", billing: "Подписки", audit: "Журнал"
};
const ticketStates = { open: "Открыто", in_progress: "В работе", answered: "Есть ответ", closed: "Закрыто" };
const roles = { owner: "Владелец", admin: "Разработчик", support: "Поддержка" };
const categories = { contact: "Вопрос", bug: "Ошибка", idea: "Идея", complaint: "Жалоба" };
let user, role, factor, enrollment, ticket, tab = "overview";
let renderVersion = 0, feedbackTimer;
let quotaId = "", supportFilter = "active";

const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const date = value => value ? new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "—";
const dateNumber = value => Number(value || 0).toLocaleString("ru-RU");
const checked = value => value ? " checked" : "";
const button = (text, action, value = "") => '<button type="button" data-action="' + action + '" data-value="' +
  escape(value) + '">' + escape(text) + '</button>';
const field = (name, label, type = "text", value = "", attrs = "") =>
  '<label>' + escape(label) + '<input name="' + name + '" type="' + type + '" value="' + escape(value) + '" ' + attrs + '></label>';
const submit = label => '<button class="primary" type="submit">' + escape(label) + '</button>';
const form = (name, fields, label) => '<form data-form="' + name + '">' + fields + submit(label) + '</form>';
const card = (title, html) => '<section class="card"><h2>' + escape(title) + '</h2>' + html + '</section>';
const options = (items, selected = "") => Object.entries(items).map(([id, label]) =>
  '<option value="' + escape(id) + '"' + (id === selected ? ' selected' : '') + '>' + escape(label) + '</option>').join("");

function data(result) {
  if (result.error) throw result.error;
  return result.data;
}

function flash(text) {
  clearTimeout(feedbackTimer);
  feedback.textContent = text;
  feedback.hidden = false;
  feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 5200);
}

function showAuth(title, body) {
  app.innerHTML = '<main class="auth"><div class="wordmark">CORTEX CONTROL</div><h1>' + escape(title) + '</h1>' + body + '</main>';
}

function signIn() {
  showAuth("Вход в панель", form("signin",
    field("email", "Email", "email", "", 'autocomplete="username" required') +
    field("password", "Пароль", "password", "", 'autocomplete="current-password" required'), "Войти") +
    '<div class="actions">' + button("Забыли пароль?", "recover") + '</div>');
}

function recover(email) {
  const address = field("email", "Почта", "email", email || "", 'autocomplete="email" required');
  showAuth(email ? "Новый пароль" : "Восстановление доступа", email ?
    form("reset-password", address + field("code", "Код из письма", "text", "", 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required') +
      field("password", "Новый пароль", "password", "", 'minlength="10" maxlength="72" autocomplete="new-password" required'),
      "Изменить пароль") : form("send-recovery", address, "Отправить код"));
}

function signUp() {
  showAuth("Новый аккаунт", form("signup",
    field("email", "Email", "email", "", 'autocomplete="email" required') +
    field("password", "Пароль", "password", "", 'autocomplete="new-password" minlength="8" required'), "Создать") +
    button("Назад ко входу", "signin"));
}

function showMfa(list) {
  const factors = list.all.filter(item => item.factor_type === "totp" && item.status === "verified");
  if (!enrollment && !factors.length) {
    showAuth("Настройка защиты", '<p>Подключите приложение для одноразовых кодов. Для входа в панель нужен код из этого приложения.</p>' +
      '<div class="actions">' + button("Подключить Authenticator", "enroll") + button("Выйти", "logout") + '</div>');
    return;
  }
  factor = enrollment?.id || factors.find(item => item.id === factor)?.id || factors[0]?.id;
  const qr = enrollment?.totp?.qr_code || "";
  const setup = enrollment ? '<p>Добавьте CORTEX Control в Authenticator и введите код из новой записи.</p>' +
    (/^data:image\/(?:svg\+xml|png)[;,]/.test(qr) ? '<img class="qr" src="' + escape(qr) + '" alt="QR-код для Authenticator">' : "") +
    '<details><summary>Показать ключ настройки</summary><code>' + escape(enrollment.totp.secret) + '</code></details>' : "";
  const choice = !enrollment && factors.length > 1 ?
    '<label>Устройство<select name="factor">' + options(Object.fromEntries(factors.map(item => [item.id, item.friendly_name || "Authenticator"])), factor) + '</select></label>' : "";
  showAuth("Код Authenticator", setup + form("mfa", choice +
    field("code", "Шестизначный код", "text", "", 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required'),
    "Подтвердить") + '<div class="actions">' + button("Обновить список устройств", "refresh-auth") + button("Выйти", "logout") + '</div>');
}

async function initialize() {
  const { session } = data(await db.auth.getSession());
  if (!session) { user = role = factor = enrollment = null; signIn(); return; }
  const previous = user?.id;
  user = data(await db.auth.getUser()).user;
  if (!user) { signIn(); return; }
  if (previous !== user.id) { factor = enrollment = ticket = null; quotaId = ""; }
  if (!data(await db.rpc("cortex_control_signin"))) {
    role = null;
    showAuth("Доступ закрыт", '<p>Войдите с аккаунтом администратора.</p>' + button("Выйти", "logout"));
    return;
  }
  const assurance = data(await db.auth.mfa.getAuthenticatorAssuranceLevel());
  if (assurance.currentLevel !== "aal2") {
    const factors = data(await db.auth.mfa.listFactors());
    if (enrollment && !factors.all.some(item => item.id === enrollment.id)) enrollment = null;
    showMfa(factors);
    return;
  }
  enrollment = null;
  const grant = data(await db.from("cortex_admin_roles").select("role").eq("user_id", user.id).maybeSingle());
  role = grant?.role;
  if (!Object.hasOwn(roles, role)) {
    showAuth("Доступ к панели", '<p>Аккаунт подтверждён. Для доступа нужна роль CORTEX.</p>' +
      form("claim-owner", field("code", "Ключ владельца", "password", "", 'required autocomplete="off"'), "Получить доступ владельца") +
      form("claim-admin", field("code", "Ключ разработчика", "password", "", 'required autocomplete="off"'), "Получить доступ разработчика") +
      button("Выйти", "logout"));
    return;
  }
  drawShell();
  await loadTab();
}

function allowedTabs() {
  if (role === "owner") return Object.keys(labels);
  if (role === "admin") return ["overview", "support", "updates", "maintenance", "quota", "billing", "audit"];
  return ["overview", "support"];
}

function drawShell() {
  if (!allowedTabs().includes(tab)) tab = "overview";
  const navigation = allowedTabs().map(key => '<button type="button" data-action="tab" data-value="' + key + '"' +
    (key === tab ? ' aria-current="page"' : '') + '>' + labels[key] + '</button>').join("");
  app.innerHTML = '<header class="top"><div class="wordmark">CORTEX CONTROL</div><span class="role">' +
    escape(roles[role]) + '</span><button type="button" class="menu-button" data-action="menu" aria-controls="mobile-nav" aria-expanded="false">Меню</button></header>' +
    '<div class="layout"><aside><nav aria-label="Разделы">' + navigation + '</nav>' + button("Выйти", "logout") + '</aside>' +
    '<main id="dashboard"><h1>' + labels[tab] + '</h1><p>Загрузка…</p></main></div>' +
    '<dialog id="mobile-nav" aria-label="Меню"><div class="dialog-head"><strong>CORTEX Control</strong>' +
    button("Закрыть", "close-menu") + '</div><nav aria-label="Разделы">' + navigation + '</nav>' + button("Выйти", "logout") + '</dialog>';
  const menu = document.querySelector("#mobile-nav");
  menu.addEventListener("click", event => { if (event.target === menu) menu.close(); });
  menu.addEventListener("close", () => document.querySelector(".menu-button")?.setAttribute("aria-expanded", "false"));
}

async function loadTab() {
  const main = document.querySelector("#dashboard");
  if (!main) return;
  const page = tab, version = ++renderVersion;
  try {
    const html = await views[page]();
    if (version === renderVersion && main.isConnected) main.innerHTML = '<h1>' + labels[page] + '</h1>' + html;
  } catch (error) {
    if (version === renderVersion && main.isConnected) {
      main.innerHTML = '<h1>' + labels[page] + '</h1><p>' + escape(error.message) + '</p>' + button("Повторить", "refresh");
    }
  }
}

async function overview() {
  const [summary, activity] = (await Promise.all([
    db.rpc("cortex_admin_overview"), db.rpc("cortex_admin_activity")
  ])).map(data);
  const labels = { devices: "Уникальные устройства", new_today: "Впервые открыли сегодня",
    opened_today: "Устройств открыли сегодня", accounts_today: "Аккаунтов открыли сегодня", launches_today: "Сеансов сегодня" };
  const cards = Object.entries(labels).map(([key, label]) =>
    card(label, '<strong class="count">' + dateNumber(activity[key]) + '</strong>')).join("");
  const other = [["ai_today", "Запросы к ИИ сегодня"], ["support_open", "Открытые обращения"]]
    .filter(([key]) => Object.hasOwn(summary || {}, key))
    .map(([key, label]) => card(label, '<strong class="count">' + dateNumber(summary[key]) + '</strong>')).join("");
  const seen = activity.today.map(row => '<li><strong>' + escape(row.public_id) + '</strong><span>' +
    date(row.opened_at) + ' МСК · ' + dateNumber(row.devices) + ' устр.</span></li>').join("");
  return '<div class="cards">' + cards + other + '</div><p class="muted">Сегодня по Москве. Учёт устройств начинается с обновления.</p>' +
    card("Кто открыл CORTEX сегодня", seen ? '<ul class="record-list">' + seen + '</ul>' : '<p>Сегодня пока нет входов с аккаунтом.</p>');
}

async function support() {
  const selected = ticket;
  const filters = { active: "Активные", open: "Открытые", in_progress: "В работе", answered: "С ответом", closed: "Закрытые" };
  const filterBar = '<div class="ticket-filters" aria-label="Статус обращений">' + Object.entries(filters).map(([id, label]) =>
    '<button type="button" data-action="ticket-filter" data-value="' + id + '" aria-pressed="' + (id === supportFilter) + '">' +
    label + '</button>').join("") + '</div>';
  const query = db.from("cortex_support").select("id,created_at,category,message,reply_to,app_version,status");
  const tickets = data(await (supportFilter === "active" ? query.neq("status", "closed") : query.eq("status", supportFilter))
    .order("created_at", { ascending: false }).limit(100)) || [];
  if (!tickets.length) return filterBar + '<p>В этой категории нет обращений.</p>';
  const current = tickets.find(item => item.id === selected) || tickets[0];
  if (ticket === selected) ticket = current.id;
  const [replies, attachment] = await Promise.all([
    db.from("cortex_support_replies").select("id,created_at,message").eq("ticket_id", current.id).order("created_at"),
    db.from("cortex_support").select("screenshot").eq("id", current.id).maybeSingle()
  ]).then(results => results.map(data));
  const screenshot = attachment?.screenshot || "";
  const list = tickets.map(item => '<button class="ticket-item" type="button" data-action="ticket" data-value="' + escape(item.id) +
    '"' + (item.id === current.id ? ' aria-current="true"' : '') + '><strong>' +
    escape(categories[item.category] || item.category) + ' · ' + escape(ticketStates[item.status] || item.status) +
    '</strong><small>' + escape(item.message.slice(0, 70)) + '</small></button>').join("");
  const thread = (replies || []).map(reply => '<article class="ticket-message from-control"><small>Поддержка · ' + date(reply.created_at) + '</small><p>' +
    escape(reply.message) + '</p></article>').join("");
  const details = '<p class="muted">' + date(current.created_at) + ' · № ' + escape(current.id.slice(0, 8).toUpperCase()) + '</p>' +
    '<div class="ticket-messages"><article class="ticket-message"><small>Пользователь · ' + date(current.created_at) + '</small><p>' +
    escape(current.message) + '</p></article>' + thread + '</div>' +
    (current.reply_to ? '<p class="muted">Email: ' + escape(current.reply_to) + '</p>' : "") +
    (current.app_version ? '<p class="muted">Версия: ' + escape(current.app_version) + '</p>' : "") +
    (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(screenshot) ?
      '<details><summary>Скриншот</summary><img class="attachment" src="' + escape(screenshot) + '" alt="Приложенный скриншот"></details>' : "") +
    form("reply", '<input type="hidden" name="ticket_id" value="' + escape(current.id) + '"><label>Ответ пользователю<textarea name="message" rows="4" maxlength="4000" required></textarea></label>', "Отправить ответ") +
    form("ticket-status", '<input type="hidden" name="ticket_id" value="' + escape(current.id) + '"><label>Статус<select name="status">' + options(ticketStates, current.status) + '</select></label>', "Сохранить статус");
  return filterBar + '<div class="support-layout"><div class="ticket-list">' + list + '</div>' + card("Диалог", details) + '</div>';
}

async function controlConfig() {
  return data(await db.from("cortex_control_config").select("*").eq("singleton", true).single());
}

async function maintenance() {
  const config = await controlConfig();
  return card("Режим технических работ", form("maintenance",
    '<label class="check"><input type="checkbox" name="enabled"' + checked(config.maintenance_enabled) + '>Включить режим</label>' +
    '<label>Сообщение пользователям<textarea name="message" rows="3" maxlength="400">' + escape(config.maintenance_message) +
    '</textarea></label>', "Сохранить")) + card("Доступ во время техработ", form("maintenance-access",
    field("public_id", "Короткий ID аккаунта", "text", "", 'placeholder="@id000001" required') +
    field("days", "Дней доступа (0 — отозвать)", "number", 1, 'min="0" max="31" required'),
    "Применить"));
}

async function updates() {
  const [config, versions] = await Promise.all([
    controlConfig(), db.from("cortex_release_versions").select("version_code,version_name,access,notes").order("version_code", { ascending: false }).limit(50).then(data)
  ]);
  const list = (versions || []).map(version => '<li><div><strong>' + escape(version.version_name) + '</strong> · ' +
    escape(version.version_code) + '<p>' + escape(version.notes) + '</p></div>' +
    button(version.access === "blocked" ? "Разрешить" : "Заблокировать", version.access === "blocked" ? "allow-version" : "block-version", version.version_code) + '</li>').join("");
  return card("Обязательное обновление", form("update-policy",
    '<label class="check"><input type="checkbox" name="enabled"' + checked(config.block_old_versions) + '>Требовать новую версию</label>' +
    field("code", "Минимальный код версии", "number", config.min_version_code, 'min="1" max="2100000000" required') +
    field("url", "Ссылка на обновление", "url", config.update_url || "", 'placeholder="https://"'), "Сохранить")) +
    card("Версии", '<ul class="record-list">' + list + '</ul>' + form("release",
      field("name", "Название версии", "text", "", 'maxlength="24" required') +
      field("code", "Код версии", "number", "", 'min="1" max="2100000000" required') +
      '<label>Заметка<textarea name="notes" rows="2" maxlength="600"></textarea></label>', "Добавить версию"));
}

async function access() {
  const grants = data(await db.rpc("cortex_list_admin_roles")) || [];
  return card("Роли", '<ul class="record-list">' + grants.map(grant => '<li><span>' + escape(grant.email || grant.user_id) +
    '</span><strong>' + escape(roles[grant.role] || grant.role) + '</strong></li>').join("") + '</ul>' +
    form("role", field("email", "Email", "email", "", "required") +
      '<label>Роль<select name="role">' + options({ admin: "Разработчик", support: "Поддержка", remove: "Отозвать доступ" }) +
      '</select></label>', "Применить"));
}

async function audit() {
  const events = data(await db.from("cortex_admin_audit").select("event,target,created_at").order("created_at", { ascending: false }).limit(80));
  return card("Последние действия", '<ul class="record-list">' + (events || []).map(event => '<li><span>' +
    escape(event.event) + ' · ' + escape(event.target) + '</span><small>' + date(event.created_at) + '</small></li>').join("") + '</ul>');
}

async function quotas() {
  const config = data(await db.rpc("cortex_admin_ai", { p_operation: "config" }));
  const budget = card("Общий бюджет ИИ", form("ai-config",
    field("day", "Запросов OpenRouter в сутки", "number", config.requests_day, 'min="1" max="1000" placeholder="Лимит сервера"') +
    field("minute", "Запросов OpenRouter в минуту", "number", config.requests_minute, 'min="1" max="20" placeholder="Лимит сервера"') +
    field("model", "Основная бесплатная модель", "text", config.model, 'maxlength="120" placeholder="provider/model:free"') +
    '<p>Лимиты запросов ограничены параметрами аккаунта OpenRouter, указанными на сервере.</p>', "Сохранить"));
  const search = form("quota-search", field("id", "ID профиля или гостя", "text", quotaId,
    'maxlength="50" required autocomplete="off"'), "Найти");
  if (!quotaId) return budget + card("Поиск по ID", search);
  const target = await resolveAccount(quotaId);
  const quota = target && data(await db.rpc("cortex_admin_ai", { p_subject: target }));
  if (!quota) return budget + card("Поиск по ID", search + "<p>Запись с этим ID не найдена.</p>");
  const summary = "<p>" + escape(quota.id) + "</p><p>Использовано " + dateNumber(quota.used) +
    " · Осталось " + (quota.unlimited ? "безлимит" : dateNumber(quota.remaining)) + " токенов</p>" +
    "<p>Сброс в 03:00 по Москве.</p>";
  return budget + card("Поиск по ID", search) + card("Суточный лимит", summary +
    form("quota-limit", field("limit", "Токенов в сутки", "number", quota.limit, 'min="0" max="1000000" required'),
      "Установить лимит") +
    '<div class="actions">' + button("Сбросить счётчик", "quota-change", "reset") +
    button("Обнулить лимит", "quota-change", "zero") +
    button("Дать безлимит", "quota-change", "unlimited") +
    button("Вернуть общий лимит", "quota-change", "revoke") + "</div>");
}

async function updateQuota(operation, limit) {
  if (!quotaId || !["owner", "admin"].includes(role)) return;
  const target = await resolveAccount(quotaId);
  const quota = target && data(await db.rpc("cortex_admin_ai", {
    p_subject: target, p_operation: operation, p_limit: limit ?? null
  }));
  if (!quota) throw new Error("Запись с этим ID больше недоступна.");
  flash("Лимит обновлён.");
  await loadTab();
}

async function resolveAccount(id) {
  return id.startsWith("@") ? data(await db.rpc("cortex_admin_activity", { p_action: "account", p_id: id }))?.subject : id;
}

const planNames = { guest: "Guest", free: "Free", start: "Start", pro: "Pro", ultra: "Ultra" };
const rub = value => (Number(value) / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
const dollars = value => "$" + (Number(value) / 1e6).toFixed(4);
const billingRpc = (p_action, p_data = {}) => db.rpc("cortex_admin_billing", { p_action, p_data }).then(data);

async function subscriptions() {
  const result = await billingRpc("overview");
  const funding = result.funding;
  const numbers = [["Действующие подписчики", dateNumber(result.paid_accounts)], ["Оплачено", rub(result.collected)],
    ["Возвращено", rub(result.refunded)], ["Зарезервировано", dollars(funding.committed_micros) + " / " + dollars(funding.funded_micros)]];
  const summary = card("Подписки и платежи", '<ul class="record-list">' +
    numbers.map(([title,value]) => '<li>' + title + '<strong>' + value + '</strong></li>').join("") + '</ul>');
  const budget = card("Расходы OpenRouter за 30 дней", form("billing-funding",
    field("usd", "Обеспеченный бюджет, USD", "number", funding.funded_micros / 1e6, 'min="0" step=".000001" required') +
    '<label class="check"><input name="checkout" type="checkbox"' + checked(funding.checkout_enabled) +
    '>Разрешить оплату после подключения Platega</label>', "Сохранить бюджет") + '<ul class="record-list">' +
    result.models.map(m => '<li>' + escape(m.model) + ' · ' + dateNumber(m.calls) +
      ' <strong>' + dollars(m.measured_micros) + ' · резерв ' + dollars(m.unsettled_micros) + '</strong></li>').join("") + '</ul>');
  const grant = card("Выдать тестовый доступ", form("billing-grant",
    field("subject", "ID аккаунта", "text", "", 'placeholder="@id000001" maxlength="50" required') +
    '<label>Тариф<select name="plan">' + options({ start: "Start", pro: "Pro", ultra: "Ultra" }) + '</select></label>' +
    field("days", "Дней доступа", "number", 7, 'min="1" max="31" required'), "Выдать доступ"));
  const plans = result.plans.map(p => card(planNames[p.code], form("billing-plan",
    '<input type="hidden" name="plan" value="' + escape(p.code) + '">' +
    field("price", "Цена в месяц, ₽", "number", p.price_kopecks / 100, 'min="0" step=".01" required') +
    field("tokens", "Токенов в день", "number", p.daily_tokens, 'min="1" max="1000000" required') +
    field("advanced", "Токенов сложного ИИ в день", "number", p.advanced_tokens, 'min="0" required') +
    field("context", "Контекст, символов", "number", p.context_chars, 'min="3000" max="51000" required'), "Сохранить тариф"))).join("");
  const states = { creating: "Создаётся", pending: "Ожидает оплаты", confirmed: "Подтверждено", canceled: "Отменено", refunded: "Возврат" };
  const entries = result.recent.map(p => '<li><span>' + escape(p.public_id || p.subject) + ' · ' + escape(planNames[p.plan]) +
    '<br><small>' + escape(states[p.state]) + ' · ' + (p.mode === "manual" ? "Промодоступ до " + date(p.ends_at) : rub(p.amount)) +
    '</small></span>' + (p.state === "confirmed" ? button(p.mode === "manual" ? "Отозвать" : "Возврат",
      p.mode === "manual" ? "billing-revoke" : "billing-refund", p.id) : "") + '</li>').join("");
  return '<div class="cards">' + summary + budget + grant + '</div><div class="cards">' + plans + '</div>' +
    card("Подписчики и платежи", entries ? '<ul class="record-list">' + entries + '</ul>' : '<p>Записей пока нет.</p>');
}

const views = { overview, support, maintenance, updates, roles: access, quota: quotas, billing: subscriptions, audit };

async function saveConfig(values) {
  data(await db.from("cortex_control_config").update({ ...values, updated_at: new Date().toISOString() })
    .eq("singleton", true).select("singleton").single());
}

app.addEventListener("click", async event => {
  const control = event.target.closest("button[data-action]");
  if (!control || control.disabled) return;
  const { action, value } = control.dataset;
  control.disabled = true;
  try {
    switch (action) {
      case "signin": signIn(); break;
      case "signup": signUp(); break;
      case "recover": recover(""); break;
      case "logout": data(await db.auth.signOut()); await initialize(); break;
      case "refresh-auth": await initialize(); break;
      case "enroll": {
        const factors = data(await db.auth.mfa.listFactors());
        if (factors.totp.some(item => item.status === "verified")) { showMfa(factors); break; }
        enrollment = data(await db.auth.mfa.enroll({
          factorType: "totp", friendlyName: "CORTEX " + new Date().toISOString().slice(0, 19)
        }));
        showMfa(factors);
        break;
      }
      case "tab":
        if (allowedTabs().includes(value)) { tab = value; drawShell(); await loadTab(); }
        break;
      case "refresh": await loadTab(); break;
      case "ticket": ticket = value; await loadTab(); break;
      case "ticket-filter": supportFilter = value; ticket = null; await loadTab(); break;
      case "billing-revoke":
        if (!confirm("Отозвать выданный доступ?")) break;
        await billingRpc("revoke", { id: value });
        await loadTab();
        break;
      case "billing-refund": {
        if (!confirm("Запросить полный возврат?")) break;
        const { session } = data(await db.auth.getSession());
        if (!session) throw new Error("Войдите в панель снова.");
        const response = await fetch("/api/billing", { method: "POST",
          headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "refund", id: value }) });
        if (!response.ok) throw new Error("Platega не приняла запрос на возврат.");
        flash("Запрос на возврат принят.");
        await loadTab();
        break;
      }
      case "menu":
        document.querySelector("#mobile-nav").showModal();
        control.setAttribute("aria-expanded", "true");
        break;
      case "close-menu": document.querySelector("#mobile-nav")?.close(); break;
      case "quota-change":
        if (confirm(control.textContent + " для выбранного ID?")) await updateQuota(value === "zero" ? "limit" : value,
          value === "zero" ? 0 : null);
        break;
      case "allow-version":
      case "block-version":
        if (role !== "owner" && role !== "admin") break;
        if (action === "block-version" && !confirm("Заблокировать эту версию CORTEX?")) break;
        data(await db.from("cortex_release_versions").update({ access: action === "block-version" ? "blocked" : "allowed" })
          .eq("version_code", Number(value)).select("version_code").single());
        await loadTab();
        break;
    }
  } catch (error) { flash(error.message); }
  finally { if (control.isConnected) control.disabled = false; }
});

app.addEventListener("submit", async event => {
  const target = event.target.closest("form[data-form]");
  if (!target) return;
  event.preventDefault();
  const submitButton = target.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  const formData = new FormData(target);
  const read = name => String(formData.get(name) ?? "").trim();
  try {
    switch (target.dataset.form) {
      case "signin":
        data(await db.auth.signInWithPassword({ email: read("email"), password: String(formData.get("password")) }));
        await initialize();
        return;
      case "send-recovery":
        data(await db.auth.resetPasswordForEmail(read("email"), { redirectTo }));
        recover(read("email"));
        flash("Если эта почта зарегистрирована, на неё придёт код.");
        return;
      case "reset-password":
        data(await db.auth.verifyOtp({ email: read("email"), token: read("code"), type: "recovery" }));
        data(await db.auth.updateUser({ password: String(formData.get("password")) }));
        data(await db.auth.signOut({ scope: "global" }));
        signIn();
        flash("Пароль изменён.");
        return;
      case "signup": {
        const result = data(await db.auth.signUp({ email: read("email"), password: String(formData.get("password")), options: { emailRedirectTo: redirectTo } }));
        if (result.session) await initialize();
        else showAuth("Подтвердите email", '<p>Откройте ссылку из письма, затем вернитесь в панель и войдите.</p>' + button("Ко входу", "signin"));
        return;
      }
      case "mfa": {
        const list = data(await db.auth.mfa.listFactors());
        const factorId = read("factor") || factor;
        if (!list.all.some(item => item.id === factorId)) {
          enrollment = null;
          showMfa(list);
          flash("Устройство больше недоступно. Выберите актуальное устройство.");
          return;
        }
        data(await db.auth.mfa.challengeAndVerify({ factorId, code: read("code") }));
        await initialize();
        return;
      }
      case "claim-owner":
      case "claim-admin":
        data(await db.rpc(target.dataset.form === "claim-owner" ? "cortex_claim_owner" : "cortex_claim_developer", { p_code: read("code") }));
        await initialize();
        return;
      case "reply": {
        const id = read("ticket_id");
        const message = read("message");
        if (!message) throw new Error("Введите ответ.");
        data(await db.from("cortex_support_replies").insert({ ticket_id: id, author_id: user.id, message }).select("id").single());
        target.reset();
        flash("Ответ сохранён. Пользователь увидит его в приложении.");
        await loadTab();
        return;
      }
      case "ticket-status":
        data(await db.from("cortex_support").update({ status: read("status") }).eq("id", read("ticket_id")).select("id").single());
        break;
      case "maintenance":
        if (formData.has("enabled") && !confirm("Включить технические работы для пользователей?")) return;
        await saveConfig({ maintenance_enabled: formData.has("enabled"), maintenance_message: read("message") });
        break;
      case "update-policy":
        if ((formData.has("enabled") || read("url")) && !/^https:\/\//.test(read("url"))) throw new Error("Укажите HTTPS-ссылку на обновление.");
        await saveConfig({ block_old_versions: formData.has("enabled"), min_version_code: Number(read("code")), update_url: read("url") });
        break;
      case "release":
        data(await db.from("cortex_release_versions").insert({
          version_code: Number(read("code")), version_name: read("name"), notes: read("notes"), access: "allowed"
        }).select("version_code").single());
        break;
      case "role":
        data(await db.rpc("cortex_set_admin_role", { p_email: read("email"), p_role: read("role") }));
        break;
      case "ai-config":
        data(await db.rpc("cortex_admin_ai", { p_operation: "configure", p_limit: 15000,
          p_day: read("day") ? Number(read("day")) : null, p_minute: read("minute") ? Number(read("minute")) : null,
          p_model: read("model") || null }));
        break;
      case "billing-plan":
        await billingRpc("plan", { plan: read("plan"), price: Math.round(Number(read("price")) * 100),
          tokens: Number(read("tokens")), advanced: Number(read("advanced")), context: Number(read("context")) });
        break;
      case "billing-funding":
        await billingRpc("funding", { micros: Math.round(Number(read("usd")) * 1e6), checkout: formData.has("checkout") });
        break;
      case "billing-grant": {
        const subject = await resolveAccount(read("subject"));
        if (!subject) throw new Error("Аккаунт не найден.");
        await billingRpc("grant", { subject, plan: read("plan"), days: Number(read("days")) });
        break;
      }
      case "maintenance-access": {
        const result = data(await db.rpc("cortex_admin_activity", {
          p_action: "maintenance", p_id: read("public_id"), p_days: Number(read("days"))
        }));
        if (!result) throw new Error("Аккаунт не найден.");
        flash(result.maintenance_until ? "Доступ до " + date(result.maintenance_until) + " МСК" : "Доступ отозван.");
        return;
      }
      case "quota-search":
        quotaId = read("id");
        await loadTab();
        return;
      case "quota-limit":
        await updateQuota("limit", Number(read("limit")));
        return;
    }
    flash("Изменения сохранены.");
    await loadTab();
  } catch (error) { flash(error.message); }
  finally { if (submitButton.isConnected) submitButton.disabled = false; }
});

initialize().catch(error => {
  showAuth("Не удалось подключиться", '<p>' + escape(error.message) + '</p>' + button("Повторить", "refresh-auth") + button("Выйти", "logout"));
});

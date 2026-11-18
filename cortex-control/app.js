import { createClient } from "@supabase/supabase-js";
import { projectUrl, publishableKey } from "./project.js";

const db = createClient(projectUrl, publishableKey, {
  auth: { flowType: "pkce", persistSession: true, storage: window.sessionStorage,
    detectSessionInUrl: true, autoRefreshToken: true }
});
const app = document.querySelector("#app");
const feedback = document.querySelector("#feedback");
const redirectTo = "https://cortex-control-phi.vercel.app/";
const labels = {
  overview: "Обзор", support: "Обращения", updates: "Версии", maintenance: "Техработы",
  roles: "Доступы", quota: "Лимиты ИИ", billing: "Подписки", audit: "Журнал"
};
const ticketStates = { open: "Открыто", in_progress: "В работе", answered: "Есть ответ", closed: "Закрыто" };
const roles = { owner: "Владелец", admin: "Администратор", support: "Поддержка" };
const categories = { contact: "Вопрос", bug: "Ошибка", idea: "Идея", complaint: "Жалоба" };
let user, role, factor, enrollment, ticket, tab = "overview";
let renderVersion = 0, feedbackTimer;
let quotaId = "", supportFilter = "active", ownId = "";
const IDLE_LIMIT_MS = 30 * 60 * 1000;
let lastInteraction = Date.now(), signingOut = false;

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

const safeError = (error, context = "operation") => {
  const code = String(error?.code || "");
  if (code === "invalid_credentials" || code === "invalid_grant") return "Неверная почта или пароль.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit")
    return "Слишком много попыток. Подождите несколько минут.";
  if (code === "mfa_challenge_expired" || code === "otp_expired") return "Код истёк. Запросите новый.";
  if (code === "invalid_otp") return "Неверный код. Проверьте Authenticator.";
  if (code === "42501") return "Недостаточно прав для этой операции.";
  return context === "auth" ? "Не удалось подтвердить вход. Проверьте данные и попробуйте снова." :
    "Не удалось выполнить действие. Попробуйте ещё раз.";
};

function authFooter() {
  return '<div class="auth-foot"><span>Доступ только для сотрудников CORTEX</span>' +
    '<span>Защищённое соединение · MFA</span></div>';
}

function showAuth(title, body) {
  app.innerHTML = '<div class="auth-layout"><section class="auth-aside" aria-label="Панель управления CORTEX">' +
    '<div class="brand"><span class="brand-mark" aria-hidden="true">C</span><span>CORTEX <strong>CONTROL</strong></span></div>' +
    '<div class="aside-content"><span class="overline">СИСТЕМА УПРАВЛЕНИЯ</span>' +
    '<h2>Всё важное.<br>Под контролем.</h2>' +
    '<p>Состояние сервиса, пользователи, обращения, подписки и системные события.</p>' +
    '<div class="aside-line"><span class="status-dot"></span>Защищённый доступ к данным</div></div>' +
    '<div class="aside-bottom">CORTEX / INTERNAL</div></section>' +
    '<main class="auth-panel"><div class="auth-mobile-brand"><span class="brand-mark" aria-hidden="true">C</span>CORTEX CONTROL</div>' +
    '<div class="auth-inner"><div class="auth-icon" aria-hidden="true">C</div>' +
    '<span class="overline">CORTEX CONTROL</span><h1>' + escape(title) + '</h1>' + body + authFooter() +
    '</div></main></div>';
}

function signIn() {
  showAuth("Вход в панель", '<p class="auth-description">Используйте аккаунт с выданной ролью администратора.</p>' +
    form("signin", field("email", "Электронная почта", "email", "", 'autocomplete="username" maxlength="254" required') +
      field("password", "Пароль", "password", "", 'autocomplete="current-password" required minlength="8"') +
      '<div class="auth-form-tools">' + button("Показать пароль", "password-visibility") +
      button("Забыли пароль?", "recover") + '</div>', "Продолжить") +
    '<div class="auth-note"><span class="status-dot"></span>После пароля потребуется код из Authenticator</div>');
}

function recover(email) {
  const address = field("email", "Почта", "email", email || "", 'autocomplete="email" required');
  showAuth(email ? "Новый пароль" : "Восстановление доступа", '<p class="auth-description">Код будет отправлен на подтверждённую почту.</p>' + (email ?
    form("reset-password", address + field("code", "Код из письма", "text", "", 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required') +
      field("password", "Новый пароль", "password", "", 'minlength="16" maxlength="72" autocomplete="new-password" required'),
      "Изменить пароль") : form("send-recovery", address, "Отправить код")) +
    '<div class="auth-links">' + button("Вернуться ко входу", "signin") + '</div>');
}

function showMfa(list) {
  const factors = list.all.filter(item => item.factor_type === "totp" && item.status === "verified");
  if (!enrollment && !factors.length) {
    showAuth("Настройка защиты", '<p class="auth-description">Подключите Google Authenticator, Microsoft Authenticator или совместимое приложение. Сохраните резервные коды своего аккаунта в безопасном месте.</p>' +
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
  if (!session) { user = role = factor = enrollment = null; ownId = ""; signIn(); return; }
  const previous = user?.id;
  user = data(await db.auth.getUser()).user;
  if (!user) { ownId = ""; signIn(); return; }
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
    showAuth("Доступ ограничен", '<p class="auth-description">Для этого аккаунта не назначена роль в CORTEX Control. Обратитесь к владельцу сервиса.</p>' +
      button("Выйти", "logout"));
    return;
  }
  const identity = await db.rpc("cortex_admin_public_id");
  ownId = typeof identity.data === "string" && /^@id\d{6,17}$/.test(identity.data) ? identity.data : "";
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
  app.innerHTML = '<header class="top"><div class="brand"><span class="brand-mark" aria-hidden="true">C</span><span>CORTEX <strong>CONTROL</strong></span></div>' +
    '<div class="top-status"><span class="status-dot"></span>Рабочая среда</div><span class="role">' +
    escape(roles[role]) + '</span>' + (ownId ? button("Мой ID · " + ownId, "copy-my-id") : "") +
    '<button type="button" class="menu-button" data-action="menu" aria-controls="mobile-nav" aria-expanded="false">Меню</button></header>' +
    '<div class="layout"><aside><div class="sidebar-caption">УПРАВЛЕНИЕ</div><nav aria-label="Разделы">' + navigation + '</nav>' +
    '<div class="sidebar-footer"><div class="sidebar-session"><span class="status-dot"></span>Защищённая сессия<div class="subtle">Автовыход через 30 минут бездействия</div></div>' +
    button("Завершить сеанс", "logout") + '</div></aside>' +
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
    if (version === renderVersion && main.isConnected) main.innerHTML = '<div class="page-heading"><div><span class="overline">CORTEX / ' +
      escape(page.toUpperCase()) + '</span><h1>' + labels[page] + '</h1></div>' +
      '<div class="heading-tools"><span class="muted">Данные в реальном времени</span>' + button("Обновить", "refresh") + '</div></div>' + html;
  } catch (error) {
    if (version === renderVersion && main.isConnected) {
      main.innerHTML = '<h1>' + labels[page] + '</h1><p>' + safeError(error) + '</p>' + button("Повторить", "refresh");
    }
  }
}

async function overview() {
  const [metrics, daily] = await Promise.all([
    db.rpc("cortex_admin_metrics"), db.rpc("cortex_admin_activity")
  ]);
  const activity = data(metrics);
  const labels = { online_devices: "Сейчас в CORTEX", devices: "Уникальные устройства всего",
    opened_24h: "Уникальных устройств за 24 часа", new_today: "Впервые открыли сегодня",
    opened_today: "Устройств открыли сегодня", accounts_today: "Аккаунтов открыли сегодня", launches_total: "Всего запусков",
    ai_requests_today: "Запросов к ИИ сегодня (новый учёт)", ai_requests_total: "Запросов к ИИ с 16 ноября",
    ai_attempts_today: "Обращений к моделям сегодня", ai_success_today: "Успешных ответов моделей сегодня" };
  const cards = Object.entries(labels).map(([key, label]) =>
    '<section class="metric-card"><span class="metric-label">' + escape(label) + '</span><strong class="count">' +
    dateNumber(activity[key]) + '</strong></section>').join("");
  const seen = (activity.online || []).map(row => '<li><strong>' + escape(row.public_id) + '</strong><span>' +
    escape(row.signed_in ? "Аккаунт" : "Гость") + ' · ' + date(row.last_seen_at) + ' МСК · ' + escape(row.version) + '</span></li>').join("");
  const opened = (daily.data?.today || []).map(row => '<li><strong>' + escape(row.public_id) + '</strong><span>' +
    date(row.opened_at) + ' МСК · ' + dateNumber(row.devices) + ' устр.</span></li>').join("");
  const dailyList = daily.error ? '<p>Не удалось загрузить список.</p>' : opened ?
    '<ul class="record-list">' + opened + '</ul>' : '<p>Сегодня пока нет открытий с аккаунтом.</p>';
  return '<div class="dashboard-intro"><div><span class="overline">ОБЩАЯ КАРТИНА</span><h2>Состояние CORTEX</h2>' +
    '<p>Актуальные показатели, активность и обращения пользователей.</p></div><span class="live-badge"><span class="status-dot"></span>Live</span></div>' +
    '<div class="metrics-grid">' + cards + '<section class="metric-card"><span class="metric-label">Открытые обращения</span><strong class="count">' + dateNumber(activity.support_open) + '</strong></section>' +
    '</div><p class="muted">Устройства считаются один раз. Активность: сигнал за последние 120 секунд. Время суток по Москве. ' +
    'Обращение к модели и запрос пользователя считаются отдельно. Точный подсчёт запросов ведётся с 16 ноября 2026 года, ' +
    'старые записи не выдаются за достоверную статистику.</p>' +
    card("Кто сейчас в CORTEX", seen ? '<ul class="record-list">' + seen + '</ul>' : '<p>Активных устройств сейчас нет.</p>') +
    card("Кто открыл CORTEX сегодня", dailyList);
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

// These Android version codes are part of published build history.
function releaseCode(name, versions) {
  const clean = name.trim().replace(/^v/i, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(clean)) return null;
  const candidates = new Set(versions.filter(item =>
    item.version_name.trim().replace(/^v/i, "") === clean).map(item => Number(item.version_code)));
  const known = /^1\.0\.(?:[4-9]|1[0-5])$/.test(clean) ? 100 + Number(clean.split(".")[2]) : null;
  if (known !== null) candidates.add(known);
  const code = candidates.size === 1 ? [...candidates][0] : null;
  return Number.isInteger(code) && code > 0 && code < 2_100_000_000 ? code : null;
}

async function updates() {
  const [config, versions] = await Promise.all([
    controlConfig(), db.from("cortex_release_versions").select("version_code,version_name,access,notes").order("version_code", { ascending: false }).limit(50).then(data)
  ]);
  const list = (versions || []).map(version => '<li><div><strong>' + escape(version.version_name) + '</strong> · ' +
    escape(version.version_code) + '<p>' + escape(version.notes) + '</p></div>' +
    button(version.access === "blocked" ? "Разрешить" : "Заблокировать", version.access === "blocked" ? "allow-version" : "block-version", version.version_code) + '</li>').join("");
  const cutoffCode = Number(config.min_version_code) - 1;
  const previous = (versions || []).find(item => item.version_code === cutoffCode);
  const cutoff = previous?.version_name || (cutoffCode >= 104 && cutoffCode <= 115 ? "1.0." + (cutoffCode - 100) : "");
  return card("Обязательное обновление", form("update-policy",
    '<label class="check"><input type="checkbox" name="enabled"' + checked(config.block_old_versions) + '>Блокировать старые версии</label>' +
    field("cutoff", "Запретить до версии включительно", "text", cutoff, 'placeholder="1.0.13" maxlength="24"') +
    '<p>Например, 1.0.13 заблокирует эту версию и все предыдущие. Для остальных версий добавьте запись о сборке в список ниже.</p>' +
    (config.block_old_versions && !cutoff ? '<p>Текущий порог задан кодом Android ' + escape(config.min_version_code) + '.</p>' : "") +
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
    'maxlength="50" placeholder="@id000001" required autocomplete="off"'), "Найти");
  if (!quotaId) return budget + card("Поиск по ID", search);
  const target = await resolveAccount(quotaId);
  const quota = target && data(await db.rpc("cortex_admin_ai", { p_subject: target }));
  if (!quota) return budget + card("Поиск по ID", search + "<p>Запись с этим ID не найдена.</p>");
  const summary = "<p>" + escape(quotaId) + " · " + escape(planNames[quota.plan] || "—") + "</p><p>Использовано " + dateNumber(quota.used) +
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
  if (/^@g\d{6,17}$/i.test(id)) return data(await db.rpc("cortex_admin_resolve_guest", { p_public: id }));
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
      case "recover": recover(""); break;
      case "password-visibility": {
        const password = app.querySelector('input[name="password"]');
        if (password) {
          const wasHidden = password.type === "password";
          password.type = wasHidden ? "text" : "password";
          control.textContent = wasHidden ? "Скрыть пароль" : "Показать пароль";
        }
        break;
      }
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
      case "copy-my-id":
        if (!ownId) break;
        try { await navigator.clipboard.writeText(ownId); flash("ID скопирован."); }
        catch { flash(ownId); }
        break;
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
  } catch (error) { flash(safeError(error)); }
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
      case "update-policy": {
        const enabled = formData.has("enabled");
        const url = read("url");
        if ((enabled || url) && !/^https:\/\//.test(url)) throw new Error("Укажите HTTPS-ссылку на обновление.");
        const cutoff = read("cutoff").replace(/^v/i, "");
        let code = null;
        if (enabled || cutoff) {
          const releases = cutoff ? data(await db.from("cortex_release_versions")
            .select("version_code,version_name").in("version_name", [cutoff, "v" + cutoff]).limit(20)) : [];
          code = releaseCode(cutoff, releases || []);
          if (code === null) throw new Error("Введите известный номер версии, например 1.0.13. Новую версию сначала добавьте в список сборок.");
        }
        if (enabled && !confirm("Заблокировать версию " + cutoff + " и все предыдущие?")) return;
        await saveConfig({ block_old_versions: enabled, ...(code === null ? {} : { min_version_code: code + 1 }), update_url: url });
        break;
      }
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
  } catch (error) { flash(safeError(error, ["signin", "send-recovery", "reset-password", "mfa"].includes(target.dataset.form) ? "auth" : "operation")); }
  finally { if (submitButton.isConnected) submitButton.disabled = false; }
});

initialize().catch(error => {
  showAuth("Не удалось подключиться", '<p>' + safeError(error) + '</p>' + button("Повторить", "refresh-auth") + button("Выйти", "logout"));
});

for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => { lastInteraction = Date.now(); }, { passive: true });
}

async function expireIdleSession() {
  if (signingOut || !user || Date.now() - lastInteraction <= IDLE_LIMIT_MS) return;
  signingOut = true;
  try {
    await db.auth.signOut({ scope: "local" });
    await initialize();
    flash("Сеанс завершён после 30 минут бездействия.");
  } catch {
    signIn();
  } finally { signingOut = false; lastInteraction = Date.now(); }
}

setInterval(expireIdleSession, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void expireIdleSession();
});

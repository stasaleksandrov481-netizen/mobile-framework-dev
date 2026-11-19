import { createClient } from "@supabase/supabase-js";
import { projectUrl, publishableKey } from "./project.js";
import { SUPPORT_PAGE_SIZE, supportPageBounds } from "./support-paging.js";
import { BETA_APK_BUCKET, BETA_SHARE_SECONDS, BetaInputError, parseBetaEmails,
  betaExpiryFromDays, isBetaInviteActive, betaApkNameIsSafe, validateBetaApk } from "./beta-utils.js";

const db = createClient(projectUrl, publishableKey, {
  auth: { flowType: "pkce", persistSession: true, storage: window.sessionStorage,
    detectSessionInUrl: true, autoRefreshToken: true }
});
const app = document.querySelector("#app");
const feedback = document.querySelector("#feedback");
const redirectTo = "https://cortex-control-phi.vercel.app/";
const labels = {
  overview: "Обзор", site: "Сайт", support: "Обращения", updates: "Версии", maintenance: "Техработы",
  beta: "ЗБТ", roles: "Доступы", quota: "Лимиты ИИ", billing: "Подписки", audit: "Журнал"
};
const ticketStates = { open: "Открыто", in_progress: "В работе", answered: "Есть ответ", closed: "Закрыто" };
const roles = { owner: "Владелец", admin: "Администратор", support: "Поддержка" };
const categories = { contact: "Вопрос", bug: "Ошибка", idea: "Идея", complaint: "Жалоба" };
let user, role, factor, enrollment, ticket, tab = "overview";
let renderVersion = 0, feedbackTimer;
let quotaId = "", supportFilter = "active", ownId = "";
let supportPage = 0, supportTotal = 0;
let betaShareLink = null, betaUploadReceipt = null;
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
  if (error instanceof BetaInputError) return error.message;
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
  if (previous !== user.id) { factor = enrollment = ticket = null; quotaId = ""; betaShareLink = betaUploadReceipt = null; }
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
  if (role === "admin") return ["overview", "site", "support", "updates", "maintenance", "beta", "quota", "billing", "audit"];
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
      '<div class="heading-tools"><span class="muted">' + (page === "overview" ? "Автообновление раз в минуту" : "Обновлено " +
        new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) + " МСК") +
      '</span>' + button("Обновить", "refresh") + '</div></div>' + html;
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

async function site() {
  // Aggregates only. The RPC checks the admin role, MFA and live auth session;
  // raw preregistration emails and user IDs must never reach the dashboard.
  const stats = data(await db.rpc("cortex_admin_site_metrics"));
  const summaries = [
    ["Подтверждённые предрегистрации", stats.total],
    ["Новые сегодня", stats.today],
    ["За последние 24 часа", stats.last_24h],
    ["Подписались на уведомления", stats.notifications]
  ];
  const summary = summaries.map(([label, value]) => '<section class="metric-card"><span class="metric-label">' +
    escape(label) + '</span><strong class="count">' + dateNumber(value) + '</strong></section>').join("");
  const days = Array.isArray(stats.daily) ? stats.daily : [];
  const maximum = Math.max(1, ...days.map(item => Math.max(0, Number(item.count) || 0)));
  const trend = days.map(item => {
    const count = Math.max(0, Number(item.count) || 0);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(item.day) ? item.day.split("-").reverse().slice(0, 2).join(".") : "—";
    return '<li><span>' + escape(day) + '</span><meter min="0" max="' + maximum + '" value="' +
      Math.min(count, maximum) + '" aria-label="Регистрации ' + escape(day) + '"></meter><strong>' +
      dateNumber(count) + '</strong></li>';
  }).join("");
  const links = '<div class="actions site-actions"><a href="https://cortexapp.ru/" target="_blank" rel="noopener noreferrer">Открыть сайт</a>' +
    '<a href="https://cortexapp.ru/api/status" target="_blank" rel="noopener noreferrer">Проверить статус сайта</a></div>';
  return '<div class="dashboard-intro"><div><span class="overline">CORTEX / WEB</span>' +
    '<h2>Сайт cortexapp.ru</h2><p>Подтверждённые регистрации, аналитика и состояние сайта.</p></div></div>' +
    '<div class="metrics-grid">' + summary + '</div>' +
    card("Регистрации за последние 7 дней", trend ? '<ul class="site-trend">' + trend + '</ul>' :
      '<p>Пока нет данных за период.</p>') +
    card("Посещения сайта", '<p>Счётчик уникальных посетителей пока не подключён. Здесь показаны только подтверждённые ' +
      'регистрации. Просмотры страниц и конверсию без отдельного сбора событий достоверно рассчитать нельзя.</p>') +
    card("Инструменты сайта", links + '<p class="muted">Статистика регистрации обновляется по кнопке «Обновить». ' +
      'Доступна только владельцу и администратору после MFA.</p>');
}

async function support() {
  const selected = ticket;
  const filters = { active: "Активные", open: "Открытые", in_progress: "В работе", answered: "С ответом", closed: "Закрытые" };
  const filterBar = '<div class="ticket-filters" aria-label="Статус обращений">' + Object.entries(filters).map(([id, label]) =>
    '<button type="button" data-action="ticket-filter" data-value="' + id + '" aria-pressed="' + (id === supportFilter) + '">' +
    label + '</button>').join("") + '</div>';
  const query = db.from("cortex_support").select("id,created_at,category,message,reply_to,app_version,status", { count: "exact" });
  const offset = supportPage * SUPPORT_PAGE_SIZE;
  const result = await (supportFilter === "active" ? query.neq("status", "closed") : query.eq("status", supportFilter))
    .order("created_at", { ascending: false }).range(offset, offset + SUPPORT_PAGE_SIZE - 1);
  const tickets = data(result) || [];
  supportTotal = result.count ?? 0;
  const paging = supportPageBounds(supportTotal, supportPage);
  if (paging.page !== supportPage) {
    supportPage = paging.page;
    ticket = null;
    return support();
  }
  if (!tickets.length) return filterBar + '<p>В этой категории нет обращений.</p>';
  const current = tickets.find(item => item.id === selected) || tickets[0];
  ticket = current.id;
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
  const pageControls = '<div class="ticket-pagination" aria-label="Страницы обращений"><span>Показаны ' +
    (paging.offset + 1) + '–' + paging.end + ' из ' + supportTotal + '</span>' +
    '<div><button type="button" data-action="ticket-page" data-value="prev"' +
    (paging.page === 0 ? " disabled" : "") + '>Назад</button>' +
    '<span> ' + (paging.page + 1) + ' / ' + paging.pages + ' </span>' +
    '<button type="button" data-action="ticket-page" data-value="next"' +
    (paging.page === paging.pages - 1 ? " disabled" : "") + '>Далее</button></div></div>';
  return filterBar + pageControls + '<div class="support-layout"><div class="ticket-list">' + list +
    '</div>' + card("Диалог", details) + '</div>';
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

async function closedBeta() {
  // Privileged RPC, not a client SELECT from cortex_beta_testers/devices.
  const [config, invites, storageResult] = await Promise.all([
    controlConfig(), db.rpc("cortex_admin_beta", { p_operation: "list" }).then(data),
    db.storage.from(BETA_APK_BUCKET).list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } })
  ]);
  const people = Array.isArray(invites) ? invites : [];
  const active = people.filter(person => isBetaInviteActive(person));
  const connected = people.reduce((sum, person) => sum + Number(person.devices || 0), 0);
  const files = storageResult.error ? [] : (storageResult.data || []).filter(file => betaApkNameIsSafe(file.name));
  const summary = [
    ["Закрытый доступ", config.beta_enabled ? "Включён" : "Выключен"],
    ["Активные приглашения", dateNumber(active.length)],
    ["Привязанные установки", dateNumber(connected)],
    ["Загруженные APK", storageResult.error ? "—" : dateNumber(files.length)]
  ].map(([label, value]) => '<section class="metric-card"><span class="metric-label">' + escape(label) +
    '</span><strong class="count beta-count">' + escape(value) + '</strong></section>').join("");

  const mode = card("Доступ к закрытому тесту", '<p class="muted">Когда ЗБТ включён, обычные пользователи без приглашения ' +
    'не смогут обращаться к серверному API CORTEX. Сначала добавьте тестировщиков, потом включайте режим.</p>' +
    form("beta-mode", '<label class="check"><input name="enabled" type="checkbox"' + checked(config.beta_enabled) +
      '>Включить доступ только по приглашениям</label>' +
      '<label>Сообщение при отказе<textarea name="message" maxlength="400" rows="2" required>' +
      escape(config.beta_message || "") + '</textarea></label>', "Сохранить режим") +
    '<p class="muted">Сейчас: <strong>' + (config.beta_enabled ? "ЗБТ включён" : "открытый режим") +
    '</strong>. Это отдельная настройка от тарифов, сайта и распространения APK.</p>');

  const invite = card("Пригласить тестировщиков", '<p class="muted">Вставьте до 50 почт через пробел, запятую или с новой строки. ' +
    'При повторной выдаче срок и лимит устройств обновятся, доступ восстановится.</p>' +
    form("beta-invite", '<label>Почты для приглашений<textarea name="emails" rows="4" maxlength="20000" ' +
      'placeholder="tester@example.com" required autocomplete="off"></textarea></label>' +
      field("devices", "Устройств на человека (1–5)", "number", 1, 'min="1" max="5" step="1" required') +
      field("days", "Срок действия (1–90 дней)", "number", 14, 'min="1" max="90" step="1" required'), "Выдать приглашения") +
    '<p class="muted">Приглашение даёт доступ к API в режиме ЗБТ, но не выдаёт платную подписку. ' +
    'Тестовый тариф назначается отдельно во вкладке «Подписки».</p>');

  const rows = people.map(person => {
    const valid = isBetaInviteActive(person);
    const status = person.state === "revoked" ? "Отозвано" : valid ? "Активно" : "Срок истёк";
    const expiry = person.expires_at ? date(person.expires_at) + " МСК" : "без срока";
    return '<li class="beta-person"><div><strong>' + escape(person.email) + '</strong>' +
      '<small>' + escape(status) + ' · до ' + escape(expiry) + ' · ' +
      dateNumber(person.devices) + ' из ' + dateNumber(person.max_devices) + ' устройств</small></div>' +
      '<div class="actions">' + (person.state === "revoked" ? button("Восстановить", "beta-restore", person.email) :
        button("Отозвать", "beta-revoke", person.email)) +
      button("Сбросить устройства", "beta-reset", person.email) + '</div></li>';
  }).join("");
  const testerList = card("Участники ЗБТ", '<p class="muted">Показаны до 200 последних приглашений. ' +
    'Изменения записываются в журнал действий администратора.</p>' +
    (rows ? '<ul class="record-list">' + rows + '</ul>' : '<p>Пока никого не пригласили. Ждём список почт.</p>'));

  const uploaded = betaUploadReceipt ? '<p class="beta-receipt">Последний загруженный файл: <strong>' +
    escape(betaUploadReceipt.name) + '</strong><br>SHA-256: <code>' + escape(betaUploadReceipt.hash) + '</code></p>' : "";
  const upload = card("Загрузить проверенный APK", '<p class="muted">Используйте только подписанный релизный APK. ' +
    'Перед загрузкой SHA-256 файла должен совпасть с контрольной суммой, опубликованной для этого релиза.</p>' +
    form("beta-apk", '<label>APK (до 150 МБ)<input type="file" name="apk" accept=".apk,application/vnd.android.package-archive" required></label>' +
      field("sha256", "SHA-256 из релиза (64 символа)", "text", "", 'minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" required autocomplete="off"'),
    "Проверить и загрузить") + uploaded +
    '<p class="muted"><a href="https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases" ' +
    'target="_blank" rel="noopener noreferrer">Официальные релизы и контрольные суммы</a>. ' +
    'Сертификат подписи APK здесь автоматически не проверяется.</p>');

  const buildList = files.map(file => '<li class="beta-file"><div><strong>' + escape(file.name) + '</strong>' +
    '<small>Добавлен ' + date(file.created_at) + ' МСК · ' +
    dateNumber(Math.round(Number(file.metadata?.size || 0) / 1048576 * 10) / 10) + ' МБ</small></div>' +
    button("Ссылка на 60 минут", "beta-share", file.name) + '</li>').join("");
  const sharing = betaShareLink ? '<div class="beta-receipt"><strong>Временная ссылка до ' +
    escape(date(betaShareLink.expiresAt)) + ' МСК</strong><p>' + escape(betaShareLink.name) + '</p>' +
    '<a href="' + escape(betaShareLink.url) + '" target="_blank" rel="noopener noreferrer">Открыть APK</a>' +
    '<p class="muted">Ссылка работает у любого получателя до истечения времени. Передавайте её только приглашённым участникам.</p></div>' : "";
  const builds = card("Выдача APK", '<p class="muted">Файлы хранятся в приватном хранилище. ' +
    'Создайте ссылку на час и отправьте приглашённому тестировщику лично. Сама по себе ссылка не даёт доступ к API.</p>' +
    (storageResult.error ? '<p>Не удалось получить список APK. Проверьте права хранилища и MFA.</p>' :
      buildList ? '<ul class="record-list">' + buildList + '</ul>' : '<p>APK пока не загружен.</p>') + sharing);

  return '<div class="dashboard-intro"><div><span class="overline">ЗАКРЫТОЕ БЕТА-ТЕСТИРОВАНИЕ</span>' +
    '<h2>Приглашения и сборки</h2><p>Доступ к API, лимиты устройств и приватная выдача Android APK.</p>' +
    '</div><span class="live-badge"><span class="status-dot"></span>' +
    (config.beta_enabled ? "Только по приглашениям" : "Режим не включён") + '</span></div>' +
    '<div class="metrics-grid">' + summary + '</div><div class="cards beta-cards">' + mode + invite +
    '</div>' + testerList + '<div class="cards beta-cards">' + upload + builds + '</div>';
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

const views = { overview, site, support, maintenance, updates, roles: access, beta: closedBeta,
  quota: quotas, billing: subscriptions, audit };

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
      case "ticket-filter": supportFilter = value; supportPage = 0; ticket = null; await loadTab(); break;
      case "ticket-page": {
        const paging = supportPageBounds(supportTotal, supportPage);
        const next = paging.page + (value === "next" ? 1 : -1);
        if ((value === "next" || value === "prev") && next >= 0 && next < paging.pages) {
          supportPage = next;
          ticket = null;
          await loadTab();
        }
        break;
      }
      case "beta-revoke":
      case "beta-restore":
      case "beta-reset": {
        if (!["owner", "admin"].includes(role)) break;
        const operation = { "beta-revoke": "revoke", "beta-restore": "restore", "beta-reset": "reset_devices" }[action];
        const question = { revoke: "Отозвать приглашение", restore: "Восстановить приглашение",
          reset_devices: "Сбросить все привязки устройств" }[operation];
        if (!confirm(question + " для " + value + "?")) break;
        data(await db.rpc("cortex_admin_beta", { p_operation: operation, p_email: value }));
        flash("Доступ тестировщика обновлён.");
        await loadTab();
        break;
      }
      case "beta-share": {
        if (!["owner", "admin"].includes(role)) break;
        if (!betaApkNameIsSafe(value)) throw new BetaInputError("Недопустимое имя APK.");
        const result = data(await db.storage.from(BETA_APK_BUCKET).createSignedUrl(value, BETA_SHARE_SECONDS, { download: true }));
        betaShareLink = { name: value, url: result.signedUrl, expiresAt: Date.now() + BETA_SHARE_SECONDS * 1000 };
        await loadTab();
        try {
          await navigator.clipboard.writeText(betaShareLink.url);
          flash("Ссылка на APK скопирована. Срок действия — 60 минут.");
        } catch { flash("Ссылка создана: откройте её в разделе «Выдача APK»."); }
        break;
      }
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
        if (!confirm((read("role") === "remove" ? "Отозвать административный доступ" : "Изменить административную роль") +
          " для " + read("email") + "?")) return;
        data(await db.rpc("cortex_set_admin_role", { p_email: read("email"), p_role: read("role") }));
        break;
      case "beta-mode": {
        if (!["owner", "admin"].includes(role)) return;
        const enabled = formData.has("enabled");
        const message = read("message");
        if (!message || message.length > 400) throw new BetaInputError("Укажите сообщение об ограничении доступа (до 400 символов).");
        const current = await controlConfig();
        if (enabled !== current.beta_enabled) {
          if (enabled) {
            const people = data(await db.rpc("cortex_admin_beta", { p_operation: "list" }));
            if (!people.some(person => isBetaInviteActive(person)))
              throw new BetaInputError("Нельзя включить ЗБТ без активных приглашений. Сначала добавьте тестировщиков.");
          }
          const question = enabled ?
            "Включить ЗБТ? Пользователи без приглашения потеряют доступ к API CORTEX." :
            "Выключить ЗБТ? Доступ к API снова откроется всем пользователям согласно обычным ограничениям.";
          if (!confirm(question)) return;
        }
        await saveConfig({ beta_enabled: enabled, beta_message: message });
        break;
      }
      case "beta-invite": {
        if (!["owner", "admin"].includes(role)) return;
        const emails = parseBetaEmails(read("emails"));
        const maxDevices = Number(read("devices"));
        if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 5)
          throw new BetaInputError("На одного участника можно разрешить от 1 до 5 устройств.");
        const expiry = betaExpiryFromDays(read("days"));
        if (!confirm("Выдать или продлить приглашения для " + emails.length + " почт?")) return;
        let completed = 0;
        try {
          for (const email of emails) {
            data(await db.rpc("cortex_admin_beta", {
              p_operation: "grant", p_email: email, p_max_devices: maxDevices, p_expires_at: expiry
            }));
            completed++;
          }
        } catch {
          await loadTab();
          throw new BetaInputError("Приглашено " + completed + " из " + emails.length + ". Проверьте список и повторите для остальных.");
        }
        flash("Приглашения выданы: " + completed + ".");
        await loadTab();
        return;
      }
      case "beta-apk": {
        if (!["owner", "admin"].includes(role)) return;
        const file = formData.get("apk");
        const expectedHash = validateBetaApk(file, read("sha256"));
        const firstBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (firstBytes[0] !== 0x50 || firstBytes[1] !== 0x4b || firstBytes[2] !== 0x03 || firstBytes[3] !== 0x04)
          throw new BetaInputError("Файл не похож на APK: отсутствует заголовок ZIP.");
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const actualHash = Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, "0")).join("");
        if (actualHash !== expectedHash) throw new BetaInputError("SHA-256 не совпал с релизом. APK не загружен.");
        const name = "cortex-" + Date.now() + ".apk";
        data(await db.storage.from(BETA_APK_BUCKET).upload(name, file, {
          contentType: "application/vnd.android.package-archive", upsert: false
        }));
        betaUploadReceipt = { name, hash: actualHash };
        flash("APK проверен по SHA-256 и загружен в закрытое хранилище.");
        await loadTab();
        return;
      }
      case "ai-config":
        data(await db.rpc("cortex_admin_ai", { p_operation: "configure", p_limit: 15000,
          p_day: read("day") ? Number(read("day")) : null, p_minute: read("minute") ? Number(read("minute")) : null,
          p_model: read("model") || null }));
        break;
      case "billing-plan":
        if (!confirm("Изменить тариф " + read("plan") + "? Новые условия могут повлиять на оплату и лимиты пользователей.")) return;
        await billingRpc("plan", { plan: read("plan"), price: Math.round(Number(read("price")) * 100),
          tokens: Number(read("tokens")), advanced: Number(read("advanced")), context: Number(read("context")) });
        break;
      case "billing-funding":
        if (!confirm("Изменить бюджет ИИ и состояние приёма платежей?")) return;
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
// Poll only the read-only overview while the tab is visible and the admin is active.
setInterval(() => {
  if (!document.hidden && user && role && tab === "overview" && !signingOut &&
      Date.now() - lastInteraction < IDLE_LIMIT_MS) void loadTab();
}, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void expireIdleSession();
});

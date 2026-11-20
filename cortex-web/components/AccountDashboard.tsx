"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { cortexAuth, registrationAcceptanceVersion, savePreregistration } from "@/lib/cortex-auth";
import { settleWithTimeout } from "@/lib/settle-with-timeout";
import { createLatestRequest } from "@/lib/latest-request";
import { validQuota, validReservation, resetLabel } from "@/lib/account-data";
import type { Quota, Reservation } from "@/lib/account-data";
import UiIcon from "@/components/UiIcon";

type Panel = "overview" | "profile" | "security";
const tones = ["graphite", "silver", "stone", "olive", "clay", "plum"] as const;
type Tone = typeof tones[number];
const numberFormat = new Intl.NumberFormat("ru-RU");

function avatarTone(raw: unknown): Tone {
  return typeof raw === "string" && tones.includes(raw as Tone) ? raw as Tone : "graphite";
}

function accountName(user: User): string {
  const metadataName = user.user_metadata?.cortex_display_name || user.user_metadata?.name;
  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim().slice(0, 40)
    : (user.email?.split("@")[0] || "Пользователь").slice(0, 40);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "C";
}

function Avatar({ name, tone, size = "medium" }: { name: string; tone: Tone; size?: "medium" | "large" }) {
  return <div className={`account-avatar account-avatar--${tone} account-avatar--${size}`} aria-hidden="true">
    {initials(name)}
  </div>;
}

export function AccountDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [authCheckError, setAuthCheckError] = useState("");
  const [authRetry, setAuthRetry] = useState(0);
  const [panel, setPanel] = useState<Panel>("overview");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");
  const [name, setName] = useState("");
  const [tone, setTone] = useState<Tone>("graphite");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [endingAllSessions, setEndingAllSessions] = useState(false);
  const [confirmAllSessions, setConfirmAllSessions] = useState(false);
  const [securityError, setSecurityError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsMessage, setNotificationsMessage] = useState("");
  const [notificationsError, setNotificationsError] = useState(false);
  const dataRequests = useRef(createLatestRequest());
  const notificationEdits = useRef(0);
  const notificationDraftDirty = useRef(false);

  const refreshData = useCallback(async (account: User) => {
    const requestId = dataRequests.current.begin();
    const notificationRevision = notificationEdits.current;
    setLoadingData(true);
    setDataError("");
    const isPreregistered = account.user_metadata?.cortex_preregistration === true;
    const legalVersion = isPreregistered ? registrationAcceptanceVersion(account.user_metadata) : null;
    const loadReservation = () => settleWithTimeout(cortexAuth.from("cortex_preregistrations")
      .select("bonus_tokens,bonus_spent,bonus_granted_at,registered_at,notify_opt_in")
      .eq("user_id", account.id).maybeSingle(), 8_000);
    try {
      // These requests are independent. A timeout in one must not hide valid
      // account data returned by the other (Promise.all would discard both).
      const [reservationSettled, quotaSettled, acceptanceSettled] = await Promise.allSettled([
        loadReservation(),
        settleWithTimeout(cortexAuth.rpc("cortex_web_account_usage"), 8_000),
        legalVersion ? settleWithTimeout(cortexAuth.from("cortex_registration_legal_acceptances")
          .select("document_version").eq("user_id", account.id).eq("document_version", legalVersion).maybeSingle(), 8_000) : null,
      ]);
      let reservationResponse = reservationSettled.status === "fulfilled"
        ? reservationSettled.value : { data: null, error: new Error("reservation unavailable") };
      const quotaResponse = quotaSettled.status === "fulfilled"
        ? quotaSettled.value : { data: null, error: new Error("usage unavailable") };
      const acceptance = acceptanceSettled.status === "fulfilled" ? acceptanceSettled.value : null;
      let recoveryFailed = Boolean(legalVersion && (!acceptance || acceptance.error));
      const missingReservation = !reservationResponse.error && !reservationResponse.data;
      const missingAcceptance = Boolean(acceptance && !acceptance.error && !acceptance.data);
      if (isPreregistered && (missingReservation || missingAcceptance)) {
        try {
          await settleWithTimeout(savePreregistration(account.user_metadata?.cortex_notify_opt_in === true, account.id), 12_000);
          if (missingReservation) reservationResponse = await loadReservation();
          recoveryFailed = !reservationResponse.data || Boolean(reservationResponse.error);
        } catch { recoveryFailed = true; }
      }
      if (!dataRequests.current.isCurrent(requestId)) return;
      // A failed API query is not the same as a zero balance.
      const reservationValid = reservationResponse.data === null || validReservation(reservationResponse.data);
      const quotaValid = validQuota(quotaResponse.data);
      if (!reservationResponse.error && validReservation(reservationResponse.data)) {
        const latest = reservationResponse.data;
        const preserveDraft = notificationDraftDirty.current || notificationEdits.current !== notificationRevision;
        setReservation(previous => ({
          ...latest,
          notify_opt_in: preserveDraft ? previous?.notify_opt_in ?? latest.notify_opt_in : latest.notify_opt_in,
        }));
        // A refresh must not discard an unsaved checkbox choice or the result
        // of a save completed while this request was in flight.
        if (!preserveDraft) {
          setNotificationsEnabled(latest.notify_opt_in);
        }
      } else if (!reservationResponse.error && reservationResponse.data === null) {
        setReservation(null);
      }
      if (!quotaResponse.error && quotaValid) setQuota(quotaResponse.data);
      if (reservationResponse.error || quotaResponse.error || recoveryFailed || !reservationValid || !quotaValid) {
        setDataError("Часть данных или подтверждение регистрации пока недоступны. Попробуйте обновить.");
      }
    } catch {
      if (!dataRequests.current.isCurrent(requestId)) return;
      // Retain the last verified values rather than making a temporary
      // outage look like the user lost their balance or preregistration.
      setDataError("Сервер временно недоступен. Последние загруженные данные могут устареть. Попробуйте обновить.");
    } finally {
      if (dataRequests.current.isCurrent(requestId)) setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const { data: { user: current }, error } = await settleWithTimeout(cortexAuth.auth.getUser(), 9_000);
        if (!active) return;
        if (error) {
          if (error.name !== "AuthSessionMissingError") {
            setAuthCheckError("Не удалось проверить аккаунт. Проверь соединение и попробуй ещё раз.");
            setChecking(false);
            return;
          }
        }
        if (!current?.id || !current.email || !current.email_confirmed_at) {
          router.replace("/register?mode=signin");
          return;
        }
        setUser(current);
        setName(accountName(current));
        setTone(avatarTone(current.user_metadata?.cortex_avatar_tone));
        setChecking(false);
        void refreshData(current);
      } catch {
        if (active) {
          setAuthCheckError("Сервер долго не отвечает. Попробуй обновить проверку аккаунта.");
          setChecking(false);
        }
      }
    };
    void boot();
    const { data: { subscription } } = cortexAuth.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        dataRequests.current.invalidate();
        router.replace("/register?mode=signin");
      }
    });
    return () => { active = false; dataRequests.current.invalidate(); subscription.unsubscribe(); };
  }, [router, refreshData, authRetry]);

  const displayName = useMemo(() => user ? accountName(user) : "", [user]);
  const currentTone = avatarTone(user?.user_metadata?.cortex_avatar_tone);
  const cleanName = name.trim().replace(/\s+/g, " ");
  const profileDirty = cleanName !== displayName || tone !== currentTone;
  const reserved = reservation?.bonus_tokens ?? 0;
  const granted = Boolean(reservation?.bonus_granted_at);
  const remainingBonus = Math.max(0, reserved - (reservation?.bonus_spent ?? 0));

  async function saveProfile() {
    if (!user || saving || !profileDirty) return;
    if (cleanName.length < 2 || cleanName.length > 40) {
      setProfileError("Имя должно содержать от 2 до 40 символов.");
      return;
    }
    setSaving(true);
    setProfileError("");
    setProfileSaved(false);
    try {
      const { data, error } = await settleWithTimeout(cortexAuth.auth.updateUser({
        // Android currently reads user_metadata.name for its account label.
        data: { name: cleanName, cortex_display_name: cleanName, cortex_avatar_tone: tone },
      }), 12_000);
      if (error || !data.user) throw new Error();
      setUser(data.user);
      setName(cleanName);
      setProfileSaved(true);
    } catch {
      setProfileError("Не получилось сохранить профиль. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setProfileError("");
    try {
      const { error } = await settleWithTimeout(cortexAuth.auth.signOut({ scope: "local" }), 12_000);
      if (error) throw error;
      router.replace("/");
    } catch {
      setSigningOut(false);
      setProfileError("Не удалось выйти из аккаунта. Повторите попытку.");
    }
  }

  async function signOutEverywhere() {
    if (!user || endingAllSessions || !confirmAllSessions) return;
    setEndingAllSessions(true);
    setSecurityError("");
    try {
      const { error } = await settleWithTimeout(cortexAuth.auth.signOut({ scope: "global" }), 12_000);
      if (error) throw error;
      router.replace("/register?mode=signin");
    } catch {
      setSecurityError("Не удалось завершить все сеансы. Повторите попытку.");
      setEndingAllSessions(false);
      setConfirmAllSessions(false);
    }
  }

  async function saveNotifications() {
    if (!user || !reservation || savingNotifications) return;
    setSavingNotifications(true);
    setNotificationsMessage("");
    setNotificationsError(false);
    try {
      const { data, error } = await settleWithTimeout(cortexAuth.from("cortex_preregistrations")
        .update({ notify_opt_in: notificationsEnabled })
        .eq("user_id", user.id).select("notify_opt_in").single(), 12_000);
      if (error || !data || data.notify_opt_in !== notificationsEnabled) throw new Error();
      notificationEdits.current++;
      notificationDraftDirty.current = false;
      setReservation(previous => previous ? { ...previous, notify_opt_in: data.notify_opt_in } : previous);
      setNotificationsMessage("Настройка уведомлений сохранена.");
    } catch {
      setNotificationsError(true);
      setNotificationsMessage("Не удалось сохранить настройку. Повторите попытку.");
    } finally { setSavingNotifications(false); }
  }

  if (checking) return <div className="account-gate" role="status" aria-label="Загружаем личный кабинет">
    <img src="/cortex-mark.svg" width="53" height="53" alt="CORTEX" />
  </div>;

  if (authCheckError) return <main className="account-unavailable">
    <img src="/cortex-mark.svg" width="47" height="47" alt="CORTEX" />
    <h1>Не удалось загрузить кабинет.</h1>
    <p role="alert">{authCheckError}</p>
    <button type="button" onClick={() => { setAuthCheckError(""); setChecking(true); setAuthRetry(n => n + 1); }}>Повторить</button>
    <Link href="/register?mode=signin">Вернуться ко входу</Link>
  </main>;

  return (
    <div className="account-shell">
      <aside className="account-sidebar" aria-label="Меню кабинета">
        <Link href="/account" className="account-brand"><img src="/cortex-mark.svg" width="29" height="29" alt="" /><span>CORTEX</span></Link>
        <div className="account-sidebar-section">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="account-nav" aria-label="Разделы кабинета">
          <button type="button" className={panel === "overview" ? "is-active" : ""} aria-current={panel === "overview" ? "page" : undefined} onClick={() => setPanel("overview")}>Обзор</button>
          <button type="button" className={panel === "profile" ? "is-active" : ""} aria-current={panel === "profile" ? "page" : undefined} onClick={() => setPanel("profile")}>Мой профиль</button>
          <button type="button" className={panel === "security" ? "is-active" : ""} aria-current={panel === "security" ? "page" : undefined} onClick={() => setPanel("security")}>Безопасность</button>
          <Link href="/pricing">Тарифы и лимиты <UiIcon name="arrow-up-right" size={15} /></Link>
          <Link href="/support">Поддержка <UiIcon name="arrow-up-right" size={15} /></Link>
        </nav>
        <div className="account-sidebar-bottom">
          <div className="account-sidebar-user"><Avatar name={displayName} tone={currentTone} /><div><strong>{displayName}</strong><span>{user?.email}</span></div></div>
          <button className="account-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Выходим…" : "Выйти из аккаунта"}</button>
        </div>
      </aside>

      <div className="account-content">
        <header className="account-topbar">
          <Link href="/account" className="account-mobile-brand"><img src="/cortex-mark.svg" width="26" height="26" alt="" /> CORTEX</Link>
          <span>{panel === "overview" ? "Личный кабинет" : panel === "profile" ? "Настройки профиля" : "Безопасность аккаунта"}</span>
          <span className="account-topbar-status"><span className="account-status-dot" /> Аккаунт активен</span>
        </header>
        <nav className="account-mobile-tabs" aria-label="Разделы кабинета на телефоне">
          <button type="button" aria-current={panel === "overview" ? "page" : undefined} className={panel === "overview" ? "is-active" : ""} onClick={() => setPanel("overview")}>Обзор</button>
          <button type="button" aria-current={panel === "profile" ? "page" : undefined} className={panel === "profile" ? "is-active" : ""} onClick={() => setPanel("profile")}>Профиль</button>
          <button type="button" aria-current={panel === "security" ? "page" : undefined} className={panel === "security" ? "is-active" : ""} onClick={() => setPanel("security")}>Защита</button>
          <Link href="/pricing">Тарифы</Link>
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>Выйти</button>
        </nav>

        <main className="account-main">
          {panel === "overview" ? <>
            <div className="account-eyebrow">CORTEX / МОЙ АККАУНТ</div>
            <div className="account-title-row"><div><h1>Привет, {displayName.split(" ")[0]}.</h1><p>Все важное о твоём аккаунте в одном месте.</p></div><div className="account-title-actions"><button type="button" className="account-outline-button" disabled={loadingData} onClick={() => user && void refreshData(user)}>{loadingData ? "Обновляем…" : "Обновить данные"}</button><button type="button" className="account-outline-button" onClick={() => setPanel("profile")}>Настроить профиль <UiIcon name="arrow-right" size={15} /></button></div></div>

            <div className="account-overview-grid">
              <section className="account-panel account-token-panel" aria-label="Баланс ИИ-токенов">
                <div className="account-panel-overline"><span>ИИ-ТОКЕНЫ</span><span className="account-panel-indicator">{quota?.plan?.toUpperCase() || "FREE"}</span></div>
                {/* Keep the last verified balance visible during refreshes. */}
                {quota ? <>
                  <div className="account-big-number">{quota.unlimited ? "∞" : numberFormat.format(quota.remaining ?? 0)}</div>
                  <p className="account-muted">{quota.unlimited ? "Доступно без дневного лимита" : "Доступно для ИИ-запросов сейчас"}</p>
                  {!quota.unlimited && <div className="account-token-progress" role="progressbar" aria-label="Использовано токенов сегодня" aria-valuemin={0} aria-valuemax={Math.max(1, quota.daily_limit)} aria-valuenow={Math.min(quota.daily_limit, Math.max(0, quota.used))}><span style={{ width: `${Math.min(100, Math.max(0, quota.used / Math.max(1, quota.daily_limit) * 100))}%` }} /></div>}
                  <div className={`account-token-caption${quota.unlimited ? " account-token-caption--unlimited" : ""}`}><span>Потрачено сегодня: {numberFormat.format(quota.used)}</span><span>Лимит: {quota.unlimited ? "∞" : numberFormat.format(quota.daily_limit)}</span></div>
                  <div className="account-reset-label">Обновление лимита: {resetLabel(quota.reset_at)}</div>
                </> : loadingData ? <div className="account-big-number account-big-number--loading" role="status">…</div> : <><div className="account-big-number">—</div><p className="account-muted">Данные о доступных токенах пока не получены.</p></>}
                <div className="account-card-footnote">Дневной лимит и бонусные токены учитываются отдельно. <Link href="/pricing">Как работают лимиты <UiIcon name="arrow-up-right" size={13} /></Link></div>
              </section>

              <section className="account-panel account-bonus-panel" aria-label="Бонус за раннюю регистрацию">
                <div className="account-panel-overline"><span>РАННИЙ ДОСТУП</span><span className="account-panel-indicator">{granted ? "НАЧИСЛЕНО" : "РЕЗЕРВ"}</span></div>
                <div className="account-bonus-mark"><UiIcon name="check" size={22} /></div>
                <div className="account-bonus-number">{loadingData && !reservation ? "…" : reservation ? `${granted ? "" : "+"}${numberFormat.format(granted ? remainingBonus : reserved)}` : "—"}</div>
                <p className="account-muted">{granted ? "Осталось бонусных ИИ-токенов" : "Бонусных ИИ-токенов зарезервировано"}</p>
                <div className="account-bonus-divider" />
                <p className="account-bonus-note">{!reservation && loadingData ? "Загружаем бонусы аккаунта…" : !reservation ? "Для этого аккаунта подтверждённый бонус пока не найден." : granted ? "Бонус начислен. Его остаток уже учтён в общем доступном балансе." : "Бонус станет доступен после запуска приложения и входа в него с этой почтой."}</p>
              </section>
            </div>

            {dataError && <div className="account-data-alert" role="status">{dataError} <button type="button" disabled={loadingData} onClick={() => user && void refreshData(user)}>Обновить</button></div>}
            {profileError && <div className="account-data-alert" role="alert">{profileError}</div>}

            <div className="account-bottom-grid">
              <section className="account-panel account-status-panel"><div className="account-small-label">СТАТУС АККАУНТА</div><div className="account-status-heading"><span className="account-status-icon"><UiIcon name="check" size={21} /></span><div><strong>Почта подтверждена</strong><span>{user?.email}</span></div></div><p>Аккаунт CORTEX готов. При входе в приложение используй эту же почту, чтобы сохранить свои бонусы и подписку.</p><button type="button" className="account-text-button" onClick={() => setPanel("profile")}>Данные профиля <UiIcon name="arrow-right" size={15} /></button></section>
              <section className="account-panel account-status-panel"><div className="account-small-label">ПРИЛОЖЕНИЕ</div><div className="account-status-heading"><span className="account-status-icon account-status-icon--soft"><UiIcon name="clock" size={21} /></span><div><strong>CORTEX для Android</strong><span>Скачивание пока закрыто</span></div></div><p>Пока можешь настроить профиль и посмотреть тарифы. Дату открытия скачивания объявим в канале CORTEX.</p><a className="account-text-button" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Новости запуска <UiIcon name="arrow-up-right" size={15} /></a></section>
            </div>
          </> : panel === "profile" ? <>
            <div className="account-eyebrow">CORTEX / ПРОФИЛЬ</div>
            <div className="account-title-row"><div><h1>Твой профиль.</h1><p>Настройки сохраняются в аккаунте и доступны при следующем входе.</p></div>{!saving && profileDirty && <span className="account-dirty-indicator" role="status">Есть несохранённые изменения</span>}</div>
            <section className="account-panel account-profile-panel">
              <div className="account-profile-head"><Avatar name={name || displayName} tone={tone} size="large" /><div><strong>{name.trim() || displayName}</strong><span>{user?.email}</span><div className="account-verified"><UiIcon name="check" size={13} /> Почта подтверждена</div></div></div>
              <div className="account-profile-divider" />
              <div className="account-field"><label htmlFor="account-display-name">Имя в CORTEX</label><input id="account-display-name" value={name} maxLength={40} autoComplete="nickname" disabled={saving} onChange={e => { setName(e.target.value); setProfileSaved(false); }} placeholder="Как к тебе обращаться" /><span>Такое имя будет отображаться в личном кабинете.</span></div>
              <fieldset className="account-avatar-picker" disabled={saving}><legend>Аватар профиля</legend><p>Выбери цвет. Инициалы будут обновляться вместе с именем.</p><div className="account-avatar-options">{tones.map(option => <button key={option} type="button" aria-label={`Выбрать аватар ${option}`} aria-pressed={tone === option} className={tone === option ? "is-selected" : ""} onClick={() => { setTone(option); setProfileSaved(false); }}><Avatar name={name || displayName} tone={option} /></button>)}</div></fieldset>
              <div className="account-field"><label htmlFor="account-email">Электронная почта</label><input id="account-email" value={user?.email || ""} type="email" readOnly /><span>Почта подтверждена. Здесь её нельзя изменить случайно.</span></div>
              {reservation && <div className="account-notification-setting">
                <label htmlFor="account-launch-notifications"><input id="account-launch-notifications" type="checkbox" checked={notificationsEnabled} disabled={savingNotifications} onChange={event => { notificationEdits.current++; notificationDraftDirty.current = event.target.checked !== reservation.notify_opt_in; setNotificationsEnabled(event.target.checked); setNotificationsMessage(""); setNotificationsError(false); }} /><span>Сообщить мне по почте о запуске CORTEX</span></label>
                <p>Необязательное уведомление. Выбор сохраняется в аккаунте и не влияет на системные письма.</p>
                <button type="button" className="account-outline-button" disabled={savingNotifications || reservation.notify_opt_in === notificationsEnabled} onClick={() => void saveNotifications()}>{savingNotifications ? "Сохраняем…" : "Сохранить уведомления"}</button>
                {notificationsMessage && <p role={notificationsError ? "alert" : "status"} className={`account-notification-message${notificationsError ? " is-error" : ""}`}>{notificationsMessage}</p>}
              </div>}
              {!reservation && dataError && <div className="account-profile-data-error" role="status">Настройки уведомлений пока недоступны. <button type="button" disabled={loadingData} onClick={() => user && void refreshData(user)}>Повторить загрузку</button></div>}
              {profileError && <p className="account-form-error" role="alert">{profileError}</p>}
              {profileSaved && <p className="account-form-success" role="status"><UiIcon name="check" size={15} /> Профиль сохранён</p>}
              <div className="account-profile-actions"><button type="button" disabled={saving || !profileDirty} className="account-save-button" onClick={() => void saveProfile()}>{saving ? "Сохраняем…" : "Сохранить изменения"} <UiIcon name="arrow-right" size={16} /></button><button type="button" className="account-cancel-button" disabled={saving || !profileDirty} onClick={() => { setName(displayName); setTone(currentTone); setProfileError(""); setProfileSaved(false); }}>Сбросить изменения</button></div>
            </section>
          </> : <>
            <div className="account-eyebrow">CORTEX / БЕЗОПАСНОСТЬ</div>
            <div className="account-title-row"><div><h1>Безопасность.</h1><p>Управляй доступом к аккаунту и активными входами.</p></div></div>
            <section className="account-panel account-security-panel" aria-labelledby="account-session-heading">
              <div className="account-small-label">УЧЁТНАЯ ЗАПИСЬ</div>
              <h2 id="account-session-heading">Доступ к аккаунту</h2>
              <dl className="account-security-details">
                <div><dt>Почта</dt><dd>{user?.email}</dd></div>
                <div><dt>Подтверждение</dt><dd>Почта подтверждена</dd></div>
                <div><dt>Последний вход</dt><dd>{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "Нет данных"}</dd></div>
              </dl>
              <div className="account-security-danger">
                <h3>Завершить все сеансы</h3>
                <p>Отозвать доступ на других устройствах и выйти из текущего аккаунта. Для повторного входа потребуется авторизация.</p>
                {!confirmAllSessions ? (
                  <button type="button" className="account-outline-button" onClick={() => { setConfirmAllSessions(true); setSecurityError(""); }}>Завершить все сеансы</button>
                ) : (
                  <div className="account-security-confirm" role="group" aria-label="Подтверждение завершения сеансов">
                    <p>Точно выйти на всех устройствах?</p>
                    <div className="account-security-actions">
                      <button type="button" className="account-save-button" disabled={endingAllSessions} onClick={() => void signOutEverywhere()}>{endingAllSessions ? "Завершаем…" : "Да, завершить"}</button>
                      <button type="button" className="account-cancel-button" disabled={endingAllSessions} onClick={() => setConfirmAllSessions(false)}>Отмена</button>
                    </div>
                  </div>
                )}
                {securityError && <p className="account-form-error" role="alert">{securityError}</p>}
              </div>
            </section>
          </>}
        </main>
        <footer className="account-footer"><span>© 2026 CORTEX</span><div><Link href="/privacy">Конфиденциальность</Link><Link href="/terms">Условия</Link><a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a></div></footer>
      </div>
    </div>
  );
}

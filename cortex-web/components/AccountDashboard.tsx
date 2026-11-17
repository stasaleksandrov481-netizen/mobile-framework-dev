"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { cortexAuth } from "@/lib/cortex-auth";
import UiIcon from "@/components/UiIcon";

type Panel = "overview" | "profile";
type Reservation = {
  bonus_tokens: number;
  bonus_spent: number;
  bonus_granted_at: string | null;
  registered_at: string;
  notify_opt_in: boolean;
};
type Quota = {
  daily_limit: number;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  plan: string;
  reset_at: string;
  bonus_remaining: number;
};

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

function validReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Reservation>;
  return Number.isSafeInteger(item.bonus_tokens) && Number.isSafeInteger(item.bonus_spent)
    && typeof item.registered_at === "string"
    && typeof item.notify_opt_in === "boolean"
    && (item.bonus_granted_at === null || typeof item.bonus_granted_at === "string");
}

function validQuota(value: unknown): value is Quota {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Quota>;
  return Number.isSafeInteger(item.daily_limit) && Number.isSafeInteger(item.used)
    && (item.remaining === null || Number.isSafeInteger(item.remaining))
    && typeof item.unlimited === "boolean" && typeof item.plan === "string"
    && typeof item.reset_at === "string" && Number.isSafeInteger(item.bonus_remaining);
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
  const [panel, setPanel] = useState<Panel>("overview");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");
  const [name, setName] = useState("");
  const [tone, setTone] = useState<Tone>("graphite");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  const refreshData = useCallback(async (accountId: string) => {
    setLoadingData(true);
    setDataError("");
    try {
      const [reservationResponse, quotaResponse] = await Promise.all([
        cortexAuth.from("cortex_preregistrations")
          .select("bonus_tokens,bonus_spent,bonus_granted_at,registered_at,notify_opt_in")
          .eq("user_id", accountId).maybeSingle(),
        cortexAuth.rpc("cortex_web_account_usage"),
      ]);
      // A failed API query is not the same as a zero balance.
      setReservation(!reservationResponse.error && validReservation(reservationResponse.data) ? reservationResponse.data : null);
      setQuota(!quotaResponse.error && validQuota(quotaResponse.data) ? quotaResponse.data : null);
      if (reservationResponse.error || quotaResponse.error) setDataError("Часть данных пока недоступна. Попробуйте обновить.");
    } catch {
      setReservation(null);
      setQuota(null);
      setDataError("Не удалось связаться с сервером. Проверьте соединение и обновите данные.");
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const { data: { user: current }, error } = await cortexAuth.auth.getUser();
        if (!active) return;
        if (error || !current?.id || !current.email || !current.email_confirmed_at) {
          router.replace("/register?mode=signin");
          return;
        }
        setUser(current);
        setName(accountName(current));
        setTone(avatarTone(current.user_metadata?.cortex_avatar_tone));
        setChecking(false);
        void refreshData(current.id);
      } catch {
        if (active) router.replace("/register?mode=signin");
      }
    };
    void boot();
    const { data: { subscription } } = cortexAuth.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") router.replace("/register?mode=signin");
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [router, refreshData]);

  const displayName = useMemo(() => user ? accountName(user) : "", [user]);
  const currentTone = avatarTone(user?.user_metadata?.cortex_avatar_tone);
  const reserved = reservation?.bonus_tokens ?? 0;
  const granted = Boolean(reservation?.bonus_granted_at);
  const remainingBonus = Math.max(0, reserved - (reservation?.bonus_spent ?? 0));
  const currentDate = new Date();
  const releaseDate = new Date("2026-11-20T00:00:00+03:00");
  const untilRelease = currentDate.getTime() < releaseDate.getTime();

  async function saveProfile() {
    if (!user || saving) return;
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2 || cleanName.length > 40) {
      setProfileError("Имя должно содержать от 2 до 40 символов.");
      return;
    }
    setSaving(true);
    setProfileError("");
    setProfileSaved(false);
    try {
      const { data, error } = await cortexAuth.auth.updateUser({
        // Android currently reads user_metadata.name for its account label.
        data: { name: cleanName, cortex_display_name: cleanName, cortex_avatar_tone: tone },
      });
      if (error || !data.user) throw new Error();
      setUser(data.user);
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
      const { error } = await cortexAuth.auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/");
    } catch {
      setSigningOut(false);
      setProfileError("Не удалось выйти из аккаунта. Повторите попытку.");
    }
  }

  if (checking) return <div className="account-gate" role="status" aria-label="Загружаем личный кабинет">
    <img src="/cortex-mark.svg" width="53" height="53" alt="CORTEX" />
  </div>;

  return (
    <div className="account-shell">
      <aside className="account-sidebar" aria-label="Меню кабинета">
        <Link href="/account" className="account-brand"><img src="/cortex-mark.svg" width="29" height="29" alt="" /><span>CORTEX</span></Link>
        <div className="account-sidebar-section">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="account-nav" aria-label="Разделы кабинета">
          <button type="button" className={panel === "overview" ? "is-active" : ""} aria-current={panel === "overview" ? "page" : undefined} onClick={() => setPanel("overview")}>Обзор</button>
          <button type="button" className={panel === "profile" ? "is-active" : ""} aria-current={panel === "profile" ? "page" : undefined} onClick={() => setPanel("profile")}>Мой профиль</button>
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
          <span>{panel === "overview" ? "Личный кабинет" : "Настройки профиля"}</span>
          <span className="account-topbar-status"><span className="account-status-dot" /> Аккаунт активен</span>
        </header>
        <nav className="account-mobile-tabs" aria-label="Разделы кабинета на телефоне">
          <button type="button" aria-current={panel === "overview" ? "page" : undefined} className={panel === "overview" ? "is-active" : ""} onClick={() => setPanel("overview")}>Обзор</button>
          <button type="button" aria-current={panel === "profile" ? "page" : undefined} className={panel === "profile" ? "is-active" : ""} onClick={() => setPanel("profile")}>Профиль</button>
          <Link href="/pricing">Тарифы</Link>
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>Выйти</button>
        </nav>

        <main className="account-main">
          {panel === "overview" ? <>
            <div className="account-eyebrow">CORTEX / МОЙ АККАУНТ</div>
            <div className="account-title-row"><div><h1>Привет, {displayName.split(" ")[0]}.</h1><p>Все важное о твоём аккаунте в одном месте.</p></div><button type="button" className="account-outline-button" onClick={() => setPanel("profile")}>Настроить профиль <UiIcon name="arrow-right" size={15} /></button></div>

            <div className="account-overview-grid">
              <section className="account-panel account-token-panel" aria-label="Баланс ИИ-токенов">
                <div className="account-panel-overline"><span>ИИ-ТОКЕНЫ</span><span className="account-panel-indicator">{quota?.plan?.toUpperCase() || "FREE"}</span></div>
                {loadingData ? <div className="account-big-number account-big-number--loading">…</div> : quota ? <>
                  <div className="account-big-number">{quota.unlimited ? "∞" : numberFormat.format(quota.remaining ?? 0)}</div>
                  <p className="account-muted">{quota.unlimited ? "Доступно без дневного лимита" : "Доступно для ИИ-запросов сейчас"}</p>
                  <div className="account-token-progress" role="progressbar" aria-label="Использовано токенов сегодня" aria-valuemin={0} aria-valuemax={Math.max(1, quota.daily_limit)} aria-valuenow={Math.min(quota.daily_limit, Math.max(0, quota.used))}><span style={{ width: `${Math.min(100, Math.max(0, quota.used / Math.max(1, quota.daily_limit) * 100))}%` }} /></div>
                  <div className="account-token-caption"><span>Потрачено сегодня: {numberFormat.format(quota.used)}</span><span>Лимит: {quota.unlimited ? "∞" : numberFormat.format(quota.daily_limit)}</span></div>
                </> : <><div className="account-big-number">—</div><p className="account-muted">Данные о доступных токенах пока не получены.</p></>}
                <div className="account-card-footnote">Дневной лимит и бонусные токены учитываются отдельно. <Link href="/pricing">Как работают лимиты <UiIcon name="arrow-up-right" size={13} /></Link></div>
              </section>

              <section className="account-panel account-bonus-panel" aria-label="Бонус за раннюю регистрацию">
                <div className="account-panel-overline"><span>РАННИЙ ДОСТУП</span><span className="account-panel-indicator">{granted ? "НАЧИСЛЕНО" : "РЕЗЕРВ"}</span></div>
                <div className="account-bonus-mark"><UiIcon name="check" size={22} /></div>
                <div className="account-bonus-number">{loadingData ? "…" : reserved ? `+${numberFormat.format(granted ? remainingBonus : reserved)}` : "—"}</div>
                <p className="account-muted">{granted ? "Осталось бонусных ИИ-токенов" : "Бонусных ИИ-токенов зарезервировано"}</p>
                <div className="account-bonus-divider" />
                <p className="account-bonus-note">{!reservation && !loadingData ? "Для этого аккаунта подтверждённый бонус пока не найден." : granted ? "Бонус начислен. Его остаток уже учтён в общем доступном балансе." : untilRelease ? "Будут доступны после запуска открытой беты 20 ноября." : "Бонус станет доступен после подтверждения аккаунта в приложении."}</p>
              </section>
            </div>

            {dataError && <div className="account-data-alert" role="status">{dataError} <button type="button" disabled={loadingData} onClick={() => user && void refreshData(user.id)}>Обновить</button></div>}
            {profileError && <div className="account-data-alert" role="alert">{profileError}</div>}

            <div className="account-bottom-grid">
              <section className="account-panel account-status-panel"><div className="account-small-label">СТАТУС АККАУНТА</div><div className="account-status-heading"><span className="account-status-icon"><UiIcon name="check" size={21} /></span><div><strong>Почта подтверждена</strong><span>{user?.email}</span></div></div><p>Аккаунт CORTEX готов. При входе в приложение используй эту же почту, чтобы сохранить свои бонусы и подписку.</p><button type="button" className="account-text-button" onClick={() => setPanel("profile")}>Данные профиля <UiIcon name="arrow-right" size={15} /></button></section>
              <section className="account-panel account-status-panel"><div className="account-small-label">ПРИЛОЖЕНИЕ</div><div className="account-status-heading"><span className="account-status-icon account-status-icon--soft"><UiIcon name="clock" size={21} /></span><div><strong>{untilRelease ? "Открытая бета — 20 ноября" : "CORTEX для Android"}</strong><span>{untilRelease ? "Осталось совсем немного" : "Управляй телефоном голосом"}</span></div></div><p>{untilRelease ? "Пока можешь настроить профиль и посмотреть тарифы. Когда приложение станет доступно, сообщим в нашем канале." : "Официальные обновления, инструкции и информация о доступности приложения в канале разработчиков."}</p><a className="account-text-button" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">Новости запуска <UiIcon name="arrow-up-right" size={15} /></a></section>
            </div>
          </> : <>
            <div className="account-eyebrow">CORTEX / ПРОФИЛЬ</div>
            <div className="account-title-row"><div><h1>Твой профиль.</h1><p>Настройки сохраняются в аккаунте и доступны при следующем входе.</p></div></div>
            <section className="account-panel account-profile-panel">
              <div className="account-profile-head"><Avatar name={name || displayName} tone={tone} size="large" /><div><strong>{displayName}</strong><span>{user?.email}</span><div className="account-verified"><UiIcon name="check" size={13} /> Почта подтверждена</div></div></div>
              <div className="account-profile-divider" />
              <div className="account-field"><label htmlFor="account-display-name">Имя в CORTEX</label><input id="account-display-name" value={name} maxLength={40} autoComplete="nickname" onChange={e => { setName(e.target.value); setProfileSaved(false); }} placeholder="Как к тебе обращаться" /><span>Такое имя будет отображаться в личном кабинете.</span></div>
              <fieldset className="account-avatar-picker"><legend>Аватар профиля</legend><p>Выбери цвет. Инициалы будут обновляться вместе с именем.</p><div className="account-avatar-options">{tones.map(option => <button key={option} type="button" aria-label={`Выбрать аватар ${option}`} aria-pressed={tone === option} className={tone === option ? "is-selected" : ""} onClick={() => { setTone(option); setProfileSaved(false); }}><Avatar name={name || displayName} tone={option} /></button>)}</div></fieldset>
              <div className="account-field"><label htmlFor="account-email">Электронная почта</label><input id="account-email" value={user?.email || ""} type="email" readOnly /><span>Почта подтверждена. Здесь её нельзя изменить случайно.</span></div>
              {profileError && <p className="account-form-error" role="alert">{profileError}</p>}
              {profileSaved && <p className="account-form-success" role="status"><UiIcon name="check" size={15} /> Профиль сохранён</p>}
              <div className="account-profile-actions"><button type="button" disabled={saving} className="account-save-button" onClick={() => void saveProfile()}>{saving ? "Сохраняем…" : "Сохранить изменения"} <UiIcon name="arrow-right" size={16} /></button><button type="button" className="account-cancel-button" onClick={() => { setName(displayName); setTone(currentTone); setProfileError(""); setProfileSaved(false); }}>Сбросить изменения</button></div>
            </section>
          </>}
        </main>
        <footer className="account-footer"><span>© 2026 CORTEX</span><div><Link href="/privacy">Конфиденциальность</Link><Link href="/terms">Условия</Link><a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a></div></footer>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { cortexAuth } from "@/lib/cortex-auth";

type LinkState = "loading" | "none" | "pending" | "linked" | "expired";
type LinkStatus = {
  state: LinkState; username?: string | null; name?: string | null;
  expires_at?: string | null; url?: string; error?: string;
};

const linkEndpoint = "/api/telegram/link";
function safeTelegramUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://t.me" &&
      /^\/[A-Za-z0-9_]{5,32}$/.test(url.pathname) &&
      /^link_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("start") || "") &&
      [...url.searchParams.keys()].length === 1 ? url.href : null;
  } catch { return null; }
}
function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "retry_later") return "Новый запрос можно создать через 20 секунд.";
  if (code === "already_linked") return "Telegram уже привязан к этому аккаунту.";
  if (code === "not_verified") return "Открой ссылку в Telegram и подтверди аккаунт, затем попробуй ещё раз.";
  if (code === "login_required") return "Сеанс входа истёк. Войди в аккаунт повторно.";
  return "Не удалось выполнить действие. Попробуй позже.";
}

export function TelegramSecurityLink({ active }: { active: boolean }) {
  const [state, setState] = useState<LinkStatus>({ state: "loading" });
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const request = useCallback(async (method: "GET" | "POST" | "DELETE", action?: "create") => {
    const { data: { session } } = await cortexAuth.auth.getSession();
    if (!session?.access_token) throw new Error("login_required");
    const response = await fetch(linkEndpoint, {
      method, cache: "no-store", credentials: "same-origin",
      headers: {
        Authorization: "Bearer " + session.access_token,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
      signal: AbortSignal.timeout(14_000),
    });
    const value: unknown = await response.json();
    const data = value && typeof value === "object" && !Array.isArray(value)
      ? value as LinkStatus : null;
    if (!response.ok || !data || !data.state) throw new Error(data?.error || "link_unavailable");
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await request("GET");
      setState(current);
      if (current.state !== "pending") setLinkUrl(null);
    } catch (err) {
      setError(errorText(err));
      setState(previous => previous.state === "loading" ? { state: "none" } : previous);
    }
  }, [request]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (!active || (state.state !== "pending" && state.state !== "verified")) return;
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 4_000);
    return () => window.clearInterval(poll);
  }, [active, state.state, refresh]);

  async function mutate(action: "create" | "unlink") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request(action === "unlink" ? "DELETE" : "POST",
        action === "unlink" ? undefined : "create");
      if (action === "create") {
        const destination = safeTelegramUrl(next.url);
        if (!destination) throw new Error("invalid_link");
        setLinkUrl(destination);
        setState(next);
        // Open Telegram immediately after the authenticated server generated the one-time link.
        // The bot finishes the connection on /start; no second confirmation on the site.
        window.location.assign(destination);
      } else {
        setLinkUrl(null);
        setState(next);
        setConfirmUnlink(false);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const connected = state.state === "linked";
  const pending = state.state === "pending";
  const person = state.username ? "@" + state.username : state.name || "Аккаунт Telegram";

  return <section className="account-panel account-telegram-panel" aria-labelledby="account-telegram-title">
    <div className="account-telegram-heading">
      <div className="account-telegram-mark" aria-hidden="true">
        <img src="/cortex-mark.svg" width="28" height="28" alt="" />
      </div>
      <div>
        <div className="account-small-label">ПОДКЛЮЧЁННЫЕ СЕРВИСЫ</div>
        <h2 id="account-telegram-title">Telegram</h2>
        <p>Привяжи Telegram к CORTEX, чтобы использовать бота с подтверждённым аккаунтом.</p>
      </div>
    </div>

    <div className="account-telegram-status" role="status">
      <span className={"account-telegram-dot" + (connected ? " is-connected" : "")} />
      {state.state === "loading" ? "Проверяем подключение…" :
        connected ? "Подключено · " + person :
        pending ? "Ожидаем подтверждения в Telegram" :
        state.state === "expired" ? "Срок ссылки истёк" : "Не подключено"}
    </div>

    {connected ? <>
      <p className="account-telegram-hint">Связь активна. Управление тарифами, платежами и безопасностью остаётся в CORTEX.</p>
      {confirmUnlink ? <div className="account-telegram-confirm">
        <p>Отключить {person}? Бот больше не будет считать этот Telegram привязанным к CORTEX.</p>
        <div className="account-telegram-actions">
          <button className="account-telegram-danger" type="button" disabled={busy} onClick={() => void mutate("unlink")}>
            {busy ? "Отключаем…" : "Да, отвязать"}
          </button>
          <button className="account-outline-button" type="button" disabled={busy}
            onClick={() => setConfirmUnlink(false)}>Отмена</button>
        </div>
      </div> : <button className="account-outline-button" type="button"
        onClick={() => setConfirmUnlink(true)}>Отвязать Telegram</button>}
    /> : pending && linkUrl ? <>
      <p className="account-telegram-hint">Ссылка действует 5 минут. Нажми Start в боте — связь с аккаунтом CORTEX будет установлена автоматически.</p>
      <div className="account-telegram-actions">
        <a href={linkUrl} className="account-save-button account-telegram-cta" target="_blank" rel="noopener noreferrer">
          Открыть Telegram
        </a>
        <button className="account-outline-button" type="button" disabled={busy}
          onClick={() => void refresh()}>Проверить статус</button>
        <button className="account-outline-button" type="button" disabled={busy}
          onClick={() => void mutate("unlink")}>Отменить</button>
      </div>
    </> : pending ? <>
      <p className="account-telegram-hint">Привязка ожидает запуска бота. Если ссылка потерялась, можно создать новую через 20 секунд.</p>
      <div className="account-telegram-actions">
        <button className="account-outline-button" type="button" disabled={busy}
          onClick={() => void mutate("create")}>Создать новую ссылку</button>
        <button className="account-outline-button" type="button" disabled={busy}
          onClick={() => void mutate("unlink")}>Отмена</button>
      </div>
    </> : <>
      <p className="account-telegram-hint">Нажми кнопку — откроется Telegram. После нажатия Start в боте аккаунты будут связаны. Бот не получит пароль или код входа.</p>
      <button className="account-save-button" type="button" disabled={busy || state.state === "loading"}
        onClick={() => void mutate("create")}>
        {busy ? "Создаём ссылку…" : "Привязать Telegram"}
      </button>
    </>}
    {error && <p className="account-form-error" role="alert">{error}</p>}
  </section>;
}

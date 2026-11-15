"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";

type Mode = "signup" | "verify" | "signin" | "done";

export function Registration() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [notify, setNotify] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus(), 0);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
      triggerRef.current?.focus();
    };
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        if (!accepted) throw new Error("Примите условия обработки данных.");
        if (password.length < 8) throw new Error("Пароль должен содержать минимум 8 символов.");
        const { data, error: signupError } = await cortexAuth.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: window.location.origin + "/auth/callback",
            data: { cortex_preregistration: true, cortex_notify_opt_in: notify },
          },
        });
        if (signupError) throw signupError;
        if (data.session) {
          await savePreregistration(notify);
          setMode("done");
        } else {
          setMode("verify");
        }
        setPassword("");
      } else if (mode === "verify") {
        const { error: verifyError } = await cortexAuth.auth.verifyOtp({
          email: email.trim().toLowerCase(), token: code.replace(/\s/g, ""), type: "email",
        });
        if (verifyError) throw verifyError;
        await savePreregistration(notify);
        setMode("done");
      } else if (mode === "signin") {
        const { error: signinError } = await cortexAuth.auth.signInWithPassword({
          email: email.trim().toLowerCase(), password,
        });
        if (signinError) throw signinError;
        await savePreregistration(notify);
        setPassword("");
        setMode("done");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Не удалось выполнить запрос.";
      if (/Invalid login credentials/i.test(message)) {
        setError("Неверная почта или пароль.");
      } else if (/Email not confirmed/i.test(message)) {
        setError("Сначала подтвердите адрес электронной почты.");
      } else if (/Token has expired|invalid token/i.test(message)) {
        setError("Код истёк или введён неверно. Проверьте письмо.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setError("");
    setPassword("");
    setCode("");
    setMode(next);
  }

  return (
    <>
      <button ref={triggerRef} type="button" id="register" className="button button--primary" onClick={() => { setError(""); setOpen(true); }}>
        Зарегистрироваться <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div ref={dialogRef} className="registration-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-title">
            <button type="button" className="dialog-close" aria-label="Закрыть" onClick={() => setOpen(false)}>×</button>
            <div className="dialog-kicker">CORTEX · РАННИЙ ДОСТУП</div>
            {mode === "done" ? (
              <div className="dialog-success">
                <div className="success-icon" aria-hidden="true">✓</div>
                <h2 id="registration-title">Ты в списке.</h2>
                <p>Аккаунт подтверждён. Мы зарезервировали 5 000 бонусных ИИ-токенов к запуску открытой беты.</p>
                <button className="button button--primary dialog-submit" type="button" onClick={() => setOpen(false)}>Готово</button>
              </div>
            ) : (
              <>
                <h2 id="registration-title">{mode === "signup" ? "Будь первым." : mode === "verify" ? "Проверь почту." : "С возвращением."}</h2>
                <p className="dialog-description">
                  {mode === "signup"
                    ? "Регистрируйся сейчас. 20 ноября откроем бету, а тебе начислим +5 000 ИИ-токенов."
                    : mode === "verify"
                      ? "Мы отправили письмо с подтверждением. Введи код из письма или перейди по ссылке."
                      : "Войди в существующий аккаунт, чтобы получить ранний доступ."}
                </p>
                <form onSubmit={submit} className="registration-form">
                  <label htmlFor="registration-email">Почта</label>
                  <input id="registration-email" autoComplete="email" type="email" value={email}
                    onChange={(event) => setEmail(event.target.value)} required maxLength={254} readOnly={mode === "verify"}
                    placeholder="you@example.com" />
                  {mode === "verify" ? (
                    <>
                      <label htmlFor="registration-code">Код из письма</label>
                      <input id="registration-code" inputMode="numeric" autoComplete="one-time-code" value={code}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
                        required minLength={6} maxLength={10} placeholder="000000" />
                    </>
                  ) : (
                    <>
                      <label htmlFor="registration-password">Пароль</label>
                      <input id="registration-password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        type="password" value={password} onChange={(event) => setPassword(event.target.value)}
                        required minLength={8} placeholder="Не менее 8 символов" />
                    </>
                  )}
                  {mode === "signup" && (
                    <label className="form-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required />
                      <span>Согласен с <a href="/privacy" target="_blank" rel="noopener noreferrer">обработкой данных</a>.</span>
                    </label>
                  )}
                  {mode !== "verify" && (
                    <label className="form-check"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
                      <span>Прислать письмо, когда откроется бета.</span>
                    </label>
                  )}
                  {error && <p role="alert" className="form-error">{error}</p>}
                  <button className="button button--primary dialog-submit" type="submit" disabled={busy}>
                    {busy ? "Подождите..." : mode === "signup" ? "Создать аккаунт" : mode === "verify" ? "Подтвердить" : "Войти"}
                  </button>
                </form>
                <div className="dialog-switch">
                  {mode === "signup" ? <>Уже есть аккаунт? <button type="button" onClick={() => switchMode("signin")}>Войти</button></>
                    : <>Нужна новая регистрация? <button type="button" onClick={() => switchMode("signup")}>Зарегистрироваться</button></>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function DownloadCTA({ url }: { url?: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(Boolean(url) && Date.now() >= Date.parse("2026-11-20T00:00:00+03:00"));
  }, [url]);

  return available && url ? (
    <a className="button button--secondary" href={url} rel="noopener noreferrer">
      Установить <span aria-hidden="true">↓</span>
    </a>
  ) : (
    <span className="button button--secondary button--disabled" aria-label="Установка станет доступна 20 ноября">
      Установить <span className="button-soon">20.11</span>
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";
import UiIcon from "@/components/UiIcon";

type Mode = "signup" | "verify" | "signin" | "done";

export function Registration() {
  return (
    <Link id="register" className="button button--primary" href="/register">
      Зарегистрироваться <span className="button-icon"><UiIcon name="arrow-up-right" size={18} /></span>
    </Link>
  );
}

export function RegistrationForm() {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [notify, setNotify] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wasSignin, setWasSignin] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signin") {
      setMode("signin");
    }
  }, []);

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
            data: {
              cortex_preregistration: true,
              cortex_notify_opt_in: notify,
              cortex_privacy_acknowledged_version: "2026-11-15",
              cortex_privacy_acknowledged_at: new Date().toISOString(),
              cortex_launch_notify_opt_in_at: notify ? new Date().toISOString() : null,
            },
          },
        });
        if (signupError) throw signupError;
        if (data.session) {
          await savePreregistration(notify);
          setWasSignin(false);
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
        setWasSignin(false);
        setMode("done");
      } else if (mode === "signin") {
        const { error: signinError } = await cortexAuth.auth.signInWithPassword({
          email: email.trim().toLowerCase(), password,
        });
        if (signinError) throw signinError;
        // Signing in must not silently overwrite previously granted notification consent.
        setPassword("");
        setWasSignin(true);
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
    <section className="auth-form-area" aria-labelledby="auth-title">
      <div className="auth-kicker"><span className="auth-kicker-dot" /> CORTEX · РАННИЙ ДОСТУП</div>
      {mode === "done" ? (
        <div className="auth-success" role="status">
          <div className="auth-success-mark"><UiIcon name="check" size={28} /></div>
          <h1 id="auth-title">{wasSignin ? "С возвращением." : "Ты в списке."}</h1>
          <p>{wasSignin
            ? "Ты вошёл в свой аккаунт CORTEX. Открытая бета начнётся 20 ноября."
            : "Почта подтверждена. Мы зарезервировали 5 000 бонусных ИИ-токенов к запуску беты."}</p>
          <Link href="/" className="button button--primary auth-submit">На главную <UiIcon name="arrow-right" size={18} /></Link>
        </div>
      ) : (
        <>
          <h1 id="auth-title">{mode === "signup" ? "Начнём." : mode === "verify" ? "Проверь почту." : "С возвращением."}</h1>
          <p className="auth-description">{mode === "signup"
            ? "Создай аккаунт до запуска беты 20 ноября и получи 5 000 бонусных ИИ-токенов."
            : mode === "verify"
              ? "Мы отправили письмо с подтверждением. Введи код из письма или перейди по ссылке."
              : "Войди в свой аккаунт CORTEX."}</p>

          <form onSubmit={submit} className="registration-form">
            <label htmlFor="registration-email">Электронная почта</label>
            <input id="registration-email" autoComplete="email" type="email" inputMode="email"
              value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254}
              readOnly={mode === "verify"} placeholder="you@example.com" />

            {mode === "verify" ? (
              <>
                <label htmlFor="registration-code">Код из письма</label>
                <input id="registration-code" className="verification-input" inputMode="numeric" autoComplete="one-time-code"
                  value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
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
              <label className="form-check">
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required />
                <span className="custom-check" aria-hidden="true"><UiIcon name="check" size={13} /></span>
                <span className="check-label">Согласен на обработку данных для создания аккаунта согласно <Link href="/privacy" target="_blank" rel="noopener noreferrer">политике конфиденциальности</Link></span>
              </label>
            )}
            {mode === "signup" && (
              <label className="form-check">
                <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
                <span className="custom-check" aria-hidden="true"><UiIcon name="check" size={13} /></span>
                <span className="check-label">Уведомить меня по почте о запуске беты</span>
              </label>
            )}
            {mode === "signup" && <p className="auth-legal-note">О раннем доступе и бонусах: <Link href="/terms" target="_blank" rel="noopener noreferrer">условия программы</Link>.</p>}

            {error && <p role="alert" className="form-error">{error}</p>}
            <button className="button button--primary auth-submit" type="submit" disabled={busy}>
              <span>{busy ? "Подождите..." : mode === "signup" ? "Создать аккаунт" : mode === "verify" ? "Подтвердить почту" : "Войти"}</span>
              {!busy && <UiIcon name="arrow-right" size={18} />}
            </button>
          </form>

          <div className="auth-switch">
            {mode === "signup" ? <>Уже есть аккаунт? <button type="button" onClick={() => switchMode("signin")}>Войти</button></>
              : <>Нет аккаунта? <button type="button" onClick={() => switchMode("signup")}>Зарегистрироваться</button></>}
          </div>
        </>
      )}
    </section>
  );
}

export function DownloadCTA({ url }: { url?: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(Boolean(url) && Date.now() >= Date.parse("2026-11-20T00:00:00+03:00"));
  }, [url]);

  return available && url ? (
    <a className="button button--secondary" href={url} rel="noopener noreferrer">
      Установить <span className="button-icon"><UiIcon name="download" size={18} /></span>
    </a>
  ) : (
    <span className="button button--secondary button--disabled" aria-label="Установка станет доступна 20 ноября">
      <UiIcon name="clock" size={17} /> Установить <span className="button-soon">20.11</span>
    </span>
  );
}

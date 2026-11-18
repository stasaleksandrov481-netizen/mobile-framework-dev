"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";
import UiIcon from "@/components/UiIcon";
import OtpCodeInput from "@/components/OtpCodeInput";
import { isEmailOtp } from "@/lib/email-otp";
import { isRateLimited, safeAuthErrorMessage } from "@/lib/auth-error";
import { useCortexAccount } from "@/lib/use-cortex-account";

type Mode = "signup" | "verify" | "signin" | "signin_code" | "signin_code_verify" | "done";
type SuccessKind = "signup" | "signin" | "existing";
const emailOtpReady = process.env.NEXT_PUBLIC_CORTEX_EMAIL_OTP_READY === "true";

export function RegistrationForm() {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [notify, setNotify] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successKind, setSuccessKind] = useState<SuccessKind>("existing");
  const [resendWait, setResendWait] = useState(0);
  const { checking: accountChecking, email: activeEmail } = useCortexAccount();
  const authSubmission = useRef(false);

  async function requireVerifiedSession(address: string) {
    // The UI must never treat an Auth API response or an older cached session
    // as proof that THIS email has just authenticated successfully.
    const { data: { user }, error: sessionError } = await cortexAuth.auth.getUser();
    if (sessionError || !user?.id || !user.email_confirmed_at ||
        user.email?.toLowerCase() !== address.trim().toLowerCase()) {
      throw new Error("Не удалось подтвердить вход. Повторите попытку с правильными данными.");
    }
  }

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    if (requestedMode === "signin") setMode("signin");
    if (requestedMode === "code" && emailOtpReady) setMode("signin_code");
  }, []);

  useEffect(() => {
    if (accountChecking || !activeEmail || authSubmission.current) return;
    setEmail(activeEmail);
    setSuccessKind((kind) => kind === "signup" || kind === "signin" ? kind : "existing");
    setMode("done");
  }, [accountChecking, activeEmail]);

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = window.setTimeout(() => setResendWait((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendWait]);

  useEffect(() => {
    if (mode !== "verify") return;
    let active = true;
    const confirmed = async () => {
      try {
        const { data: { user } } = await cortexAuth.auth.getUser();
        if (active && user?.email?.toLowerCase() === email.trim().toLowerCase() && user.email_confirmed_at) {
          setSuccessKind("signup");
          setMode("done");
        }
      } catch { /* Retry once the user returns to this tab. */ }
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("cortex-email-confirmed");
    const onMessage = () => { void confirmed(); };
    const onVisible = () => { if (!document.hidden) void confirmed(); };
    channel?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; channel?.close(); document.removeEventListener("visibilitychange", onVisible); };
  }, [mode, email]);

  async function resendCode() {
    if (busy || resendWait > 0) return;
    setBusy(true);
    setError("");
    try {
      const address = email.trim().toLowerCase();
      const { error: sendError } = mode === "signin_code_verify"
        ? await cortexAuth.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } })
        : await cortexAuth.auth.resend({ type: "signup", email: address });
      if (sendError) throw sendError;
      setCode("");
      setResendWait(60);
    } catch (failure) {
      if (isRateLimited(failure)) {
        setResendWait(300);
        setError("Слишком много запросов. Попробуйте повторить через несколько минут.");
      } else {
        setError("Не удалось отправить новый код. Попробуйте позже.");
      }
    }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    authSubmission.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        if (!accepted) throw new Error("Примите условия обработки данных.");
        if (!acceptedTerms) throw new Error("Примите пользовательское соглашение.");
        if (password.length < 10) throw new Error("Пароль должен содержать минимум 10 символов.");
        const { data, error: signupError } = await cortexAuth.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: window.location.origin + "/auth/callback",
            data: {
              cortex_preregistration: true,
              cortex_notify_opt_in: notify,
              cortex_privacy_acknowledged_version: "2026-11-16.2",
              cortex_terms_accepted_version: "2026-11-16.2",
              cortex_privacy_acknowledged_at: new Date().toISOString(),
              cortex_launch_notify_opt_in_at: notify ? new Date().toISOString() : null,
            },
          },
        });
        if (signupError) throw signupError;
        if (data.session) {
          await requireVerifiedSession(email);
          await savePreregistration(notify);
          setSuccessKind("signup");
          setMode("done");
        } else {
          setResendWait(60);
          setMode("verify");
        }
        setPassword("");
      } else if (mode === "verify") {
        if (activeEmail !== email.trim().toLowerCase()) {
          if (!isEmailOtp(code)) throw new Error("Введите шестизначный код из письма.");
          const { error: verifyError } = await cortexAuth.auth.verifyOtp({
            email: email.trim().toLowerCase(), token: code.replace(/\s/g, ""), type: "email",
          });
          if (verifyError) throw verifyError;
        }
        await requireVerifiedSession(email);
        await savePreregistration(notify);
        setSuccessKind("signup");
        setMode("done");
      } else if (mode === "signin_code") {
        if (!emailOtpReady) throw new Error("Вход по коду пока не подключён.");
        const { error: otpError } = await cortexAuth.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: false },
        });
        if (otpError) throw otpError;
        setCode("");
        setResendWait(60);
        setMode("signin_code_verify");
      } else if (mode === "signin_code_verify") {
        if (!isEmailOtp(code)) throw new Error("Введите шестизначный код из письма.");
        const { error: verifyError } = await cortexAuth.auth.verifyOtp({
          email: email.trim().toLowerCase(), token: code, type: "email",
        });
        if (verifyError) throw verifyError;
        await requireVerifiedSession(email);
        setSuccessKind("signin");
        setMode("done");
      } else if (mode === "signin") {
        const { error: signinError } = await cortexAuth.auth.signInWithPassword({
          email: email.trim().toLowerCase(), password,
        });
        if (signinError) throw signinError;
        await requireVerifiedSession(email);
        // Signing in must not silently overwrite previously granted notification consent.
        setPassword("");
        setSuccessKind("signin");
        setMode("done");
      }
    } catch (failure) {
      if (isRateLimited(failure)) {
        setResendWait(300);
      }
      setError(safeAuthErrorMessage(failure));
    } finally {
      authSubmission.current = false;
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setError("");
    setPassword("");
    setCode("");
    setResendWait(0);
    setMode(next);
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const { error: signOutError } = await cortexAuth.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setSuccessKind("existing");
      setEmail("");
      switchMode("signin");
    } catch (failure) {
      setError(safeAuthErrorMessage(failure));
    } finally { setBusy(false); }
  }

  return (
    <section className="auth-form-area" aria-labelledby="auth-title">
      <div className="auth-kicker"><span className="auth-kicker-dot" /> CORTEX · РАННИЙ ДОСТУП</div>
      {accountChecking ? (
        <div className="auth-checking" role="status">Проверяем аккаунт…</div>
      ) : mode === "done" ? (
        <div className="auth-success" role="status">
          <div className="auth-success-mark"><UiIcon name="check" size={27} /></div>
          <p className="auth-success-kicker">АККАУНТ ПОДТВЕРЖДЁН</p>
          <h1 id="auth-title">{successKind === "signup" ? "Всё готово." : successKind === "signin" ? "С возвращением." : "Вы уже с нами."}</h1>
          <p className="auth-success-description">{successKind === "signup"
            ? "Почта подтверждена. Аккаунт готов к открытой бете CORTEX 20 ноября."
            : "Вы вошли в CORTEX. Повторно регистрироваться не нужно."}</p>
          <div className="auth-success-details">
            <span>ЭЛЕКТРОННАЯ ПОЧТА</span>
            <strong>{activeEmail || email}</strong>
            <div className="auth-success-status"><UiIcon name="check" size={14} /> Подтверждена</div>
          </div>
          <Link href="/" className="button button--primary auth-submit">На главную <UiIcon name="arrow-right" size={18} /></Link>
          <button className="auth-success-logout" type="button" disabled={busy} onClick={() => void signOut()}>Выйти или сменить аккаунт</button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
      ) : (
        <>
          <h1 id="auth-title">{mode === "signup" ? "Начнём." : mode === "verify" || mode === "signin_code_verify" ? "Проверь почту." : "С возвращением."}</h1>
          <p className="auth-description">{mode === "signup"
            ? "Создай аккаунт до запуска беты 20 ноября и получи 5 000 бонусных ИИ-токенов."
            : mode === "verify"
              ? emailOtpReady
                ? "Мы отправили шестизначный код. Если адрес уже зарегистрирован и письмо не приходит, попробуйте войти."
                : "Проверь письмо и перейди по ссылке подтверждения. Если в письме есть код, введи его здесь."
            : mode === "signin_code_verify"
              ? "Мы отправили шестизначный код. Введи его из письма, чтобы продолжить."
              : mode === "signin_code"
                ? "Войди без пароля. Отправим одноразовый код на твою почту."
              : "Войди в свой аккаунт CORTEX."}</p>

          <form onSubmit={submit} className="registration-form">
            <label htmlFor="registration-email">Электронная почта</label>
            <input id="registration-email" autoComplete="email" type="email" inputMode="email"
              value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254}
              readOnly={mode === "verify" || mode === "signin_code_verify"} placeholder="you@example.com" />

            {mode === "verify" || mode === "signin_code_verify" ? (
              <>
                <label htmlFor="registration-code">Код из письма</label>
                <OtpCodeInput value={code} onChange={setCode} disabled={busy} />
                <p className="auth-otp-hint">Можно спокойно вводить код: отсчёт ниже касается только повторной отправки. Если код истёк, запросите новый и используйте последнее письмо.</p>
                <button className="auth-resend" type="button" onClick={resendCode} disabled={busy || resendWait > 0}>
                  {resendWait > 0 ? `Отправить ещё раз через ${resendWait} с` : "Отправить код повторно"}
                </button>
              </>
            ) : mode !== "signin_code" ? (
              <>
                <label htmlFor="registration-password">Пароль</label>
                <input id="registration-password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  type="password" value={password} onChange={(event) => setPassword(event.target.value)}
                  required minLength={mode === "signup" ? 10 : 1} placeholder={mode === "signup" ? "Не менее 10 символов" : "Ваш пароль"} />
              </>
            ) : null}

            {mode === "signup" && (
              <label className="form-check">
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required />
                <span className="custom-check" aria-hidden="true"><UiIcon name="check" size={13} /></span>
                <span className="check-label">Даю <Link href="/consent" target="_blank" rel="noopener noreferrer">согласие на обработку данных</Link> для создания аккаунта. С <Link href="/privacy" target="_blank" rel="noopener noreferrer">политикой данных</Link> ознакомлен.</span>
              </label>
            )}
            {mode === "signup" && (
              <label className="form-check">
                <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required />
                <span className="custom-check" aria-hidden="true"><UiIcon name="check" size={13} /></span>
                <span className="check-label">Принимаю <Link href="/terms" target="_blank" rel="noopener noreferrer">пользовательское соглашение</Link></span>
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
              <span>{busy ? "Подождите..." : mode === "signup" ? "Создать аккаунт" : mode === "verify" ? "Подтвердить почту" : mode === "signin_code" ? "Получить код" : mode === "signin_code_verify" ? "Войти по коду" : "Войти"}</span>
              {!busy && <UiIcon name="arrow-right" size={18} />}
            </button>
          </form>

          <div className="auth-switch">
            {mode === "signup" ? <>Уже есть аккаунт? <button type="button" onClick={() => switchMode("signin")}>Войти</button></>
              : mode === "verify" ? <>Аккаунт уже есть? <button type="button" onClick={() => switchMode("signin")}>Войти</button> <button type="button" onClick={() => switchMode("signup")}>Другой адрес</button></>
                : mode === "signin_code_verify" ? <>Другой адрес? <button type="button" onClick={() => switchMode("signin_code")}>Изменить почту</button></>
                  : <>Нет аккаунта? <button type="button" onClick={() => switchMode("signup")}>Зарегистрироваться</button></>}
          </div>
          {emailOtpReady && (mode === "signin" || mode === "signin_code") && (
            <button type="button" className="auth-code-switch" onClick={() => switchMode(mode === "signin" ? "signin_code" : "signin")}>
              {mode === "signin" ? "Войти по коду из почты" : "Войти с паролем"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";
import { settleWithTimeout } from "@/lib/settle-with-timeout";
import { completeVerifiedAccount } from "@/lib/verified-account";

export default function AuthCallback() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const confirmation = useRef<Promise<void> | null>(null);
  const recoveryFlow = useRef(false);

  useEffect(() => {
    let active = true;
    // StrictMode, a remount or a rapid router update must not consume a
    // one-time email code twice. Subsequent effects await the same exchange.
    if (!confirmation.current) {
      confirmation.current = (async () => {
        const url = new URL(window.location.href);
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        recoveryFlow.current = url.searchParams.get("flow") === "recovery";
        // One-time credentials must not remain in history, screenshots or copied URLs.
        if (url.search) window.history.replaceState(window.history.state, "", url.pathname);
        if (error) throw new Error("Подтверждение не удалось.");
        if (recoveryFlow.current && !code && !tokenHash) throw new Error("Нет кода восстановления.");
        if (code) {
          const { error: exchangeError } = await settleWithTimeout(cortexAuth.auth.exchangeCodeForSession(code), 15_000);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash) {
          const { error: verifyError } = await settleWithTimeout(cortexAuth.auth.verifyOtp({ token_hash: tokenHash, type: recoveryFlow.current ? "recovery" : "email" }), 15_000);
          if (verifyError) throw verifyError;
        }
        const { data: { user } } = await settleWithTimeout(cortexAuth.auth.getUser(), 12_000);
        if (recoveryFlow.current) {
          if (!user?.id || !user.email_confirmed_at) throw new Error("Сессия восстановления недействительна.");
          return;
        }
        // Existing Android accounts may authenticate through this callback
        // without the website preregistration marker. Never create a new
        // bonus reservation or reject their valid verified session.
        await completeVerifiedAccount(user, () => settleWithTimeout(
          savePreregistration(user?.user_metadata?.cortex_notify_opt_in === true), 12_000));
      })();
    }
    void confirmation.current.then(() => {
      if (!active) return;
      setState("done");
      if (!recoveryFlow.current && typeof BroadcastChannel !== "undefined") {
        try {
          const channel = new BroadcastChannel("cortex-email-confirmed");
          channel.postMessage({ confirmed: true });
          channel.close();
        } catch { /* Confirmation succeeded; cross-tab notification is optional. */ }
      }
      router.replace(recoveryFlow.current ? "/reset-password" : "/account");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [router]);

  return (
    <main className="simple-page">
      <h1>{state === "loading" ? "Подтверждаем..." : state === "done" ? recoveryFlow.current ? "Переходим к смене пароля." : "Добро пожаловать в CORTEX." : "Не удалось подтвердить ссылку."}</h1>
      <p>{state === "loading"
        ? "Подождите несколько секунд."
        : state === "done"
          ? recoveryFlow.current ? "Ссылка принята. Открываем безопасную форму смены пароля." : "Регистрация завершена. Открываем личный кабинет CORTEX."
          : "Возможно, ссылка истекла или сервер временно недоступен. Попробуйте войти ещё раз."}</p>
      <p><Link href={state === "error" ? "/register?mode=signin" : recoveryFlow.current ? "/reset-password" : "/account"}>{state === "error" ? "Вернуться ко входу" : recoveryFlow.current ? "Сменить пароль" : "В личный кабинет"}</Link></p>
    </main>
  );
}

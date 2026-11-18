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
        // One-time credentials must not remain in history, screenshots or copied URLs.
        if (url.search) window.history.replaceState(window.history.state, "", url.pathname);
        if (error) throw new Error("Подтверждение не удалось.");
        if (code) {
          const { error: exchangeError } = await settleWithTimeout(cortexAuth.auth.exchangeCodeForSession(code), 15_000);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash) {
          const { error: verifyError } = await settleWithTimeout(cortexAuth.auth.verifyOtp({ token_hash: tokenHash, type: "email" }), 15_000);
          if (verifyError) throw verifyError;
        }
        const { data: { user } } = await settleWithTimeout(cortexAuth.auth.getUser(), 12_000);
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
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const channel = new BroadcastChannel("cortex-email-confirmed");
          channel.postMessage({ confirmed: true });
          channel.close();
        } catch { /* Confirmation succeeded; cross-tab notification is optional. */ }
      }
      router.replace("/account");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [router]);

  return (
    <main className="simple-page">
      <h1>{state === "loading" ? "Подтверждаем..." : state === "done" ? "Добро пожаловать в CORTEX." : "Не удалось подтвердить аккаунт."}</h1>
      <p>{state === "loading"
        ? "Подождите несколько секунд."
        : state === "done"
          ? "Регистрация завершена. Открываем личный кабинет CORTEX."
          : "Возможно, ссылка истекла или сервер временно недоступен. Попробуйте войти ещё раз."}</p>
      <p><Link href={state === "error" ? "/register?mode=signin" : "/account"}>{state === "error" ? "Вернуться ко входу" : "В личный кабинет"}</Link></p>
    </main>
  );
}

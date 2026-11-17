"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";

export default function AuthCallback() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const url = new URL(window.location.href);
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        // One-time credentials must not remain in history, screenshots or copied URLs.
        if (url.search) window.history.replaceState(window.history.state, "", url.pathname);
        if (error) throw new Error("Подтверждение не удалось.");
        if (code) {
          const { error: exchangeError } = await cortexAuth.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash) {
          const { error: verifyError } = await cortexAuth.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
          if (verifyError) throw verifyError;
        }
        const { data: { user } } = await cortexAuth.auth.getUser();
        if (!user || user.user_metadata?.cortex_preregistration !== true) {
          throw new Error("Регистрация не найдена.");
        }
        await savePreregistration(user.user_metadata?.cortex_notify_opt_in === true);
        if (active) {
          setState("done");
          if (typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel("cortex-email-confirmed");
            channel.postMessage({ confirmed: true });
            channel.close();
          }
          router.replace("/account");
        }
      } catch {
        if (active) setState("error");
      }
    }
    void complete();
    return () => { active = false; };
  }, [router]);

  return (
    <main className="simple-page">
      <h1>{state === "loading" ? "Подтверждаем..." : state === "done" ? "Добро пожаловать в CORTEX." : "Не удалось подтвердить аккаунт."}</h1>
      <p>{state === "loading"
        ? "Подождите несколько секунд."
        : state === "done"
          ? "Регистрация завершена. Открываем личный кабинет CORTEX."
          : "Возможно, ссылка истекла или регистрация пока недоступна. Попробуйте ещё раз на странице регистрации."}</p>
      <p><Link href={state === "error" ? "/register" : "/account"}>{state === "error" ? "Повторить регистрацию" : "В личный кабинет"}</Link></p>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cortexAuth, savePreregistration } from "@/lib/cortex-auth";

export default function AuthCallback() {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const url = new URL(window.location.href);
        const error = url.searchParams.get("error");
        if (error) throw new Error("Подтверждение не удалось.");
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
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
        }
      } catch {
        if (active) setState("error");
      }
    }
    void complete();
    return () => { active = false; };
  }, []);

  return (
    <main className="simple-page">
      <h1>{state === "loading" ? "Подтверждаем..." : state === "done" ? "Добро пожаловать в CORTEX." : "Не удалось подтвердить аккаунт."}</h1>
      <p>{state === "loading"
        ? "Подождите несколько секунд."
        : state === "done"
          ? "Регистрация завершена. Вернитесь к исходной вкладке: она обновится автоматически. Мы зарезервировали 5 000 ИИ-токенов к запуску беты 20 ноября."
          : "Возможно, ссылка истекла или регистрация пока недоступна. Попробуйте ещё раз на странице регистрации."}</p>
      <p><Link href={state === "error" ? "/register" : "/"}>{state === "error" ? "Повторить регистрацию" : "На главную"}</Link></p>
    </main>
  );
}

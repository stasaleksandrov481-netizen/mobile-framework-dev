"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { cortexAuth, updateCortexUser } from "@/lib/cortex-auth";
import { useVerifiedCortexSession } from "@/lib/use-verified-cortex-session";
import { clearRecoverySession, matchesRecoverySession } from "@/lib/recovery-session";
import { safeAuthErrorMessage } from "@/lib/auth-error";
import { settleWithTimeout } from "@/lib/settle-with-timeout";

export default function ResetPasswordPage() {
  const { session, checking } = useVerifiedCortexSession();
  const [authorizedKey, setAuthorizedKey] = useState<number | null>(null);
  const authorized = Boolean(session && session.key === authorizedKey);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (session) void session.getToken().then(token => {
      if (active && session.isCurrent() && matchesRecoverySession(session.user.id, token)) setAuthorizedKey(session.key);
    }).catch(() => {});
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    setPassword("");
    setConfirmation("");
  }, [session?.key]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || changed || !authorized || !session) return;
    if (password.length < 10) { setError("Новый пароль должен содержать минимум 10 символов."); return; }
    if (password !== confirmation) { setError("Пароли не совпадают."); return; }
    setError("");
    setBusy(true);
    try {
      const token = await session.getToken();
      if (!matchesRecoverySession(session.user.id, token)) throw new Error("recovery_session_changed");
      const user = await updateCortexUser(token, { password });
      if (user.id !== session.user.id) throw new Error("recovery_session_changed");
      clearRecoverySession();
      if (!session.isCurrent()) return;
      setPassword("");
      setConfirmation("");
      setChanged(true);
      try {
        const { data: { session: current } } = await cortexAuth.auth.getSession();
        if (session.isCurrent() && current?.access_token === token) {
          await settleWithTimeout(cortexAuth.auth.signOut({ scope: "local" }), 10_000);
        }
      } catch { /* Password update already succeeded. */ }
    } catch (failure) {
      setError(safeAuthErrorMessage(failure));
    } finally { setBusy(false); }
  }

  return (
    <main className="simple-page">
      <Link href="/" aria-label="CORTEX — на главную"><img src="/cortex-mark.svg" alt="" width="40" height="40" /></Link>
      <h1>{changed ? "Пароль обновлён." : "Новый пароль."}</h1>
      {changed ? (
        <>
          <p>Теперь войдите с новым паролем. Старый пароль больше не подходит.</p>
          <Link className="glass glass--lg glass--light" href="/register?mode=signin">Перейти ко входу</Link>
        </>
      ) : checking ? (
        <p role="status">Проверяем ссылку восстановления…</p>
      ) : !authorized ? (
        <>
          <p role="alert">Ссылка истекла или сессия не подтверждена. Запросите восстановление ещё раз.</p>
          <Link href="/register?mode=recovery">Запросить новую ссылку</Link>
        </>
      ) : (
        <form className="registration-form" onSubmit={submit} noValidate>
          <label htmlFor="new-password">Новый пароль</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Не менее 10 символов" />
          <label htmlFor="confirm-password">Повторите новый пароль</label>
          <input id="confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Повторите пароль" />
          {error && <p role="alert" aria-live="assertive" className="form-error">{error}</p>}
          <button className="glass glass--lg glass--light glass--block auth-submit" type="submit" disabled={busy}>{busy ? "Сохраняем..." : "Сменить пароль"}</button>
        </form>
      )}
    </main>
  );
}

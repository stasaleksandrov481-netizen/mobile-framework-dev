const key = "cortex:password-recovery";
const duration = 15 * 60 * 1000;

// The JWT is verified by Supabase before using this claim to bind a UI flow.
function sessionId(token: string): string | null {
  try {
    const payload = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!payload) return null;
    const id: unknown = JSON.parse(atob(payload)).session_id;
    return typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function markRecoverySession(userId: string, token: string) {
  const id = sessionId(token);
  if (!id) throw new Error("recovery_session_missing");
  sessionStorage.setItem(key, JSON.stringify({ userId, id, expiresAt: Date.now() + duration }));
}

export function matchesRecoverySession(userId: string, token: string): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const id = sessionId(token);
    return Boolean(id && saved?.id === id && saved.userId === userId &&
      Number.isSafeInteger(saved.expiresAt) && saved.expiresAt > Date.now());
  } catch {
    return false;
  }
}

export function clearRecoverySession() {
  try { sessionStorage.removeItem(key); } catch { /* The password update is already complete. */ }
}

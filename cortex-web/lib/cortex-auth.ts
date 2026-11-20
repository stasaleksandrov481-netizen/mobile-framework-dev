import { AuthApiError, createClient } from "@supabase/supabase-js";
import type { User, UserAttributes } from "@supabase/supabase-js";

import { cortexSupabaseUrl, cortexPublishableKey } from "./cortex-public-config";
import { insertPreregistrationIfMissing } from "./preregistration-write";

export const cortexAuth = createClient(cortexSupabaseUrl, cortexPublishableKey, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    // Callback route exchanges one-time PKCE codes explicitly.
    detectSessionInUrl: false,
  },
});

export const EARLY_ACCESS_BONUS = 5_000;
export const REGISTRATION_LEGAL_VERSION = "2026-11-16.2";

export function registrationAcceptanceVersion(metadata?: Record<string, unknown>) {
  const version = metadata?.cortex_privacy_acknowledged_version;
  if (version !== REGISTRATION_LEGAL_VERSION && version !== "2026-11-16") return null;
  return metadata?.cortex_terms_accepted_version === version ? version : null;
}

/** Scope data requests to the verified account instead of whichever session is active later. */
export function cortexClientWithToken(accessToken: () => Promise<string>) {
  return createClient(cortexSupabaseUrl, cortexPublishableKey, { accessToken });
}

// Explicit bearer requests leave the browser's shared GoTrue storage untouched.
async function requestCortexUser(accessToken: string, attributes?: Pick<UserAttributes, "data" | "password">) {
  const response = await fetch(new URL("/auth/v1/user", cortexSupabaseUrl), {
    method: attributes ? "PUT" : "GET",
    headers: { apikey: cortexPublishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: attributes ? JSON.stringify(attributes) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(attributes ? 12_000 : 9_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.id !== "string") {
    const code = typeof result?.code === "string" ? result.code : "account_request_failed";
    throw new AuthApiError(code, response.status, code);
  }
  return result as User;
}

export function verifyCortexUser(accessToken: string) {
  return requestCortexUser(accessToken);
}

export function updateCortexUser(accessToken: string, attributes: Pick<UserAttributes, "data" | "password">) {
  return requestCortexUser(accessToken, attributes);
}

export async function savePreregistration(notifyOptIn: boolean, expectedUserId: string, boundToken?: string) {
  const token = boundToken ?? (await cortexAuth.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Сначала подтвердите адрес электронной почты.");
  const user = await verifyCortexUser(token);
  if (!user.email || !user.email_confirmed_at ||
      user.id !== expectedUserId) {
    throw new Error("Сначала подтвердите адрес электронной почты.");
  }
  // A confirmation link may be opened more than once or in another tab.
  // Never overwrite a user's later notification preference with the original
  // sign-up metadata. Existing registrations are immutable here.
  const client = cortexClientWithToken(async () => token);
  const registrations = client.from("cortex_preregistrations");
  await insertPreregistrationIfMissing(
    () => registrations.select("user_id").eq("user_id", user.id).maybeSingle(),
    () => registrations.insert({
      user_id: user.id, email: user.email, notify_opt_in: notifyOptIn,
    }),
  );
  // Immutable server timestamps and document versions are recorded by an
  // authenticated RPC. Browser-supplied timestamps are not legal audit evidence.
  if (registrationAcceptanceVersion(user.user_metadata)) {
    const { error: auditError } = await client.rpc("cortex_record_registration_acceptance");
    if (auditError) {
      throw new Error("Не удалось сохранить подтверждение условий. Попробуйте позже.");
    }
  }
}

import { createClient } from "@supabase/supabase-js";

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
const REGISTRATION_LEGAL_VERSION = "2026-11-16.2";

export async function savePreregistration(notifyOptIn: boolean, expectedUserId?: string) {
  const { data: { user }, error: authError } = await cortexAuth.auth.getUser();
  if (authError || !user?.id || !user.email || !user.email_confirmed_at ||
      (expectedUserId && user.id !== expectedUserId)) {
    throw new Error("Сначала подтвердите адрес электронной почты.");
  }
  // A confirmation link may be opened more than once or in another tab.
  // Never overwrite a user's later notification preference with the original
  // sign-up metadata. Existing registrations are immutable here.
  const registrations = cortexAuth.from("cortex_preregistrations");
  await insertPreregistrationIfMissing(
    () => registrations.select("user_id").eq("user_id", user.id).maybeSingle(),
    () => registrations.insert({
      user_id: user.id, email: user.email, notify_opt_in: notifyOptIn,
    }),
  );
  // Immutable server timestamps and document versions are recorded by an
  // authenticated RPC. Browser-supplied timestamps are not legal audit evidence.
  if (user.user_metadata?.cortex_privacy_acknowledged_version === REGISTRATION_LEGAL_VERSION &&
      user.user_metadata?.cortex_terms_accepted_version === REGISTRATION_LEGAL_VERSION) {
    const { error: auditError } = await cortexAuth.rpc("cortex_record_registration_acceptance");
    if (auditError) {
      throw new Error("Не удалось сохранить подтверждение условий. Попробуйте позже.");
    }
  }
}

/** Recover a verified signup that succeeded in Auth before its database write. */
export async function ensurePreregistration(userId: string, notifyOptIn: boolean) {
  const { data, error } = await cortexAuth.from("cortex_preregistrations")
    .select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Не удалось проверить регистрацию. Попробуйте позже.");
  if (!data) await savePreregistration(notifyOptIn, userId);
}

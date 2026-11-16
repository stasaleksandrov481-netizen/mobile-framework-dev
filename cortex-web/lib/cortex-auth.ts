import { createClient } from "@supabase/supabase-js";

import { cortexSupabaseUrl, cortexPublishableKey } from "./cortex-public-config";

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

export async function savePreregistration(notifyOptIn: boolean) {
  const { data: { user }, error: authError } = await cortexAuth.auth.getUser();
  if (authError || !user?.id || !user.email || !user.email_confirmed_at) {
    throw new Error("Сначала подтвердите адрес электронной почты.");
  }
  const { error } = await cortexAuth
    .from("cortex_preregistrations")
    .upsert(
      { user_id: user.id, email: user.email, notify_opt_in: notifyOptIn },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error("Не удалось сохранить регистрацию. Попробуйте позже.");
  }
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

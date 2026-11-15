import { createClient } from "@supabase/supabase-js";

// These are public Supabase credentials already used by cortex-control.
// Never put a secret / service-role key in a NEXT_PUBLIC_* variable.
const url = process.env.NEXT_PUBLIC_CORTEX_SUPABASE_URL || "https://jjcqrjztxohnifmziksy.supabase.co";
const key = process.env.NEXT_PUBLIC_CORTEX_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_bE670IJCPMtnxUpGiOrJLQ_NeiyuI-H";

export const cortexAuth = createClient(url, key, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    // Callback route exchanges one-time PKCE codes explicitly.
    detectSessionInUrl: false,
  },
});

export const EARLY_ACCESS_BONUS = 5_000;

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
}

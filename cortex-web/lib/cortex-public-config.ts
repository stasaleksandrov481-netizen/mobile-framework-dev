// These are public Supabase credentials already used by cortex-control.
// Never put a secret / service-role key in a NEXT_PUBLIC_* variable.
export const cortexSupabaseUrl = process.env.NEXT_PUBLIC_CORTEX_SUPABASE_URL || "https://jjcqrjztxohnifmziksy.supabase.co";
export const cortexPublishableKey = process.env.NEXT_PUBLIC_CORTEX_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_bE670IJCPMtnxUpGiOrJLQ_NeiyuI-H";

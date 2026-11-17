import { operatorDetailsComplete } from "./merchant-details.ts";

/** This UI gate is defense in depth. Supabase Auth must also be configured. */
export function registrationIsOpen() {
  if (process.env.CORTEX_ENABLE_REGISTRATION !== "true") return false;
  if (process.env.CORTEX_RF_DATA_COMPLIANCE_VERIFIED === "true" && operatorDetailsComplete()) return true;

  // Owner-authorized public beta override. This does NOT certify legal
  // compliance or invent missing operator details; keep the legal flags honest.
  return process.env.CORTEX_PUBLIC_SIGNUP_EXCEPTION === "true";
}

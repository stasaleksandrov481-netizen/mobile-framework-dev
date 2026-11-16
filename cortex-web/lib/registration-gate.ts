import { operatorDetailsComplete } from "./merchant-details";

/** This UI gate is defense in depth. Supabase Auth must also be configured. */
export function registrationIsOpen() {
  return process.env.CORTEX_ENABLE_REGISTRATION === "true" &&
    process.env.CORTEX_RF_DATA_COMPLIANCE_VERIFIED === "true" &&
    operatorDetailsComplete();
}

/** Single source of truth for CORTEX email verification: Supabase sends six digits. */
export const EMAIL_OTP_LENGTH = 6;

export function isEmailOtp(value: string): boolean {
  // Server verification is still authoritative; this only validates the input shape.
  return /^\d{6}$/.test(value);
}

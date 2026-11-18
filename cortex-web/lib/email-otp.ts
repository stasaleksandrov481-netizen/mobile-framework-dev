/** Matches the six-digit Supabase Auth {{ .Token }} email template. */
export const EMAIL_OTP_LENGTH = 6;

export function isEmailOtp(value: string): boolean {
  return /^\d{6}$/.test(value);
}

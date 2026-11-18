/** The input must accommodate both default six-digit and observed eight-digit email codes. */
export const EMAIL_OTP_LENGTH = 8;

export function isEmailOtp(value: string): boolean {
  // The Auth server, not this client-side format check, validates the actual OTP.
  return /^\d{6}(?:\d{2})?$/.test(value);
}

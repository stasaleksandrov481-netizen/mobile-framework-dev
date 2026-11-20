/** Keep six fixed OTP slots to match the approved CORTEX registration layout. */
export const EMAIL_OTP_LENGTH = 6;

export function isEmailOtp(value: string): boolean {
  // The Auth server, not this client-side format check, validates the actual OTP.
  return /^\d{6}$/.test(value);
}

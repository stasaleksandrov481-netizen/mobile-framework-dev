/** Replace the focused OTP slot without shifting already entered digits. */
export function insertOtpDigits(value: string, index: number, raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return value;
  // Some mobile keyboards deliver the entire SMS code in a single input event.
  if (digits.length >= 6) return digits.slice(0, 6);
  const position = Math.max(0, Math.min(index, value.length, 5));
  return (value.slice(0, position) + digits + value.slice(position + digits.length)).slice(0, 6);
}

/** Only the payment provider's own checkout host may receive the buyer. */
export function verifiedCheckoutUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.origin === "https://app.platega.io" &&
      !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

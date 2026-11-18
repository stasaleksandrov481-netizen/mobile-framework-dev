export type Reservation = {
  bonus_tokens: number;
  bonus_spent: number;
  bonus_granted_at: string | null;
  registered_at: string;
  notify_opt_in: boolean;
};

export type Quota = {
  daily_limit: number;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  plan: string;
  reset_at: string;
  bonus_remaining: number;
};

const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function validReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Reservation>;
  return nonnegativeInteger(item.bonus_tokens) && nonnegativeInteger(item.bonus_spent)
    && typeof item.registered_at === "string" && Number.isFinite(Date.parse(item.registered_at))
    && typeof item.notify_opt_in === "boolean"
    && (item.bonus_granted_at === null || typeof item.bonus_granted_at === "string" && Number.isFinite(Date.parse(item.bonus_granted_at)));
}

export function validQuota(value: unknown): value is Quota {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Quota>;
  return nonnegativeInteger(item.daily_limit) && nonnegativeInteger(item.used)
    && (item.remaining === null || nonnegativeInteger(item.remaining))
    && typeof item.unlimited === "boolean" && typeof item.plan === "string"
    && (item.unlimited || item.remaining !== null)
    && typeof item.reset_at === "string" && Number.isFinite(Date.parse(item.reset_at))
    && nonnegativeInteger(item.bonus_remaining);
}

const moscowReset = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
});

export function resetLabel(isoDate: string): string {
  const timestamp = Date.parse(isoDate);
  return Number.isFinite(timestamp) ? `${moscowReset.format(timestamp)} МСК` : "Время уточняется";
}

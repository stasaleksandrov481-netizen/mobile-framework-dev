export const BETA_APK_BUCKET = "cortex-beta-builds";
export const BETA_APK_MAX_BYTES = 150 * 1024 * 1024;
export const BETA_SHARE_SECONDS = 60 * 60;

export class BetaInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "BetaInputError";
  }
}

const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function parseBetaEmails(raw) {
  const entries = String(raw || "").trim().toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const unique = [...new Set(entries)];
  if (!unique.length) throw new BetaInputError("Укажите хотя бы одну почту тестировщика.");
  if (unique.length > 50) throw new BetaInputError("За один раз можно пригласить не больше 50 человек.");
  const invalid = unique.find(email => email.length > 254 || !emailPattern.test(email));
  if (invalid) throw new BetaInputError("Проверьте адрес электронной почты: " + invalid.slice(0, 90));
  return unique;
}

export function betaExpiryFromDays(rawDays, now = Date.now()) {
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new BetaInputError("Срок доступа должен быть от 1 до 90 дней.");
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

export function isBetaInviteActive(invite, now = Date.now()) {
  return invite?.state === "active" && (!invite.expires_at || Date.parse(invite.expires_at) > now);
}

export function betaApkNameIsSafe(name) {
  return /^cortex-[0-9]{10,15}\.apk$/.test(String(name || ""));
}

export function validateBetaApk(file, expectedHash) {
  if (!file || typeof file.name !== "string" || !/\.apk$/i.test(file.name))
    throw new BetaInputError("Выберите APK-файл из проверенного релиза.");
  if (!Number.isInteger(file.size) || file.size < 1024 || file.size > BETA_APK_MAX_BYTES)
    throw new BetaInputError("Размер APK должен быть от 1 КБ до 150 МБ.");
  const hash = String(expectedHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw new BetaInputError("Вставьте 64 символа SHA-256 из контрольной суммы релиза.");
  return hash;
}

/** Stable, user-safe copy for errors crossing the Supabase Auth trust boundary. */
export function isRateLimited(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status : undefined;
  const message = error instanceof Error ? error.message : "";
  return status === 429 || /rate limit|too many requests|email rate limit/i.test(message);
}

export function safeAuthErrorMessage(error: unknown): string {
  if (isRateLimited(error)) {
    return "Слишком много запросов. Подождите несколько минут и попробуйте снова.";
  }
  const message = error instanceof Error ? error.message : "";
  if (/invalid login credentials/i.test(message)) return "Неверная почта или пароль.";
  if (/email not confirmed/i.test(message)) return "Сначала подтвердите адрес электронной почты.";
  if (/token has expired|invalid token|otp_expired/i.test(message)) return "Код неверный или уже истёк. Проверьте последнее письмо либо запросите новый код ниже.";
  if (/error sending (confirmation |magic link )?email|failed to send (confirmation |magic link )?email|could not send email|non-local recipient/i.test(message)) {
    return "Почтовый сервер не смог отправить письмо. Попробуйте позже или напишите на support@cortexapp.ru.";
  }
  if (/password should|password is too|weak_password/i.test(message)) return "Пароль не соответствует требованиям безопасности. Используйте более сложный пароль.";
  if (/invalid email|email address.*invalid/i.test(message)) return "Проверьте правильность электронной почты.";
  // No raw Supabase/PostgREST errors: schema names, provider diagnostics and
  // even the existence of a specific account must not reach the page.
  return "Не удалось выполнить запрос. Попробуйте позже.";
}

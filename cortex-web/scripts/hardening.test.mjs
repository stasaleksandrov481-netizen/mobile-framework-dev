import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCachedHealthCheck } from "../lib/health-cache.ts";
import { safeHttpsDownloadUrl } from "../lib/safe-url.ts";
import { isEmailDeliveryRateLimited, isRateLimited, safeAuthErrorMessage } from "../lib/auth-error.ts";
import { dataOperators, paymentMerchant, operatorDetailsComplete } from "../lib/merchant-details.ts";
import { registrationIsOpen } from "../lib/registration-gate.ts";
import { insertPreregistrationIfMissing } from "../lib/preregistration-write.ts";
import { settleWithTimeout } from "../lib/settle-with-timeout.ts";
import { createLatestRequest } from "../lib/latest-request.ts";
import { completeVerifiedAccount } from "../lib/verified-account.ts";
import { validQuota, validReservation, resetLabel } from "../lib/account-data.ts";
import { EMAIL_OTP_LENGTH, isEmailOtp } from "../lib/email-otp.ts";
import { RegistrationValidationError, registrationValidationError } from "../lib/registration-validation.ts";
import { deliverClaimedNotification } from "../lib/launch-delivery.ts";
import nextConfig from "../next.config.ts";

test("Render failures keep a CSS-independent recovery path without exposing exception details", () => {
  const view = readFileSync(new URL("../components/SiteErrorView.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/error.tsx", import.meta.url), "utf8");
  const global = readFileSync(new URL("../app/global-error.tsx", import.meta.url), "utf8");
  assert.match(view, /onClick=\{retry\}/);
  assert.match(view, /href="\/"/);
  assert.match(view, /role="alert"/);
  assert.match(view, /fontFamily: "Arial, sans-serif"/);
  assert.doesNotMatch(view, /error\.message|error\.stack|digest/);
  assert.match(route, /<SiteErrorView retry=\{reset\} \/>/);
  assert.match(global, /<html lang="ru">/);
  assert.match(global, /<body style=\{\{ margin: 0 \}\}>/);
});

test("Email confirmation never overwrites an existing launch-notification preference", async () => {
  let inserts = 0;
  await insertPreregistrationIfMissing(
    async () => ({ data: { user_id: "existing-account" }, error: null }),
    async () => { inserts++; return { error: null }; },
  );
  assert.equal(inserts, 0);
});

test("Email OTP input retains the approved six digit boxes", () => {
  assert.equal(EMAIL_OTP_LENGTH, 6);
  assert.equal(isEmailOtp("001234"), true);
  assert.equal(isEmailOtp("12345"), false);
  assert.equal(isEmailOtp("12345678"), false);
  assert.equal(isEmailOtp("00000000"), false);
  assert.equal(isEmailOtp("1234567"), false);
  assert.equal(isEmailOtp("123456789"), false);
  assert.equal(isEmailOtp("1234ab"), false);
  const input = readFileSync(new URL("../components/OtpCodeInput.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  assert.match(input, /const CODE_LENGTH = EMAIL_OTP_LENGTH/);
  assert.match(form, /isEmailOtp\(code\)/);
  assert.doesNotMatch(form, /6 или 8|восьмизначн/);
  const styles = readFileSync(new URL("../app/pages.css", import.meta.url), "utf8");
  assert.match(styles, /\.otp-code \{ display: grid; grid-template-columns: repeat\(6,/);
});

test("Signup always explains invalid email, missing agreement and short password without relying on browser tooltip", () => {
  const fields = { mode: "signup", email: "test@example.com", password: "strongpassword", accepted: true, acceptedTerms: true };
  assert.equal(registrationValidationError(fields), null);
  assert.match(registrationValidationError({ ...fields, email: "" }), /адрес электронной почты/);
  assert.match(registrationValidationError({ ...fields, email: "+79990000000" }), /Номер телефона/);
  assert.match(registrationValidationError({ ...fields, password: "short" }), /10 символов/);
  assert.match(registrationValidationError({ ...fields, accepted: false }), /согласие/);
  assert.match(registrationValidationError({ ...fields, acceptedTerms: false }), /условия/);
  const component = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  assert.match(component, /<form onSubmit=\{submit\} noValidate/);
  assert.match(component, /aria-live="assertive"/);
});

test("Recovery validates the email without requiring an old password and does not disclose account existence", () => {
  const fields = { mode: "recovery", email: "test@example.com", password: "", accepted: false, acceptedTerms: false };
  assert.equal(registrationValidationError(fields), null);
  assert.match(registrationValidationError({ ...fields, email: "" }), /адрес электронной почты/);
  assert.match(registrationValidationError({ ...fields, email: "invalid" }), /корректный адрес/);
  const form = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  const callback = readFileSync(new URL("../app/auth/callback/page.tsx", import.meta.url), "utf8");
  const reset = readFileSync(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");
  assert.match(form, /resetPasswordForEmail\(/);
  assert.match(form, /Если для этого адреса существует аккаунт/);
  assert.match(form, /Забыли пароль\?/);
  assert.match(form, /resendSignupConfirmation\(\)/);
  assert.match(form, /Не пришло письмо подтверждения\?/);
  assert.match(form, /type: "signup", email: address/);
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /recoveryFlow\.current \? "recovery" : "email"/);
  assert.match(callback, /router\.replace\(recoveryFlow\.current \? "\/reset-password" : "\/account"\)/);
  assert.match(reset, /updateCortexUser\(token, \{ password \}\)/);
  assert.match(reset, /matchesRecoverySession\(session.user.id, token\)/);
  assert.match(reset, /password\.length < 10/);
  assert.doesNotMatch(reset, /service.role|service_role/i);
});

test("Auth errors are actionable and never expose backend messages", () => {
  assert.match(safeAuthErrorMessage(new Error("Failed to fetch")), /сервером/);
  assert.match(safeAuthErrorMessage(new RegistrationValidationError("Введите адрес электронной почты.")), /Введите адрес/);
  assert.doesNotMatch(safeAuthErrorMessage(new Error("Введите секретное значение внутреннего сервиса")), /секретное/);
  assert.match(safeAuthErrorMessage(new Error("Error sending confirmation email")), /Письмо не удалось доставить/);
  assert.match(safeAuthErrorMessage(Object.assign(new Error("rate limit exceeded"), { status: 429 })), /Слишком много запросов/);
  const mailQuota = Object.assign(new Error("email rate limit exceeded"), { status: 429, code: "over_email_send_rate_limit" });
  assert.equal(isEmailDeliveryRateLimited(mailQuota), true);
  assert.equal(isRateLimited(mailQuota), true);
  assert.match(safeAuthErrorMessage(mailQuota), /код уже пришёл/);
  assert.equal(isEmailDeliveryRateLimited(Object.assign(new Error("too many"), { status: 429 })), false);
  const form = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  assert.match(form, /У меня уже есть код подтверждения/);
  assert.match(form, /setMode\("verify"\)/);
  assert.doesNotMatch(safeAuthErrorMessage(new Error("sensitive database diagnostics")), /sensitive/);
});

test("launch mail does not immediately requeue an email SMTP already accepted", async () => {
  let sent = 0;
  let released = 0;
  let confirmed = 0;
  const outcome = await deliverClaimedNotification({
    eligible: async () => true,
    send: async () => { sent++; },
    confirm: async () => { confirmed++; throw new Error("storage unavailable"); },
    release: async () => { released++; },
  });
  assert.equal(outcome, "unconfirmed");
  assert.equal(sent, 1);
  assert.equal(confirmed, 3);
  assert.equal(released, 0, "a post-SMTP DB outage must not immediately requeue the message");
});

test("launch notifications recheck consent, release failed sends, and retry a transient receipt", async () => {
  let sent = 0, released = 0, confirmations = 0;
  const actions = {
    eligible: async () => false,
    send: async () => { sent++; },
    confirm: async () => true,
    release: async () => { released++; },
  };
  assert.equal(await deliverClaimedNotification(actions), "skipped");
  assert.equal(sent, 0);
  assert.equal(released, 1);
  assert.equal(await deliverClaimedNotification({ ...actions, eligible: async () => true,
    send: async () => { throw new Error("SMTP refused"); } }), "failed");
  assert.equal(released, 2);
  assert.equal(await deliverClaimedNotification({ ...actions, eligible: async () => true,
    confirm: async () => ++confirmations >= 2 }), "sent");
  assert.equal(sent, 1);
  assert.equal(confirmations, 2);
  assert.equal(released, 2);
});

test("Registration write recovers a concurrent confirmation but reports persistent failures", async () => {
  let reads = 0;
  await insertPreregistrationIfMissing(
    async () => ({ data: ++reads === 1 ? null : { user_id: "confirmed-by-other-tab" }, error: null }),
    async () => ({ error: new Error("duplicate key") }),
  );
  assert.equal(reads, 2);
  await assert.rejects(insertPreregistrationIfMissing(
    async () => ({ data: null, error: null }),
    async () => ({ error: new Error("network disconnected") }),
  ), /Не удалось сохранить регистрацию/);
});

test("health probes coalesce parallel requests and cache success", async () => {
  let requests = 0;
  const healthy = createCachedHealthCheck(async () => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  }, 100, 500);
  assert.deepEqual(await Promise.all(Array.from({ length: 24 }, () => healthy())), Array(24).fill(true));
  assert.equal(requests, 1);
  assert.equal(await healthy(), true);
  assert.equal(requests, 1);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(await healthy(), true);
  assert.equal(requests, 2);
});

test("health probes bound timeout and cache failures", async () => {
  let requests = 0;
  const healthy = createCachedHealthCheck(() => {
    requests++;
    return new Promise(() => {});
  }, 100, 25);
  assert.equal(await healthy(), false);
  assert.equal(await healthy(), false);
  assert.equal(requests, 1);
});

test("health probes suppress upstream errors", async () => {
  const healthy = createCachedHealthCheck(async () => { throw Error("secret"); });
  assert.equal(await healthy(), false);
});

test("Slow account API calls time out instead of leaving an infinite spinner", async () => {
  assert.equal(await settleWithTimeout(Promise.resolve("ok"), 100), "ok");
  await assert.rejects(settleWithTimeout(new Promise(() => {}), 25), /CORTEX_REQUEST_TIMEOUT/);
});

test("Old account refreshes cannot overwrite a newer response or survive navigation", () => {
  const requests = createLatestRequest();
  const first = requests.begin();
  assert.equal(requests.isCurrent(first), true);
  const second = requests.begin();
  assert.equal(requests.isCurrent(first), false);
  assert.equal(requests.isCurrent(second), true);
  requests.invalidate();
  assert.equal(requests.isCurrent(second), false);
});

test("Email callback accepts verified Android accounts without inventing a website bonus", () => {
  const callback = readFileSync(new URL("../app/auth/callback/page.tsx", import.meta.url), "utf8");
  assert.match(callback, /completeVerifiedAccount\(user,/);
  assert.match(callback, /if \(!confirmation\.current\)/);
  assert.match(callback, /confirmation\.current\.then\(/);
});

test("registration and account security keep identity verification and confirmed global sign-out", () => {
  const registration = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/AccountDashboard.tsx", import.meta.url), "utf8");
  const registerPage = readFileSync(new URL("../app/register/page.tsx", import.meta.url), "utf8");
  assert.match(registration, /auth-form-logo/);
  assert.match(registerPage, /signupEnabled=\{registrationIsOpen\(\)\}/);
  assert.match(registerPage, /export const dynamic = "force-dynamic"/);
  assert.match(registration, /if \(!signupEnabled\) throw new Error\("Регистрация временно закрыта\."\)/);
  assert.match(registration, /useState<Mode>\(signupEnabled \? "signup" : "signin"\)/);
  const session = readFileSync(new URL("../lib/use-verified-cortex-session.ts", import.meta.url), "utf8");
  assert.match(dashboard, /useVerifiedCortexSession\(\)/);
  assert.match(session, /verifyCortexUser\(accessToken\)/);
  assert.match(dashboard, /!confirmAllSessions/);
  assert.match(dashboard, /auth\.admin\.signOut\(token, "global"\)/);
  assert.match(dashboard, /role="group" aria-label="Подтверждение завершения сеансов"/);
});

test("Confirmed email is not a successful registration until DB persistence succeeds", async () => {
  const verified = { id: "account-id", email: "TEST@example.com", email_confirmed_at: "2026-11-17T00:00:00Z",
    user_metadata: { cortex_preregistration: true } };
  await assert.rejects(completeVerifiedAccount(verified, async () => { throw new Error("write failed"); }), /write failed/);
  assert.equal(await completeVerifiedAccount(verified, async () => {}), "test@example.com");
  let writes = 0;
  const android = { ...verified, user_metadata: {} };
  await completeVerifiedAccount(android, async () => { writes++; });
  assert.equal(writes, 0, "existing Android users must not gain a new web bonus");
  await assert.rejects(completeVerifiedAccount({ ...verified, email_confirmed_at: null }, async () => {}), /Подтвердите/);
});

test("Account cards reject malformed quota and reservation responses", () => {
  const quota = { daily_limit: 5_000, used: 350, remaining: 4_650, unlimited: false,
    plan: "free", reset_at: "2026-11-18T00:00:00Z", bonus_remaining: 0 };
  const reservation = { bonus_tokens: 5_000, bonus_spent: 100, bonus_granted_at: null,
    registered_at: "2026-11-17T00:00:00Z", notify_opt_in: false };
  assert.equal(validQuota(quota), true);
  assert.equal(validReservation(reservation), true);
  assert.equal(validQuota({ ...quota, remaining: -5 }), false);
  assert.equal(validQuota({ ...quota, remaining: null }), false, "finite plans must never render a missing balance as zero");
  assert.equal(validQuota({ ...quota, remaining: null, unlimited: true }), true);
  assert.equal(validQuota({ ...quota, reset_at: "not-a-date" }), false);
  assert.equal(validReservation({ ...reservation, bonus_spent: -1 }), false);
  assert.equal(validReservation({ ...reservation, registered_at: "not-a-date" }), false);
  assert.match(resetLabel(quota.reset_at), /МСК/);
  assert.equal(resetLabel("invalid"), "Время уточняется");
});

test("APK URL only accepts absolute credential-free HTTPS URLs", () => {
  assert.equal(safeHttpsDownloadUrl("https://github.com/owner/repo/releases/latest"), "https://github.com/owner/repo/releases/latest");
  for (const candidate of [undefined, "", "javascript:alert(1)", "http://example.com/app.apk", "//example.com/x", "https://a:b@example.com/app.apk", "/download"]) {
    assert.equal(safeHttpsDownloadUrl(candidate), undefined);
  }
});

test("Auth errors cannot leak raw database, SMTP or account-enumeration details", () => {
  const internalErrors = [
    "SQLSTATE 23505 duplicate key value violates unique constraint auth.users_email_key",
    "User already registered",
    "SMTP login failed, internal mail server smtp.example.internal",
    "Could not find the table 'public.cortex_admin_roles' in the schema cache",
  ];
  for (const message of internalErrors) {
    const text = safeAuthErrorMessage(new Error(message));
    assert.equal(text, "Не удалось выполнить запрос. Попробуйте позже.");
    assert.ok(!text.includes(message));
  }
  assert.equal(isRateLimited(Object.assign(new Error("temporary"), { status: 429 })), true);
  assert.match(safeAuthErrorMessage(Object.assign(new Error("Too many requests"), { status: 429 })), /Слишком много/);
  assert.match(safeAuthErrorMessage(new Error("CORTEX_REQUEST_TIMEOUT")), /слишком долго/);
  assert.match(safeAuthErrorMessage(new Error("Invalid login credentials")), /восстановлением доступа/);
  assert.match(safeAuthErrorMessage(new Error("Token has expired")), /запросите новый код/);
  assert.match(safeAuthErrorMessage(new Error('gomail: could not send email: 550 non-local recipient verification failed')), /Письмо не удалось доставить/);
});

test("Co-operators load from server config, seller is operator B, and incomplete data fails closed", () => {
  const keys = ["NAME", "INN", "ADDRESS"].flatMap(field => [
    `CORTEX_LEGAL_OPERATOR_A_${field}`, `CORTEX_LEGAL_OPERATOR_B_${field}`,
  ]);
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(dataOperators().length, 0);
    assert.equal(operatorDetailsComplete(), false);
    process.env.CORTEX_LEGAL_OPERATOR_A_NAME = "Оператор A";
    process.env.CORTEX_LEGAL_OPERATOR_A_INN = "0".repeat(12);
    process.env.CORTEX_LEGAL_OPERATOR_B_NAME = "Оператор B";
    process.env.CORTEX_LEGAL_OPERATOR_B_INN = "0".repeat(12);
    const operators = dataOperators();
    assert.deepEqual(operators.map(person => person.name), ["Оператор A", "Оператор B"]);
    assert.equal(paymentMerchant()?.name, "Оператор B");
    assert.equal(operatorDetailsComplete(), false);
    process.env.CORTEX_LEGAL_OPERATOR_A_ADDRESS = "Адрес A";
    assert.equal(operatorDetailsComplete(), false);
    process.env.CORTEX_LEGAL_OPERATOR_B_ADDRESS = "Адрес B";
    assert.equal(operatorDetailsComplete(), true);
    process.env.CORTEX_LEGAL_OPERATOR_B_INN = "invalid";
    assert.equal(operatorDetailsComplete(), false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Public signup requires explicit enabling and never silently claims verified compliance", () => {
  const keys = ["CORTEX_ENABLE_REGISTRATION", "CORTEX_RF_DATA_COMPLIANCE_VERIFIED",
    "CORTEX_PUBLIC_SIGNUP_EXCEPTION", "CORTEX_LEGAL_OPERATOR_A_ADDRESS", "CORTEX_LEGAL_OPERATOR_B_ADDRESS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(registrationIsOpen(), false);
    process.env.CORTEX_PUBLIC_SIGNUP_EXCEPTION = "true";
    assert.equal(registrationIsOpen(), false, "override alone must not open signup");
    process.env.CORTEX_ENABLE_REGISTRATION = "true";
    assert.equal(registrationIsOpen(), true, "explicit exception permits the owner-authorized beta");
    assert.equal(process.env.CORTEX_RF_DATA_COMPLIANCE_VERIFIED, undefined);
    delete process.env.CORTEX_PUBLIC_SIGNUP_EXCEPTION;
    assert.equal(registrationIsOpen(), false, "removing the exception closes incomplete signup");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Security headers restrict third-party origins and prohibit API caching", async () => {
  const rules = await nextConfig.headers();
  const common = Object.fromEntries(rules.find((rule) => rule.source === "/(.*)").headers.map(({ key, value }) => [key, value]));
  const api = Object.fromEntries(rules.find((rule) => rule.source === "/api/:path*").headers.map(({ key, value }) => [key, value]));
  assert.match(common["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(common["Content-Security-Policy"], /connect-src 'self' https:\/\/jjcqrjztxohnifmziksy\.supabase\.co/);
  assert.ok(!common["Content-Security-Policy"].includes("*.supabase.co"));
  assert.equal(common["X-Frame-Options"], "DENY");
  assert.equal(common["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(api["Cache-Control"], "no-store");
  assert.equal(api["X-Robots-Tag"], "noindex, nofollow");
});

test("Account quota RPC never accepts arbitrary user IDs from a browser", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261117155421_cortex_web_account_usage.sql", import.meta.url), "utf8");
  assert.match(sql, /security definer/i);
  assert.match(sql, /account_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql, /public\.cortex_ai_usage\(account_id::text\)/);
  assert.match(sql, /revoke all on function public\.cortex_web_account_usage\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.cortex_web_account_usage\(\) to authenticated/i);
  assert.ok(!/cortex_web_account_usage\(p_subject/i.test(sql));
});

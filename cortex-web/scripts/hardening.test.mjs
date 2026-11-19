import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCachedHealthCheck } from "../lib/health-cache.ts";
import { safeHttpsDownloadUrl } from "../lib/safe-url.ts";
import { isRateLimited, safeAuthErrorMessage } from "../lib/auth-error.ts";
import { dataOperators, paymentMerchant, operatorDetailsComplete } from "../lib/merchant-details.ts";
import { registrationIsOpen } from "../lib/registration-gate.ts";
import { EMAIL_OTP_LENGTH, isEmailOtp } from "../lib/email-otp.ts";
import nextConfig from "../next.config.ts";

test("email verification always has exactly six digits", () => {
  assert.equal(EMAIL_OTP_LENGTH, 6);
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const slots = readFileSync(new URL("../components/OtpCodeInput.tsx", import.meta.url), "utf8");
  const registration = readFileSync(new URL("../components/Registration.tsx", import.meta.url), "utf8");
  assert.match(styles, /\.otp-code\s*\{[^}]*grid-template-columns:\s*repeat\(6,/);
  assert.match(slots, /const CODE_LENGTH = EMAIL_OTP_LENGTH/);
  assert.match(slots, /Array\.from\(\{ length: CODE_LENGTH \}/);
  assert.doesNotMatch(registration, /восьмизнач|\^\\d\{8\}/i);
  for (const value of ["12345678", "12345", "12 456", "abcdef", "0000000"]) {
    assert.equal(isEmailOtp(value), false);
  }
  assert.equal(isEmailOtp("000000"), true);
  assert.equal(isEmailOtp("123456"), true);
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

test("APK URL accepts only direct downloads from approved hosts; never links to GitHub", () => {
  const directApk = "https://1ucrqsypjqorifn9.public.blob.vercel-storage.com/android/CORTEX-1.0.18-beta.10-2a1cce8e.apk";
  assert.equal(safeHttpsDownloadUrl(directApk), directApk);
  assert.equal(safeHttpsDownloadUrl("https://cortexapp.ru/releases/CORTEX.apk"), "https://cortexapp.ru/releases/CORTEX.apk");
  for (const candidate of [undefined, "", "javascript:alert(1)", "http://example.com/app.apk", "//example.com/x", "https://a:b@example.com/app.apk", "/download",
    "https://github.com/owner/repo/releases/latest", "https://github.com/owner/repo/releases/download/v1/app.apk",
    "https://example.com/app.apk", "https://cortexapp.ru/download", "https://evil.cortexapp.ru/app.apk",
    "https://cortexapp.ru/app.apk?token=secret", "https://cortexapp.ru/app.apk#fragment"]) {
    assert.equal(safeHttpsDownloadUrl(candidate), undefined);
  }
});

test("public FAQ never exposes the source repository to visitors", () => {
  const page = readFileSync(new URL("../app/questions/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /github\.com|mobile-framework-dev|репозиторий проекта/i);
  assert.match(page, /официальном сайте/);
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
  assert.equal(safeAuthErrorMessage(new Error("Invalid login credentials")), "Неверная почта или пароль.");
  assert.match(safeAuthErrorMessage(new Error("Token has expired")), /запросите новый код/);
  assert.match(safeAuthErrorMessage(new Error('gomail: could not send email: 550 non-local recipient verification failed')), /Почтовый сервер/);
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

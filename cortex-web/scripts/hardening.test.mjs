import assert from "node:assert/strict";
import { test } from "node:test";
import { createCachedHealthCheck } from "../lib/health-cache.ts";
import { safeHttpsDownloadUrl } from "../lib/safe-url.ts";
import { isRateLimited, safeAuthErrorMessage } from "../lib/auth-error.ts";
import nextConfig from "../next.config.ts";

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
  assert.equal(safeAuthErrorMessage(new Error("Invalid login credentials")), "Неверная почта или пароль.");
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

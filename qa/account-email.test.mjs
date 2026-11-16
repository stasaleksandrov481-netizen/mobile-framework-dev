import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Android registration uses email only and six-digit OTP autofill", () => {
  const source = read("app/src/main/assets/web/screens.js");
  const UI = runInNewContext(`${source}\nCortexUI;`, {
    Cortex: { state: { account: null } }, CortexIcons: () => "",
  });
  const connection = { status: "ready", checked: true, email: true, emailRegistration: true };
  const signup = UI.page("account", { connection, accountMode: "signup", email: "", resendWait: 0 });
  assert.match(signup, /data-mode="signup"/);
  assert.doesNotMatch(signup, /Яндекс|Yandex|oauth\.yandex/);
  const verify = UI.page("account", { connection, accountMode: "verify", email: "qa@example.test", resendWait: 44 });
  assert.equal((verify.match(/data-code-cell="\d"/g) || []).length, 6);
  assert.match(verify, /autocomplete="one-time-code"/);
  assert.match(verify, /pattern="\[0-9\]\{6\}"/);
  assert.match(verify, /data-resend-button>Повторить через 44 с/);
  assert.match(verify, /data-action="resend-code" disabled/);
  const ready = UI.page("account", { connection, accountMode: "verify", email: "", resendWait: 0 });
  assert.match(ready, /data-resend-button>Отправить код ещё раз/);
});

test("Supabase authentication email templates contain only variable OTPs and consistent branding", () => {
  for (const template of ["confirm-signup", "otp", "recovery"]) {
    const html = read(`cortex-web/email-templates/${template}.html`);
    assert.equal((html.match(/{{ \.Token }}/g) || []).length, 1, `${template} must have one OTP placeholder`);
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /role="presentation"/);
    assert.match(html, /background:#111113/);
    assert.match(html, /Никому не сообщайте|Никому не сообщайте|Не пересылайте/);
    assert.doesNotMatch(html, /<script|<iframe|<img|javascript:/i);
    assert.match(html, /https:\/\/cortexapp\.ru/);
  }
});

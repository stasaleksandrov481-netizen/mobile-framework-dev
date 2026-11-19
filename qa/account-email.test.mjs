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
  assert.match(signup, /Создать аккаунт/);
  assert.match(signup, /class="account-hero"/);
  assert.match(signup, /class="account-mark"/);
  assert.match(signup, /class="account-submit"|class="action primary account-submit"/);
  assert.doesNotMatch(signup, /account-art/);
  assert.doesNotMatch(signup, /Яндекс|Yandex|oauth\.yandex/);
  const verify = UI.page("account", { connection, accountMode: "verify", email: "qa@example.test", resendWait: 44 });
  assert.match(verify, /value="qa@example\.test"[^>]*readonly/);
  assert.match(verify, /data-action="email-auth" data-value="signup"/);
  assert.equal((verify.match(/data-code-cell="\d"/g) || []).length, 6);
  assert.match(verify, /autocomplete="one-time-code"/);
  assert.match(verify, /enterkeyhint="done"/);
  assert.match(verify, /pattern="\[0-9\]\{6\}"/);
  assert.match(verify, /data-resend-button>Повторить через 44 с/);
  assert.match(verify, /data-action="resend-code" disabled/);
  const ready = UI.page("account", { connection, accountMode: "verify", email: "", resendWait: 0 });
  assert.match(ready, /data-resend-button>Отправить код ещё раз/);
  assert.doesNotMatch(ready, /name="email"[^>]*readonly/);
  const reset = UI.page("account", { connection, accountMode: "reset", email: "qa@example.test", resendWait: 0 });
  assert.match(reset, /data-action="email-auth" data-value="recover"/);
  assert.match(reset, /account-password-hint/);
  const injected = UI.page("account", { connection, accountMode: "verify", email: '\"><script>alert(1)</script>', resendWait: 0 });
  assert.doesNotMatch(injected, /<script>/);
  assert.match(injected, /&quot;&gt;&lt;script&gt;/);
});

test("Android account requests guard unexpected responses, stale resend and field corrections", () => {
  const source = read("app/src/main/assets/web/app.js");
  assert.match(source, /const email = values\.email\?\.trim\(\)\.toLowerCase\(\) \|\| ""/);
  assert.match(source, /emailForm\("verify", email\)/);
  assert.match(source, /accountMode !== mode/);
  assert.match(source, /Не удалось завершить вход\. Попробуйте ещё раз\./);
  assert.match(source, /form\.querySelector\('\[name="confirmation"\]'\)\?\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(source, /input\.removeAttribute\("aria-invalid"\)/);
  const styles = read("app/src/main/assets/web/style.css");
  assert.match(styles, /\.account-page\s*\{[^}]*max-width: 420px/s);
  assert.match(styles, /\.account-code\s*\{[^}]*repeat\(6, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.account-password \.account-show-password\s*\{/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

function accountSubmission(mode, response) {
  const source = read("app/src/main/assets/web/app.js");
  const start = source.indexOf("  async function submitAccount(");
  const end = source.indexOf("\n  window.cortexAdminLogin", start);
  assert.ok(start > 0 && end > start);
  const requests = [];
  const transitions = [];
  const fields = new Map();
  const label = { textContent: "Отправить" };
  const submit = { disabled: false, firstElementChild: label };
  const error = { hidden: true, textContent: "" };
  const form = {
    dataset: { mode }, isConnected: true, attributes: {},
    querySelector(selector) {
      if (selector === ".form-error") return error;
      if (selector === "[type=submit]") return submit;
      if (selector.startsWith('[name="')) {
        if (!fields.has(selector)) fields.set(selector, { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
        return fields.get(selector);
      }
      return null;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
  const context = {
    TextEncoder,
    Api: {
      available: true, android: true,
      failure(code) { return Object.assign(new Error(code), { code }); },
      async request(operation, payload) {
        requests.push({ operation, payload });
        if (response instanceof Error) throw response;
        return response;
      }
    },
    connection: { status: "ready", checked: true, email: true, emailRegistration: true },
    U: { accountAvailability: () => "" },
    M: { account: () => false },
    emailResendCooldown() { transitions.push(["cooldown"]); },
    emailForm(...args) { transitions.push(args); },
    async refreshConnection() {},
    flash(message) { transitions.push(["flash", message]); },
    route: "account", window: {}, statusEpoch: 0
  };
  const submitAccount = runInNewContext(`${source.slice(start, end)}\nsubmitAccount`, context);
  return { submit: values => submitAccount(form, values), requests, transitions, fields, error, form, button: submit, label };
}

test("Signup normalizes the email and sends the user to the right OTP screen", async () => {
  const auth = accountSubmission("signup", { state: "check_email" });
  await auth.submit({ email: "  TESTER@Example.COM ", password: "correct-password", confirmation: "correct-password", name: "Тест" });
  assert.equal(auth.requests.length, 1);
  assert.equal(auth.requests[0].operation, "auth-signup");
  assert.equal(auth.requests[0].payload.payload.email, "tester@example.com");
  assert.deepEqual(auth.transitions.map(entry => [...entry]), [["cooldown"], ["verify", "tester@example.com"]]);
  assert.equal(auth.button.disabled, false);
  assert.equal(auth.label.textContent, "Отправить");
});

test("Signup rejects different passwords without calling the server", async () => {
  const auth = accountSubmission("signup", { state: "check_email" });
  await auth.submit({ email: "tester@example.com", password: "correct-password", confirmation: "wrong-password" });
  assert.equal(auth.requests.length, 0);
  assert.equal(auth.error.hidden, false);
  assert.match(auth.error.textContent, /Пароли не совпадают/);
  assert.equal(auth.fields.get('[name="confirmation"]').attributes["aria-invalid"], "true");
  assert.equal(auth.button.disabled, false);
});

test("Unconfirmed login goes to verification and unexpected states become visible errors", async () => {
  const unconfirmed = Object.assign(new Error("Подтвердите почту"), { code: "auth_unconfirmed" });
  const auth = accountSubmission("password", unconfirmed);
  await auth.submit({ email: "Tester@Example.com", password: "correct-password" });
  assert.deepEqual(auth.transitions[0], ["verify", "tester@example.com"]);
  assert.equal(auth.error.hidden, true);
  const unknown = accountSubmission("password", { state: "unexpected" });
  await unknown.submit({ email: "tester@example.com", password: "correct-password" });
  assert.equal(unknown.error.hidden, false);
  assert.match(unknown.error.textContent, /Не удалось завершить вход/);
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

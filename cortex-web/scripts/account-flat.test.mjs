import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = path => readFileSync(new URL(path, import.meta.url), "utf8");
const account = css("../app/account/account.css");
const forms = css("../app/account/account-forms.css");
const settings = css("../components/AccountDashboard.tsx");

test("Dashboard uses flat surfaces and divider-based layouts, no glass cards", () => {
  assert.match(account, /\.account-panel\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
  assert.match(account, /\.account-overview-grid\s*\{[^}]*border-top:\s*1px solid/);
  assert.match(account, /\.account-bottom-grid\s*\{[^}]*flex-direction:\s*column;/);
  assert.doesNotMatch(account, /\.account-token-panel::before/);
  assert.match(account, /\.account-status-panel\s*\{[^}]*border-bottom:\s*1px solid/);
});

test("Profile, security, and touch-friendly buttons keep system-style controls", () => {
  assert.match(forms, /\.account-profile-panel,\s*\.account-security-panel\s*\{[^}]*padding:\s*0;/);
  assert.match(forms, /\.account-save-button,\s*\.account-unavailable button\s*\{[^}]*background:\s*#f5f5f5;/);
  assert.match(forms, /min-height:\s*44px;/);
  assert.match(forms, /\.account-field input:focus-visible/);
  assert.match(forms, /\.account-mobile-tabs \.is-active/);
});

test("Flat restyling does not remove account actions, quota or security safeguards", () => {
  for (const name of ["refreshData", "saveProfile", "saveNotifications", "signOutEverywhere"]) {
    assert.match(settings, new RegExp(name));
  }
  assert.match(settings, /account-token-progress/);
  assert.match(settings, /account-security-confirm/);
  assert.match(settings, /account-verified/);
});

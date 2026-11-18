import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));

test("admin sessions are tab scoped and expire when inactive", () => {
  assert.match(client, /storage:\s*window\.sessionStorage/);
  assert.match(client, /IDLE_LIMIT_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(client, /getAuthenticatorAssuranceLevel/);
  assert.match(client, /currentLevel\s*!==\s*"aal2"/);
});

test("admin login has no publicly exposed account creation or bootstrap claim forms", () => {
  assert.doesNotMatch(client, /db\.auth\.signUp\(/);
  assert.doesNotMatch(client, /form\("claim-owner"/);
  assert.doesNotMatch(client, /form\("claim-admin"/);
  assert.match(client, /cortex_control_signin/);
});

test("admin response headers restrict embedding, scripting and access to device APIs", () => {
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /script-src 'self'/);
  assert.match(headers["content-security-policy"], /object-src 'none'/);
  assert.match(headers["permissions-policy"], /camera=\(\)/);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(headers["referrer-policy"], "no-referrer");
});

test("an inclusive Android cutoff uses a verified build code", () => {
  const fn = client.slice(client.indexOf("function releaseCode("), client.indexOf("async function updates()"));
  const code = vm.runInNewContext(fn + "\nreleaseCode");
  assert.equal(code("1.0.13", []), 113);
  assert.equal(code("v1.0.14", []), 114);
  assert.equal(code("1.0.013", []), null);
  assert.equal(code("1.1.0", []), null);
  assert.equal(code("1.1.0", [{ version_name: "1.1.0", version_code: 130 }]), 130);
  assert.equal(code("1.0.13", [{ version_name: "1.0.13", version_code: 99 }]), null);
  assert.match(client, /min_version_code: code \+ 1/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BETA_APK_BUCKET, BETA_APK_MAX_BYTES, BETA_SHARE_SECONDS, BetaInputError,
  parseBetaEmails, betaExpiryFromDays, isBetaInviteActive, betaApkNameIsSafe, validateBetaApk
} from "../beta-utils.js";

const client = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("beta console is available only to privileged staff and reads invitations through the server RPC", () => {
  assert.match(client, /beta: "ЗБТ"/);
  assert.match(client, /role === "admin"\) return \[.*"beta"/);
  assert.match(client, /beta: closedBeta/);
  assert.match(client, /db\.rpc\("cortex_admin_beta", \{ p_operation: "list" \}\)/);
  assert.doesNotMatch(client, /db\.from\("cortex_beta_(?:testers|devices)"\)/);
  assert.match(client, /current\.beta_enabled/);
  assert.match(client, /Нельзя включить ЗБТ без активных приглашений/);
});

test("beta actions require a confirmation and go through the server RPC", () => {
  for (const operation of ["beta-revoke", "beta-restore", "beta-reset", "beta-invite", "beta-mode"])
    assert.match(client, new RegExp(operation));
  assert.match(client, /confirm\(question \+ " для " \+ value \+ "\?"\)/);
  assert.match(client, /db\.rpc\("cortex_admin_beta", \{ p_operation: operation, p_email: value \}\)/);
  assert.match(client, /if \(!confirm\("Выдать или продлить приглашения/);
});

test("invite parsing deduplicates, normalizes, validates and limits batch size", () => {
  assert.deepEqual(parseBetaEmails("Alice@Example.com, bob@example.org\nALICE@EXAMPLE.COM"),
    ["alice@example.com", "bob@example.org"]);
  assert.throws(() => parseBetaEmails(""), BetaInputError);
  assert.throws(() => parseBetaEmails("not-an-email"), BetaInputError);
  assert.throws(() => parseBetaEmails(Array.from({ length: 51 }, (_, i) => `a${i}@test.io`).join("\n")), BetaInputError);
});

test("beta expiry, device-state and APK filename validation are deterministic", () => {
  assert.equal(betaExpiryFromDays(14, Date.UTC(2026, 10, 19)), "2026-12-03T00:00:00.000Z");
  assert.throws(() => betaExpiryFromDays(0), BetaInputError);
  assert.throws(() => betaExpiryFromDays(91), BetaInputError);
  assert.equal(isBetaInviteActive({ state: "active", expires_at: null }), true);
  assert.equal(isBetaInviteActive({ state: "revoked", expires_at: null }), false);
  assert.equal(isBetaInviteActive({ state: "active", expires_at: "2026-11-18T00:00:00Z" }, Date.UTC(2026, 10, 19)), false);
  assert.equal(betaApkNameIsSafe("cortex-1795064705315.apk"), true);
  assert.equal(betaApkNameIsSafe("../sensitive.apk"), false);
});

test("private APK workflow checks SHA-256, caps size and uses 1-hour signed URLs", () => {
  assert.equal(BETA_APK_BUCKET, "cortex-beta-builds");
  assert.equal(BETA_APK_MAX_BYTES, 150 * 1024 * 1024);
  assert.equal(BETA_SHARE_SECONDS, 3600);
  const checksum = "a".repeat(64);
  assert.equal(validateBetaApk({ name: "CORTEX.apk", size: 19e6 }, checksum), checksum);
  assert.throws(() => validateBetaApk({ name: "CORTEX.zip", size: 19e6 }, checksum), BetaInputError);
  assert.throws(() => validateBetaApk({ name: "CORTEX.apk", size: BETA_APK_MAX_BYTES + 1 }, checksum), BetaInputError);
  assert.throws(() => validateBetaApk({ name: "CORTEX.apk", size: 19e6 }, "bad"), BetaInputError);
  assert.match(client, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(client, /actualHash !== expectedHash/);
  assert.match(client, /createSignedUrl\(value, BETA_SHARE_SECONDS/);
  assert.doesNotMatch(client, /getPublicUrl\(/);
});

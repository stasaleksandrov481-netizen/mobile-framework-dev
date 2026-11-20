import assert from "node:assert/strict";
import { test } from "node:test";
import { clearRecoverySession, markRecoverySession, matchesRecoverySession } from "../lib/recovery-session.ts";
import { supportAttachmentUrl } from "../lib/support-attachment-url.ts";

test("recovery is bound to the original account and session across a token refresh", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const stored = new Map();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
  } });
  const token = (id, label) => "fixture." + Buffer.from(JSON.stringify({ session_id: id })).toString("base64url") + "." + label;
  const id = "99e0e7d0-49e7-42b0-be93-6d5362992feb";
  try {
    assert.equal(matchesRecoverySession("alice", token(id, "first")), false);
    markRecoverySession("alice", token(id, "first"));
    assert.equal(matchesRecoverySession("alice", token(id, "refreshed")), true);
    assert.equal(matchesRecoverySession("bob", token(id, "refreshed")), false);
    assert.equal(matchesRecoverySession("alice", token("99e0e7d0-49e7-42b0-be93-6d5362992fec", "second")), false);
    const [key, json] = stored.entries().next().value;
    stored.set(key, JSON.stringify({ ...JSON.parse(json), expiresAt: 0 }));
    assert.equal(matchesRecoverySession("alice", token(id, "refreshed")), false);
    clearRecoverySession();
    assert.equal(stored.size, 0);
  } finally {
    if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    else delete globalThis.sessionStorage;
  }
});

test("support attachments only accept signed HTTPS links from the configured private bucket", () => {
  const origin = "https://project.supabase.co";
  const path = "/storage/v1/object/sign/cortex-support/demo.png?token=fixture";
  assert.equal(supportAttachmentUrl(origin + path, origin), origin + path);
  for (const url of [undefined, "https://another.supabase.co" + path, "http://project.supabase.co" + path,
    origin + "/storage/v1/object/sign/another/demo.png?token=fixture", origin + path.split("?")[0]]) {
    assert.equal(supportAttachmentUrl(url, origin), undefined);
  }
});

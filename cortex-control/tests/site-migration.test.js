import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url));
const filename = migrations.find(name => name.endsWith("_cortex_admin_site_metrics.sql"));
const sql = readFileSync(new URL("../../supabase/migrations/" + filename, import.meta.url), "utf8");

test("website stats aggregate without reading out personal fields", () => {
  assert.match(sql, /count\(\*\)/);
  assert.match(sql, /jsonb_agg\(/);
  assert.doesNotMatch(sql, /select\s+email|jsonb_build_object\([^]*['"]email['"]/i);
});

test("website metrics require authorized MFA session even through the public RPC", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /'aal2'/);
  assert.match(sql, /role::text in \('owner', 'admin'\)/);
  assert.match(sql, /auth\.sessions/);
  assert.match(sql, /revoke execute on function cortex_private\.admin_site_metrics\(\)/);
  assert.match(sql, /grant execute on function cortex_private\.admin_site_metrics\(\)/);
});

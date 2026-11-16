import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const migration = read("supabase/migrations/20261116125818_cortex_guest_identity_and_metrics.sql");
const server = read("supabase/functions/cortex/handler.ts");
const app = read("app/src/main/assets/web/screens.js");
const admin = read("cortex-control/app.js");

test("guest IDs are a separate short namespace and not a login credential", () => {
  assert.match(migration, /create table if not exists public\.cortex_guest_public_ids/);
  assert.match(migration, /'@g' \|\| lpad/);
  assert.match(migration, /alter table public\.cortex_guest_public_ids enable row level security/);
  assert.match(migration, /revoke all on public\.cortex_guest_public_ids from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.cortex_public_guest\(text\) to service_role/);
  assert.match(server, /guest_id: guestId/);
  assert.match(app, /profile-id-details/);
  assert.doesNotMatch(app, /ID аккаунта ·/);
});

test("admin guest lookup is MFA-protected and admin changes resolve to the real subject", () => {
  assert.match(migration, /create or replace function cortex_private\.admin_resolve_guest/);
  assert.match(migration, /coalesce\(auth\.jwt\(\)->>'aal',''\) <> 'aal2'/);
  assert.match(migration, /auth\.sessions where user_id=caller/);
  assert.match(admin, /cortex_admin_resolve_guest/);
  assert.match(admin, /p_subject: target, p_operation: operation/);
});

test("live analytics dedupe stable Android devices and separate questions from upstream attempts", () => {
  assert.match(migration, /count\(distinct device_hash\).*opened_at >= now\(\)-interval '24 hours'/);
  assert.match(migration, /cortex_ai_requests/);
  assert.match(migration, /ai_attempts_today/);
  assert.match(migration, /cortex_app_sessions s on s\.id=l\.id/);
  assert.match(admin, /cortex_admin_metrics/);
  assert.doesNotMatch(admin, /db\.rpc\("cortex_admin_overview"\)/);
  assert.match(server, /cortex_track_ai_request/);
});

test("free provider budget and token shortage have distinct error descriptions", () => {
  assert.match(server, /CORTEX_DAILY_REQUEST_LIMIT\) \|\| 1000/);
  assert.match(server, /"context_limit"/);
  assert.match(read("app/src/main/assets/web/gateway.js"), /context_limit:/);
});

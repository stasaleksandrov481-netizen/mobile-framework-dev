// Design-review stand only: replaces @supabase/supabase-js in a local preview
// build (tests/preview/build.mjs). Never bundled into the production build.
const now = Date.now();
const iso = minutes => new Date(now - minutes * 60_000).toISOString();

const rpc = {
  cortex_control_signin: true,
  cortex_admin_public_id: "@id100001",
  cortex_admin_metrics: {
    online_devices: 37, devices: 4812, opened_24h: 1290, new_today: 84, opened_today: 1104, accounts_today: 612,
    launches_total: 91234, ai_requests_today: 5321, ai_requests_total: 188410, ai_attempts_today: 5604,
    ai_success_today: 5512, support_open: 6,
    online: [
      { public_id: "@id104233", signed_in: true, last_seen_at: iso(1), version: "1.0.18-beta.10" },
      { public_id: "@id100982", signed_in: false, last_seen_at: iso(2), version: "1.0.18-beta.9" },
      { public_id: "@id107711", signed_in: true, last_seen_at: iso(2), version: "1.0.18-beta.10" }
    ]
  },
  cortex_admin_activity: { today: [
    { public_id: "@id104233", opened_at: iso(12), devices: 1 }, { public_id: "@id109001", opened_at: iso(48), devices: 2 }
  ] },
  cortex_admin_site_metrics: { total: 848, today: 41, last_24h: 63, notifications: 512, daily: [
    { day: "2026-11-14", count: 88 }, { day: "2026-11-15", count: 120 }, { day: "2026-11-16", count: 141 },
    { day: "2026-11-17", count: 210 }, { day: "2026-11-18", count: 176 }, { day: "2026-11-19", count: 72 }, { day: "2026-11-20", count: 41 }
  ] },
  cortex_list_admin_roles: [
    { email: "owner@example.invalid", role: "owner" }, { email: "dev@example.invalid", role: "admin" },
    { email: "help@example.invalid", role: "support" }
  ],
  cortex_admin_ai: { requests_day: 800, requests_minute: 12, model: "nvidia/nemotron-3.5-lightning:free" },
  cortex_admin_billing: { paid_accounts: 23, collected: 918000, refunded: 39900,
    funding: { committed_micros: 41_200_000, funded_micros: 120_000_000, checkout_enabled: false },
    models: [{ model: "anthropic/claude-sonnet-5.5", calls: 412, measured_micros: 9_120_000, unsettled_micros: 210_000 },
      { model: "openai/gpt-6.1-sol", calls: 233, measured_micros: 4_870_000, unsettled_micros: 0 }],
    plans: [{ code: "start", price_kopecks: 19900, daily_tokens: 40000, advanced_tokens: 4000, enabled: true },
      { code: "pro", price_kopecks: 39900, daily_tokens: 100000, advanced_tokens: 20000, enabled: true },
      { code: "ultra", price_kopecks: 79900, daily_tokens: 200000, advanced_tokens: 60000, enabled: true }],
    grants: [] },
  cortex_admin_beta: { enabled: true, invites: [], devices: [] }
};

const tables = {
  cortex_admin_roles: { role: "owner" },
  cortex_support: [
    { id: "4f6a1b2c-0000-4000-8000-000000000001", created_at: iso(14), category: "bug", status: "open", app_version: "1.0.18-beta.10",
      message: "Островок пропадает после блокировки экрана на Xiaomi. Приходится заново включать в настройках.", reply_to: "@id104233" },
    { id: "4f6a1b2c-0000-4000-8000-000000000002", created_at: iso(95), category: "contact", status: "in_progress", app_version: "1.0.18-beta.9",
      message: "Как перенести бонусные токены на другой аккаунт?", reply_to: "@id100982" },
    { id: "4f6a1b2c-0000-4000-8000-000000000003", created_at: iso(300), category: "idea", status: "answered", app_version: "1.0.18-beta.10",
      message: "Добавьте, пожалуйста, тёмную тему для островка с прозрачностью.", reply_to: "@id107711" }
  ],
  cortex_support_replies: [],
  cortex_admin_audit: [
    { event: "role.grant", target: "dev@example.invalid", created_at: iso(30) },
    { event: "config.maintenance", target: "off", created_at: iso(240) },
    { event: "billing.plan", target: "pro", created_at: iso(1440) }
  ],
  cortex_control_config: { maintenance: false, maintenance_message: "", min_version_code: 120, latest_version_code: 127 },
  cortex_release_versions: [
    { version_name: "1.0.18-beta.10", version_code: 127, published_at: iso(600), mandatory: false },
    { version_name: "1.0.18-beta.9", version_code: 126, published_at: iso(1900), mandatory: false }
  ]
};

function builder(name) {
  let single = false;
  const result = () => {
    const value = tables[name];
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    return { data: single ? (Array.isArray(value) ? value[0] ?? null : value ?? null) : rows, error: null, count: rows.length };
  };
  const chain = new Proxy({}, {
    get(_, key) {
      if (key === "then") return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      if (key === "maybeSingle" || key === "single") return () => { single = true; return chain; };
      return () => chain;
    }
  });
  return chain;
}

export function createClient() {
  const ok = data => Promise.resolve({ data, error: null });
  return {
    auth: {
      getSession: () => ok({ session: { access_token: "preview" } }),
      getUser: () => ok({ user: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.invalid" } }),
      mfa: { getAuthenticatorAssuranceLevel: () => ok({ currentLevel: "aal2" }), listFactors: () => ok({ all: [], totp: [] }) },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => ok(null)
    },
    rpc: name => ok(rpc[name] ?? null),
    from: name => builder(name),
    storage: { from: () => ({ list: () => ok([{ name: "CORTEX-1.0.18-beta.10.apk", created_at: iso(600), metadata: { size: 19_200_000 } }]),
      createSignedUrl: () => ok({ signedUrl: "https://example.invalid/apk" }), upload: () => ok({}) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {}
  };
}

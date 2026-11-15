import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./handler.ts";
import { createControl } from "./control.ts";

const install = "A".repeat(43);
const otherInstall = "B".repeat(43);
const accountId = "98d87a12-240b-4a57-95e0-7bc0bbbd0f42";
const ticketId = "2f343286-09bb-4e8e-9aa3-21ecc664219b";
const replyId = "1f8188b2-9176-4be1-b0cf-8d9ef890eaa0";

function fixture(maintenance = false, streamedReply?: () => Response, remaining = 15000, globalLimit = 50, emailReady = true) {
  let ticket: Record<string, unknown> | null = null;
  let login: Record<string, unknown> | null = null;
  const models: string[] = [];
  const requests: string[] = [];
  const usage = new Map<string, number>();
  const attempts = new Map<string, string>();
  let approvedAccount: Record<string, unknown> | undefined;
  let exchangeClaimed = false;
  const sampleUser = { id: accountId, email: "admin@example.test", email_confirmed_at: "2026-11-13T12:00:00.000Z" };
  const quota = (id: string) => {
    const used = usage.get(id) ?? 15000 - remaining;
    return { id, used, unit: "tokens", allowed: used < 15000, remaining: Math.max(0, 15000 - used),
      limit: 15000, reset_at: new Date(Date.now() + 3600000).toISOString(), history: [] };
  };
  const app = createHandler({
    SUPABASE_URL: "https://examplecortex.supabase.co",
    SUPABASE_ANON_KEY: "test-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    OPENROUTER_API_KEY: "test-key",
    YANDEX_CLIENT_ID: "yandex-test-app",
    YANDEX_CLIENT_SECRET: "yandex-test-secret",
    CORTEX_EMAIL_AUTH: emailReady ? "true" : undefined,
    OPENROUTER_MODEL: "example/unavailable:free",
    OPENROUTER_FALLBACK_MODEL: "example/working:free",
  }, async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) :
      init?.body ? JSON.parse(String(init.body)) : {};
    requests.push(method + " " + url.pathname);

    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/chat/completions") {
      assert.equal(body.usage.include, true);
      assert.equal(body.provider.max_price.prompt, 0);
      assert.equal(body.provider.max_price.completion, 0);
      assert.match(body.model, /:free$/);
      models.push(body.model);
      if (body.tools?.[0]?.function?.name === "plan_android_screen") {
        assert.equal(body.tool_choice, "required");
        assert.equal(body.stream, false);
        return Response.json({ choices: [{ message: { tool_calls: [{
          function: { name: "plan_android_screen", arguments: '{"steps":[{"action":"unknown"}]}' },
        }] } }], usage: { prompt_tokens: 82, completion_tokens: 18 } });
      }
      if (body.response_format?.type === "json_schema") {
        assert.equal(body.provider.require_parameters, true);
        assert.equal(body.provider.sort, "latency");
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          steps: [{ action: "open", target: "Настройки" }, { action: "tap", target: "Дисплей" }], done: true,
        }) } }], usage: { prompt_tokens: 82, completion_tokens: 18 } });
      }
      if (body.model === "example/unavailable:free") {
        return Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 });
      }
      if (body.stream) {
        if (streamedReply) return streamedReply();
        return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"usage":{"prompt_tokens":82,"completion_tokens":18}}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 82, completion_tokens: 18 } });
    }
    if (url.hostname === "oauth.yandex.ru" && url.pathname === "/token") {
      assert.equal(body.grant_type, "authorization_code");
      assert.equal(body.code_verifier, login?.p_verifier);
      assert.equal(body.code, "test-yandex-code");
      assert.equal(body.client_secret, "yandex-test-secret");
      return Response.json({ access_token: "example-yandex-access-token" });
    }
    if (url.hostname === "login.yandex.ru" && url.pathname === "/info") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "OAuth example-yandex-access-token");
      return Response.json({ id: "123456789", client_id: "yandex-test-app", default_email: "qa@example.test", display_name: "QA" });
    }
    switch (url.pathname) {
      case "/rest/v1/cortex_control_config":
        return Response.json([{ maintenance_enabled: maintenance, maintenance_message: "Обновление", block_old_versions: false }]);
      case "/rest/v1/cortex_sessions":
        return Response.json(url.searchParams.has("expires_at") ? [
          { account: { id: accountId, email: "admin@example.test", name: "QA", provider: "Google", avatar: "" } },
        ] : []);
      case "/rest/v1/cortex_release_versions": return Response.json([]);
      case "/rest/v1/cortex_admin_roles": return Response.json([{ role: "admin" }]);

      case "/rest/v1/cortex_ai_settings": return Response.json([{ model: null }]);
      case "/rest/v1/rpc/cortex_claim_guest": return Response.json(true);
      case "/auth/v1/signup":
      case "/auth/v1/recover": return Response.json({ user: { id: accountId } });
      case "/auth/v1/verify":
        if (body.token !== "123456") return Response.json({ code: "otp_expired" }, { status: 403 });
        return Response.json({ user: sampleUser, access_token: "supabase-test-access" });
      case "/auth/v1/user":
        assert.equal(method, "PUT");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer supabase-test-access");
        return Response.json(sampleUser);
      case "/auth/v1/logout": return new Response(null, { status: 204 });
      case "/rest/v1/rpc/cortex_begin_login":
        login = body;
        exchangeClaimed = false;
        return Response.json(null);
      case "/rest/v1/cortex_auth_flows":
        assert.ok(login);
        assert.equal(url.searchParams.get("state_hash"), "eq." + login.p_state_hash);
        if (body.stage === "exchanging") {
          if (exchangeClaimed) return Response.json([]);
          exchangeClaimed = true;
          return Response.json([{ verifier: login.p_verifier }]);
        }
        approvedAccount = body.account;
        return Response.json([{ stage: body.stage }]);
      case "/rest/v1/rpc/cortex_finish_login":
        return Response.json(approvedAccount ? { state: "signed_in", account: approvedAccount } : { state: "pending" });
      case "/auth/v1/token":
        assert.equal(url.searchParams.get("grant_type"), "password");
        if (body.password === "unverified") return Response.json({ code: "email_not_confirmed" }, { status: 403 });
        return Response.json({ user: sampleUser });
      case "/rest/v1/rpc/cortex_reserve":
      case "/rest/v1/cortex_installs":
      case "/rest/v1/cortex_app_sessions": return Response.json(null);
      case "/rest/v1/rpc/cortex_ai_usage": return Response.json(quota(body.p_subject));
      case "/rest/v1/rpc/cortex_ai_reserve": {
        const id = String(body.p_subject);
        const snapshot = quota(id);
        assert.equal(body.p_day_cap, 50);
        assert.equal(body.p_minute_cap, 20);
        if (attempts.size >= globalLimit) return Response.json({ quota: snapshot, error: "provider_quota_daily", retry_after: 111 });
        if (!snapshot.allowed) return Response.json({ quota: snapshot, error: "daily_limit" });
        const attempt = crypto.randomUUID();
        attempts.set(attempt, id);
        return Response.json({ quota: snapshot, attempt, max_output: body.p_output });
      }
      case "/rest/v1/rpc/cortex_ai_finish": {
        const id = attempts.get(body.p_attempt)!;
        if (body.p_input !== null) usage.set(id, quota(id).used + body.p_input + body.p_output);
        return Response.json(body.p_input === null ? null : quota(id));
      }
      case "/rest/v1/cortex_support":
        if (method === "POST") {
          if (!ticket) ticket = body;
          return Response.json(null);
        }
        if (!ticket) return Response.json([]);
        if (url.searchParams.get("device_hash")?.includes(String(ticket.device_hash))) {
          return Response.json([ticket]);
        }
        return Response.json([]);
      case "/rest/v1/cortex_support_replies":
        assert.equal(url.searchParams.get("ticket_id"), "in.(" + ticketId + ")");
        return Response.json([{ id: replyId, ticket_id: ticketId, message: "Получили ваше сообщение." }]);
      default: throw new Error("Unexpected endpoint " + url.pathname);
    }
  });
  function call(path: string, payload?: unknown, headers: Record<string, string> = {}) {
    return app(new Request("https://examplecortex.supabase.co/functions/v1/cortex/v1/" + path, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "x-cortex-install": install, "x-cortex-version-code": "100", "x-cortex-version-name": "1.0.0", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }));
  }
  return { call, models, requests };
}

test("uses a stable guest ID and rejects the next AI call at the daily limit", async () => {
  const { call, models } = fixture(false, undefined, 100);
  const read = async (headers: Record<string, string> = {}) => (await (await call("status", undefined, headers)).json()).quota;
  const before = await read();
  assert.match(before.id, /^guest_[A-Za-z0-9_-]{43}$/);
  assert.equal((await read()).id, before.id);
  assert.notEqual((await read({ "x-cortex-install": otherInstall })).id, before.id);
  const last = await call("check", {});
  assert.equal(last.status, 200);
  assert.equal((await last.json()).quota.remaining, 0);
  const attempts = models.length;
  const rejected = await call("check", {});
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error, "daily_limit");
  assert.equal(models.length, attempts);
});

test("Android Yandex callback uses PKCE and does not put a bearer token in the redirect", async () => {
  const { call } = fixture();
  const start = await call("auth/start?return=android", {});
  assert.equal(start.status, 200);
  const { url, poll } = await start.json();
  assert.match(poll, /^[A-Za-z0-9_-]{43}$/);
  const authorize = new URL(url);
  assert.equal(authorize.origin, "https://oauth.yandex.ru");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const callback = new URL(String(authorize.searchParams.get("redirect_uri")));
  assert.equal(callback.protocol, "https:");
  assert.match(callback.pathname, /\/auth\/callback\/yandex$/);
  const state = authorize.searchParams.get("state");
  const returned = await call("auth/callback/yandex?state=" + state + "&code=test-yandex-code");
  assert.equal(returned.status, 303);
  assert.equal(returned.headers.get("location"), "app.cortex.assistant://oauth/return");
  assert.match(await returned.text(), /Вход выполнен/);
  const repeated = await call("auth/callback/yandex?state=" + state + "&code=test-yandex-code");
  assert.match(await repeated.text(), /Вход не завершён/);
  const signedIn = await (await call("auth/poll", { code: poll })).json();
  assert.equal(signedIn.account.provider, "Yandex");
  assert.match(signedIn.account.id, /^yandex_[A-Za-z0-9_-]{43}$/);
  assert.match(signedIn.token, /^[A-Za-z0-9_-]{43}$/);
});

test("Yandex callback routes to the requesting preview and rejects arbitrary schemes", async () => {
  const { call } = fixture();
  assert.equal((await call("auth/start?return=android&scheme=another.app", {})).status, 400);
  const scheme = "app.cortex.assistant.preview.v103";
  const start = await call("auth/start?return=android&scheme=" + scheme, {});
  assert.equal(start.status, 200);
  const authorize = new URL((await start.json()).url);
  const state = authorize.searchParams.get("state");
  assert.match(state ?? "", /^android-v103-[A-Za-z0-9_-]{43}$/);
  const returned = await call("auth/callback/yandex?state=" + state + "&code=test-yandex-code");
  assert.equal(returned.headers.get("location"), scheme + "://oauth/return");
});

test("email signup and password reset verify the code before issuing or revoking sessions", async () => {
  const { call, requests } = fixture();
  const email = "admin@example.test";
  const password = "long QA password 2026";
  const signup = await call("auth/signup", { email, password });
  assert.deepEqual(await signup.json(), { state: "check_email" });
  const denied = await call("auth/password", { email, password: "unverified" });
  assert.equal((await denied.json()).error, "auth_unconfirmed");
  const wrongCode = await call("auth/verify", { email, code: "000000" });
  assert.equal(wrongCode.status, 403);
  const accepted = await (await call("auth/verify", { email, code: "123456" })).json();
  assert.equal(accepted.account.provider, "Email");
  assert.equal(accepted.account.id, accountId);
  assert.match(accepted.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call("auth/recover", { email })).status, 200);
  const reset = await (await call("auth/reset", { email, code: "123456", password })).json();
  assert.deepEqual(reset, { state: "password_changed" });
  assert.ok(requests.includes("DELETE /rest/v1/cortex_sessions"));
  assert.ok(requests.includes("POST /auth/v1/logout"));
});

test("global free provider budget includes model retries", async () => {
  const { call, models } = fixture(false, undefined, 15000, 1);
  const response = await call("check", {});
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "provider_quota_daily");
  assert.deepEqual(models, ["example/unavailable:free"]);
});

test("retries a rate-limited provider with a different :free model", async () => {
  const { call, models } = fixture();
  const response = await call("check", {});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.connected, true);
  assert.equal(result.quota.used, 100);
  assert.deepEqual(models, ["example/unavailable:free", "example/working:free"]);
});

test("support submission persists its owner and only that installation can read replies", async () => {
  const { call } = fixture();
  const input = { id: ticketId, kind: "complaint", text: "Проверка доставки" };
  assert.equal((await call("support", input)).status, 200);
  assert.equal((await call("support", input)).status, 200);
  assert.equal((await call("support", input, { "x-cortex-install": otherInstall })).status, 409);
  const owner = await (await call("support/inbox")).json();
  assert.equal(owner.tickets[0].id, ticketId);
  assert.equal(owner.replies[0].id, replyId);
  assert.deepEqual(await (await call("support/inbox", undefined, { "x-cortex-install": otherInstall })).json(),
    { tickets: [], replies: [] });
});

test("maintenance blocks ordinary chat and permits an authenticated admin", async () => {
  const { call, models } = fixture(true);
  assert.equal((await (await call("status")).json()).gate.mode, "maintenance");
  assert.equal((await call("check", {})).status, 403);
  assert.equal(models.length, 0);
  const token = { Authorization: "Bearer " + "T".repeat(43) };
  assert.equal((await (await call("status", undefined, token)).json()).gate.mode, "open");
  assert.equal((await call("check", {}, token)).status, 200);
});

test("presence validates identifiers and records both install and session", async () => {
  const { call, requests } = fixture();
  assert.equal((await call("presence", { session_id: "bad", screen: "home" })).status, 400);
  const response = await call("presence", { session_id: replyId, screen: "chat" });
  assert.equal(response.status, 200);
  assert.ok(requests.includes("POST /rest/v1/cortex_installs"));
  assert.ok(requests.includes("PATCH /rest/v1/cortex_app_sessions"));
});

test("an older APK gets a verified HTTPS update link", async () => {
  const control = createControl(async <T>() => [{
    maintenance_enabled: false, block_old_versions: true, min_version_code: 100,
    update_url: "https://github.com/example/CORTEX/releases/latest",
  }] as T);
  const gate = await control.gate(new Request("https://example.test", { headers: { "x-cortex-version-code": "92" } }));
  assert.equal(gate.mode, "update");
  assert.match(gate.update_url!, /^https:\/\//);
});

function chatPayload(text: string, tools = true) {
  return { messages: [{ role: "user", content: text }], style: "brief", device_tools: tools };
}

function sseReply(frames: Array<object | "[DONE]">, keepOpen = false): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode("data: " + (typeof frame === "string" ? frame : JSON.stringify(frame)) + "\n\n"));
      }
      if (!keepOpen) controller.close();
    },
    cancel() { if (keepOpen) return new Promise<void>(() => {}); },
  }), { headers: { "content-type": "text/event-stream" } });
}

test("ordinary chat completes with device tools enabled", async () => {
  const { call } = fixture();
  const response = await call("chat", chatPayload("Привет"));
  assert.equal(response.status, 200);
  const received = await response.text();
  assert.match(received, /data: {"delta":"OK"}/);
  assert.match(received, /"unit":"tokens","allowed":true,"remaining":14900/);
  assert.match(received, /data: \[DONE\]\n\n$/);
});

test("streams a validated Android tool call and closes before waiting for upstream cleanup", { timeout: 2000 }, async () => {
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { tool_calls: [{ index: 0, type: "function", function: { name: "inspect_phone", arguments: '{"target":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"battery"}' } }] }, finish_reason: "tool_calls" }] },
    "[DONE]",
  ], true));
  const response = await call("chat", chatPayload("Проверь заряд телефона"));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data: {"tool":{"kind":"read_device","target":"battery"}}\n\ndata: \[DONE\]\n\n$/);
});

test("preserves a mixed Android plan in provider order", async () => {
  const steps = [
    { kind: "torch", mode: "on" },
    { kind: "screen_task", target: "Any installed app", goal: "Open the requested page" },
    { kind: "torch", mode: "off" },
    { kind: "close_app", target: "Any installed app" },
    { kind: "capture_photo", lens: "front" },
    { kind: "lock_screen" },
  ];
  const args = JSON.stringify({ steps });
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "execute_phone_plan", arguments: args.slice(0, 37) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(37) } }] } }] },
    "[DONE]",
  ]));
  const response = await call("chat", { ...chatPayload("Выполни цепочку действий"), action_plan: true });
  const data = (await response.text()).split("\n").find(line => line.startsWith('data: {"tools":'));
  assert.ok(data);
  assert.deepEqual(JSON.parse(data.slice(6)).tools, steps);
});

test("older clients cannot receive a screen-task tool", async () => {
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "execute_phone_plan", arguments: '{"steps":[{"kind":"screen_task","target":"Example","goal":"Open the list"}]}' } }] } }] },
    "[DONE]",
  ]));
  const response = await call("chat", chatPayload("Open the list"));
  assert.match(await response.text(), /data: {"tool_error":"tool_arguments"}/);
});

test("screen task includes opening its app and preserves following actions", async () => {
  const steps = [
    { kind: "app", target: "Browser" }, { kind: "screen_task", target: "browser", goal: "Find books" },
    { kind: "app", target: "YouTube", section: "shorts" }, { kind: "lock_screen" },
  ];
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "execute_phone_plan", arguments: JSON.stringify({ steps }) } }] } }] },
    "[DONE]",
  ]));
  const response = await call("chat", { ...chatPayload("Выполни задачу"), action_plan: true });
  const data = (await response.text()).split("\n").find(line => line.startsWith('data: {"tools":'));
  assert.ok(data);
  assert.deepEqual(JSON.parse(data.slice(6)).tools, [steps[1], { kind: "screen_task", target: "YouTube", goal: "Открой раздел shorts" }, steps[3]]);
});

test("rejects a whole plan with an invalid later step", async () => {
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "execute_phone_plan", arguments: '{"steps":[{"kind":"torch","mode":"on"},{"kind":"screen_task","target":"Example"}]}' } }] } }] },
    "[DONE]",
  ]));
  const response = await call("chat", { ...chatPayload("Выполни задачу"), action_plan: true });
  const data = await response.text();
  assert.match(data, /data: {"tool_error":"tool_arguments"}/);
  assert.doesNotMatch(data, /data: {"tools?":/);
});

test("delivers an explicit error after interrupted output and ends the stream", { timeout: 2000 }, async () => {
  const { call } = fixture(false, () => sseReply([
    { choices: [{ delta: { content: "Начало ответа" } }] },
    { error: { code: 502 } },
  ], true));
  const response = await call("chat", chatPayload("Привет", false));
  const stream = await response.text();
  assert.match(stream, /data: {"delta":"Начало ответа"}/);
  assert.match(stream, /data: {"error":"provider"}\n\n$/);
});

test("a malformed visual tool response is replaced by a validated plan and both calls are counted", async () => {
  const { call, models } = fixture();
  const response = await call("chat", { messages: [{ role: "user", content: "Открой настройки и раздел Дисплей" }],
    visual_plan: true, profile: "fast" });
  assert.equal(response.status, 200);
  const { text, quota } = await response.json();
  assert.deepEqual(JSON.parse(text).steps.map((step: { action: string }) => step.action), ["open", "tap"]);
  assert.equal(quota.used, 200);
  assert.equal(models.length, 2);
});

test("verified password login is available during SMTP configuration", async () => {
  const { call, requests } = fixture(false, undefined, 15000, 50, false);
  const status = await (await call("status")).json();
  assert.equal(status.email_login, true);
  assert.equal(status.email_auth, false);
  const credentials = { email: "admin@example.test", password: "a-test-password" };
  const unavailable = await call("auth/signup", credentials);
  assert.equal((await unavailable.json()).error, "account_config");
  assert.ok(!requests.includes("POST /auth/v1/signup"));
  const signedIn = await call("auth/password", credentials);
  assert.equal((await signedIn.json()).state, "signed_in");
});

test("maintenance access does not bypass closed beta admission", async () => {
  let allowed = false;
  const requests: string[] = [];
  const control = createControl(async <T>(path: string) => {
    requests.push(path);
    if (path.startsWith("cortex_control_config")) return [{
      maintenance_enabled: true, block_old_versions: false, beta_enabled: true, beta_message: "Закрытый тест"
    }] as T;
    if (path.startsWith("cortex_public_accounts")) return [{ maintenance_until: "2999-01-01T00:00:00Z" }] as T;
    if (path === "rpc/cortex_beta_admit") return allowed as T;
    return [] as T;
  });
  const request = new Request("https://example.test", { headers: { "x-cortex-install": install } });
  assert.equal((await control.gate(request)).mode, "maintenance");
  const account = { id: accountId, email: "tester@example.test" };
  assert.equal((await control.gate(request, account)).mode, "beta");
  assert.ok(requests.includes("rpc/cortex_beta_admit"));
  allowed = true;
  assert.equal((await control.gate(request, account)).mode, "open");
});

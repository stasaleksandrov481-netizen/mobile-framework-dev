import {
  type Account, type Network, type ModelProfile, type ModelResponse, type MeasuredUsage, Failure, body, chatInput, completeText, completion,
  confirmedQuota, failureBody, relay, retryableModelError,
  supportInput, verifyCompletion,
} from "./provider.ts";
import { createControl } from "./control.ts";
import { checkedVisualPlan, visualFormat, visualGuide, visualTool, visualToolName } from "./visual.ts";

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const ANDROID_SCHEME = "app.cortex.assistant";
const PREVIEW_SCHEME = /^app\.cortex\.assistant\.preview\.(v[0-9]{1,6})$/;
const PROJECT = /^[a-z0-9]{6,63}\.supabase\.co$/;
const USER_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const YANDEX_CALLBACK = "/v1/auth/callback/yandex";
const FREE_MODEL = /^[a-z0-9._-]+\/[a-z0-9._-]+:free$/;
const JSON_HEADERS = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};

type Env = Record<string, string | undefined>;
type Limit = { bucket: string; seconds: number; maximum: number };
type Login = { state: string; account?: Account };
type Quota = {
  id: string;
  unit: "tokens";
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number | null;
  reset_at: string;
  time_zone: string;
  allowed: boolean;
  plan?: string;
  context_chars?: number;
  advanced_tokens?: number;
};

class BudgetFailure extends Failure {
  constructor(code: string, seconds: number, readonly quota: Quota) {
    super(code, 429, seconds);
  }
}

function configuredKey(env: Env, dictionary: string, legacy: string): string {
  try {
    const current: unknown = JSON.parse(env[dictionary] || "{}").default;
    if (typeof current === "string" && current.trim()) return current.trim();
  } catch { /* The legacy keys remain valid for projects that still use them. */ }
  return env[legacy]?.trim() || "";
}

function origin(value: string | undefined, publicProject = false): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return "";
    if (publicProject) return url.protocol === "https:" && PROJECT.test(url.hostname) && !url.port ? url.origin : "";
    return url.protocol === "https:" || url.protocol === "http:" && ["kong", "localhost", "127.0.0.1"].includes(url.hostname)
      ? url.origin : "";
  } catch { return ""; }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function secret(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: JSON_HEADERS });
}
function androidReturn(path: string) {
  const match = /^android-(?:(v[0-9]{1,6})-)?([A-Za-z0-9_-]{43})$/.exec(path);
  if (!match) return { scheme: path.startsWith("android-") ? ANDROID_SCHEME : "", state: path };
  return { scheme: match[1] ? ANDROID_SCHEME + ".preview." + match[1] : ANDROID_SCHEME, state: match[2] };
}

function browserResult(success: boolean, scheme = ""): Response {
  const title = success ? "Вход выполнен" : "Вход не завершён";
  const headers: Record<string, string> = { ...JSON_HEADERS, "Content-Type": "text/plain; charset=utf-8" };
  if (scheme) headers.Location = scheme + "://oauth/return";
  return new Response(title + ". Вернитесь в приложение CORTEX.", { headers, status: scheme ? 303 : 200 });
}

function bearer(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") && CAPABILITY.test(value.slice(7)) ? value.slice(7) : "";
}

function apiHeaders(key: string): Headers {
  const headers = new Headers({ apikey: key, "Content-Type": "application/json" });
  if (key.split(".").length === 3) headers.set("Authorization", "Bearer " + key);
  return headers;
}

type EmailUser = {
  id?: string; email?: string; email_confirmed_at?: string; user_metadata?: { name?: string };
};

function checkedEmail(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 254 || !EMAIL.test(raw.trim())) throw new Failure("invalid_email", 400);
  return raw.trim().toLowerCase();
}

function checkedPassword(raw: unknown, fresh: boolean): string {
  if (typeof raw !== "string" || raw.length < (fresh ? 10 : 1) || new TextEncoder().encode(raw).length > 72) {
    throw new Failure("invalid_password", 400);
  }
  return raw;
}

export function createHandler(env: Env, network: Network = fetch): (request: Request) => Promise<Response> {
  const api = origin(env.SUPABASE_URL);
  const publicApi = origin(env.CORTEX_SUPABASE_PUBLIC_URL || env.SUPABASE_URL, true);
  const publicKey = configuredKey(env, "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const adminKey = configuredKey(env, "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const environmentModelKey = env.OPENROUTER_API_KEY?.trim() || "";
  const paidKey = env.CORTEX_PAID_OPENROUTER_KEY?.trim() || "";
  const paidFast = env.CORTEX_PAID_FAST_MODEL?.trim() || "";
  const paidDeep = env.CORTEX_PAID_DEEP_MODEL?.trim() || "";
  const paidModelId = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;
  const billingOrigin = origin(env.CORTEX_BILLING_ORIGIN);
  const billingToken = env.CORTEX_BILLING_TOKEN?.trim() || "";
  const checkoutReady = Boolean(env.CORTEX_BILLING_CHECKOUT === "true" && billingOrigin && billingToken &&
    paidKey && paidModelId.test(paidFast) && paidModelId.test(paidDeep));
  const yandexId = env.YANDEX_CLIENT_ID?.trim() || "";
  const yandexSecret = env.YANDEX_CLIENT_SECRET?.trim() || "";
  const yandex = Boolean(publicApi && /^[a-zA-Z0-9_-]{8,128}$/.test(yandexId) && yandexSecret);
  const yandexRedirect = publicApi + "/functions/v1/cortex" + YANDEX_CALLBACK;
  const emailLogin = Boolean(api && publicKey && env.CORTEX_EMAIL_AUTH !== "false");
  const emailReady = emailLogin && env.CORTEX_EMAIL_AUTH === "true";
  const models = [...new Set([
    (env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-lightning:free").trim(),
    (env.OPENROUTER_FALLBACK_MODEL ?? "nvidia/nemotron-3.5-super-vl:free").trim(),
    "cohere/north-mini-code:free",
  ].filter(model => FREE_MODEL.test(model)))];
  const profiles: Record<ModelProfile, string[]> = {
    auto: ["nvidia/nemotron-3.5-lightning:free", "inclusionai/ling-3.2-flash:free", "cohere/north-mini-code:free"],
    fast: ["nvidia/nemotron-3.5-lightning:free", "inclusionai/ling-3.2-flash:free", "cohere/north-mini-code:free"],
    deep: ["nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemma-4-31b-it:free", "cohere/north-mini-code:free", "nvidia/nemotron-3.5-super-vl:free"],
  };
  const visualSchemas = [
    "inclusionai/ling-3.2-flash:free", "baidu/ernie-5.5-flash-preview:free",
    "nvidia/nemotron-3.5-super-vl:free",
  ];
  const visualTools = ["nvidia/nemotron-3.5-lightning:free", "cohere/north-mini-code:free"];
  const dayCap = Math.max(1, Math.min(1000, Math.floor(Number(env.CORTEX_DAILY_REQUEST_LIMIT) || 50)));
  const minuteCap = Math.max(1, Math.min(20, Math.floor(Number(env.CORTEX_MINUTE_REQUEST_LIMIT) || 20)));
  const allow = new Set((env.CORTEX_ALLOWED_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  const guests = !allow.size && env.CORTEX_GUEST_ACCESS !== "false";
  const allowed = (email: string) => !allow.size || allow.has(email.toLowerCase());

  async function database<T>(path: string, method = "GET", payload?: unknown, preference = ""): Promise<T> {
    if (!api || !adminKey) throw new Failure("storage_config", 503);
    const headers = apiHeaders(adminKey);
    if (preference) headers.set("Prefer", preference);
    const response = await network(api + "/rest/v1/" + path, {
      method, headers, redirect: "error", signal: AbortSignal.timeout(9000),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) throw new Failure("rate_limit", 429);
      throw new Failure([401, 403, 404].includes(response.status) ? "storage_config" : "server", 503);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  let providerCache: { value: Promise<string>; until: number } | undefined;
  function providerKey(): Promise<string> {
    if (providerCache && providerCache.until > Date.now()) return providerCache.value;
    // A rotated Vault entry takes priority over the deployment default.
    const value = database<string | null>("rpc/cortex_provider_key", "POST", {})
      .then(key => key?.trim() || environmentModelKey)
      .catch(error => {
        if (providerCache?.value === value) providerCache = undefined;
        if (environmentModelKey) return environmentModelKey;
        throw error;
      });
    providerCache = { value, until: Date.now() + 30_000 };
    return value;
  }

  const control = createControl(database);
  let catalog: { value: Promise<string[]>; until: number } | undefined;
  function freeCatalog(): Promise<string[]> {
    if (catalog && catalog.until > Date.now()) return catalog.value;
    const value = network("https://openrouter.ai/api/v1/models", {
      redirect: "error", signal: AbortSignal.timeout(3500),
    }).then(async response => {
      if (!response.ok) throw new Error("model_catalog");
      const { data } = await response.json();
      if (!Array.isArray(data)) return [];
      return data.filter(item => typeof item.id === "string" && FREE_MODEL.test(item.id) &&
        String(item.pricing?.prompt) === "0" && String(item.pricing?.completion) === "0" &&
        item.architecture?.output_modalities?.includes("text") && item.supported_parameters?.includes("tools"))
        .slice(0, 12).map(item => String(item.id));
    }).catch(() => []);
    catalog = { value, until: Date.now() + 600_000 };
    return value;
  }

  const modelCooldown = new Map<string, number>();
  let quotaBlock: { key: string; failure: Failure; until: number } | undefined;
  function blockQuota(key: string, failure: Failure) {
    if (!["provider_quota_daily", "provider_quota"].includes(failure.code)) return;
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const seconds = failure.retryAfter || (failure.code === "provider_quota_daily"
      ? Math.ceil((midnight.getTime() - Date.now()) / 1000) : 30);
    quotaBlock = { key, failure, until: Date.now() + seconds * 1000 };
  }

  let readyCache = { value: false, until: 0 };
  async function ready(): Promise<boolean> {
    if (readyCache.until > Date.now()) return readyCache.value;
    let value = false;
    try { await database("cortex_sessions?select=token_hash&limit=0"); value = true; } catch { /* Report as configuration. */ }
    readyCache = { value, until: Date.now() + 8000 };
    return value;
  }

  async function auth<T>(path: string, payload?: unknown, method = "POST", userToken?: string): Promise<T> {
    if (!api || !publicKey) throw new Failure("account_config", 503);
    const headers = apiHeaders(publicKey);
    if (userToken) headers.set("Authorization", "Bearer " + userToken);
    const response = await network(api + "/auth/v1/" + path, {
      method, headers, redirect: "error", signal: AbortSignal.timeout(12_000),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (["email_address_not_authorized", "email_provider_disabled", "signup_disabled"].includes(error?.code)) {
        throw new Failure("account_config", 503);
      }
      if (response.status === 429 || response.status >= 500) throw new Failure("auth_busy", 503);
      if (error?.code === "email_not_confirmed") throw new Failure("auth_unconfirmed", 403);
      if (error?.code === "weak_password") throw new Failure("invalid_password", 400);
      throw new Failure("auth_credentials", 403);
    }
    return (response.status === 204 ? {} : await response.json()) as T;
  }

  function emailAccount(user: EmailUser | undefined): Account {
    if (!user?.id || !USER_ID.test(user.id) || !user.email_confirmed_at || !user.email) {
      throw new Failure("auth_unconfirmed", 403);
    }
    const email = checkedEmail(user.email);
    if (!allowed(email)) throw new Failure("account_forbidden", 403);
    return { id: user.id, name: String(user.user_metadata?.name || email.split("@")[0]).slice(0, 100),
      email, provider: "Email", avatar: "" };
  }

  async function emailAuth(request: Request, operation: string): Promise<Response> {
    if (!(operation === "password" ? emailLogin : emailReady) || !await ready()) throw new Failure("account_config", 503);
    if (!await installIdentity(request)) throw new Failure("client_version", 400);
    const input = await body(request, 4096);
    const email = checkedEmail(input.email);
    const sending = operation === "signup" || operation === "recover";
    await reserve(
      { bucket: "email:ip:" + await peer(request), seconds: 600, maximum: 30 },
      { bucket: (sending ? "email:send:" : "email:verify:") + await hash(email), seconds: 900, maximum: sending ? 4 : 10 },
      { bucket: "email:all", seconds: 60, maximum: 90 },
    );
    if (sending) {
      try {
        if (operation === "signup") {
          const result = await auth<{ access_token?: string }>("signup", { email, password: checkedPassword(input.password, true),
            data: { name: typeof input.name === "string" ? input.name.trim().slice(0, 100) : "" } });
          if (result.access_token) throw new Failure("account_config", 503);
        } else await auth("recover", { email });
      } catch (error) {
        if (!(error instanceof Failure) || error.code !== "auth_credentials") throw error;
        // Keep the response identical for registered and unknown addresses.
      }
      return json({ state: "check_email" });
    }
    let user: EmailUser | undefined;
    if (operation === "password") {
      ({ user } = await auth<{ user?: EmailUser }>("token?grant_type=password", { email, password: checkedPassword(input.password, false) }));
    } else {
      if (typeof input.code !== "string" || !/^[0-9]{6,10}$/.test(input.code)) throw new Failure("invalid_code", 400);
      const resetting = operation === "reset";
      const password = resetting ? checkedPassword(input.password, true) : undefined;
      const verified = await auth<{ user?: EmailUser; access_token?: string }>("verify",
        { email, token: input.code, type: resetting ? "recovery" : "email" });
      user = verified.user;
      if (resetting) {
        const account = emailAccount(user);
        if (!verified.access_token) throw new Failure("auth_credentials", 403);
        await auth("user", { password }, "PUT", verified.access_token);
        await database("cortex_sessions?account->>id=eq." + account.id, "DELETE");
        await auth("logout?scope=global", undefined, "POST", verified.access_token);
        return json({ state: "password_changed" });
      }
    }
    const account = emailAccount(user);
    const token = secret();
    await database("cortex_sessions", "POST", {
      token_hash: await hash(token), account, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }, "return=minimal");
    const previous = bearer(request);
    if (previous) await database("cortex_sessions?token_hash=eq." + await hash(previous), "DELETE");
    await claimGuest(request, account);
    return json({ state: "signed_in", token, account });
  }

  const reserve = (...rules: Limit[]) => database("rpc/cortex_reserve", "POST", { p_limits: rules });
  const expires = () => encodeURIComponent(new Date().toISOString());
  async function peer(request: Request): Promise<string> {
    const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    return (await hash(address.trim().slice(0, 64))).slice(0, 18);
  }

  async function lookup(request: Request): Promise<Account | null> {
    const token = bearer(request);
    if (!token) return null;
    const rows = await database<Array<{ account: Account }>>(
      "cortex_sessions?select=account&limit=1&token_hash=eq." + await hash(token) + "&expires_at=gt." + expires(),
    );
    const account = rows[0]?.account;
    return account && allowed(account.email) ? account : null;
  }

  async function actor(request: Request): Promise<{ account: Account | null; bucket: string; ip: string }> {
    const account = await lookup(request);
    if (account) return { account, bucket: "account:" + account.id, ip: "" };
    if (request.headers.has("authorization")) throw new Failure("sign_in", 401);
    if (!guests) throw new Failure("sign_in", 401);
    const install = request.headers.get("x-cortex-install") || "";
    if (!CAPABILITY.test(install)) throw new Failure("client_version", 400);
    return { account: null, bucket: "guest:" + await hash(install), ip: await peer(request) };
  }

  async function installIdentity(request: Request): Promise<string | null> {
    const raw = request.headers.get("x-cortex-install") || "";
    return CAPABILITY.test(raw) ? await hash(raw) : null;
  }

  async function ticketOwners(request: Request, account: Account | null): Promise<string[]> {
    if (account) return ["account_" + await hash(account.id)];
    const install = await installIdentity(request);
    return install ? ["install_" + install] : [];
  }

  async function subject(request: Request, account: Account | null): Promise<string | null> {
    if (account) return account.id;
    const install = guests ? await installIdentity(request) : null;
    return install ? "guest_" + install : null;
  }

  async function usage(request: Request, account: Account | null): Promise<Quota | null> {
    const id = await subject(request, account);
    return id ? await database<Quota>("rpc/cortex_ai_usage", "POST", { p_subject: id }) : null;
  }

  async function claimGuest(request: Request, account: Account) {
    const install = await installIdentity(request);
    if (install) await database("rpc/cortex_claim_guest", "POST", { p_install: install,
      p_owner: "account_" + await hash(account.id), p_subject: account.id });
  }

  function budget(caller: Awaited<ReturnType<typeof actor>>): Promise<unknown> {
    return reserve(
      { bucket: "chat:" + caller.bucket, seconds: 60, maximum: caller.account ? 16 : 12 },
      ...(caller.account ? [] : [{ bucket: "chat:ip:" + caller.ip, seconds: 60, maximum: 20 }]),
    );
  }

  let aiSettings: { until: number; value: Promise<string> } | undefined;
  function configuredModel() {
    if (aiSettings && aiSettings.until > Date.now()) return aiSettings.value;
    const value = database<Array<{ model?: string }>>("cortex_ai_settings?select=model&singleton=eq.true&limit=1")
      .then(rows => rows[0]?.model || "");
    aiSettings = { value, until: Date.now() + 5000 };
    void value.catch(() => { if (aiSettings?.value === value) aiSettings = undefined; });
    return value;
  }

  async function begin(request: Request, android: boolean, scheme: string | null): Promise<Response> {
    const preview = scheme && PREVIEW_SCHEME.exec(scheme)?.[1];
    if (scheme && (!android || (scheme !== ANDROID_SCHEME && !preview))) throw new Failure("invalid", 400);
    if (!await ready()) throw new Failure("storage_config", 503);
    if (!yandex) throw new Failure("account_config", 503);
    await reserve(
      { bucket: "login:" + await peer(request), seconds: 300, maximum: 10 },
      { bucket: "login:all", seconds: 60, maximum: 90 },
    );
    const state = (android ? "android-" + (preview ? preview + "-" : "") : "") + secret();
    const poll = secret(), verifier = secret();
    await database("rpc/cortex_begin_login", "POST", {
      p_state_hash: await hash(state), p_poll_hash: await hash(poll), p_verifier: verifier,
    });
    const url = new URL("https://oauth.yandex.ru/authorize");
    url.search = new URLSearchParams({
      client_id: yandexId, response_type: "code", redirect_uri: yandexRedirect, state,
      code_challenge: await hash(verifier), code_challenge_method: "S256",
      scope: "login:email login:info",
    }).toString();
    return json({ url: url.toString(), poll, expires_in: 300 });
  }

  async function callback(rawState: string, code: string): Promise<Response> {
    const { scheme, state } = androidReturn(rawState);
    if (!yandex || !CAPABILITY.test(state)) return browserResult(false, scheme);
    const filter = "cortex_auth_flows?state_hash=eq." + await hash(rawState) + "&expires_at=gt." + expires();
    const claims = await database<Array<{ verifier: string }>>(
      filter + "&stage=eq.pending", "PATCH", { stage: "exchanging" }, "return=representation",
    );
    const claim = claims[0];
    if (!claim) return browserResult(false, scheme);
    let stage = "denied";
    let account: Account | null = null;
    if (code && code.length <= 2048 && CAPABILITY.test(claim.verifier)) {
      try {
        const response = await network("https://oauth.yandex.ru/token", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(9_000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: claim.verifier,
            client_id: yandexId, client_secret: yandexSecret }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Failure("auth_denied", 403); }
        const token = (await response.json()).access_token;
        if (typeof token !== "string" || !/^[a-zA-Z0-9._~-]{12,2048}$/.test(token)) throw new Failure("auth_denied", 403);
        const identity = await network("https://login.yandex.ru/info?format=json", {
          redirect: "error", signal: AbortSignal.timeout(9_000), headers: { Authorization: "OAuth " + token },
        });
        if (!identity.ok) { await identity.body?.cancel(); throw new Failure("auth_denied", 403); }
        const profile = await identity.json();
        if (profile.client_id !== yandexId || typeof profile.id !== "string" || !/^\d{1,30}$/.test(profile.id)) {
          throw new Failure("auth_denied", 403);
        }
        const email = checkedEmail(profile.default_email);
        if (!allowed(email)) stage = "forbidden";
        else {
          account = { id: "yandex_" + await hash("yandex:" + profile.id), email, provider: "Yandex",
            name: String(profile.display_name || profile.real_name || profile.login || email.split("@")[0]).slice(0, 100), avatar: "" };
          stage = "approved";
        }
      } catch { /* The phone receives a bounded authentication error. */ }
    }
    const saved = await database<Array<unknown>>(
      filter + "&stage=eq.exchanging", "PATCH", { stage, account, verifier: "" }, "return=representation",
    );
    return browserResult(stage === "approved" && saved.length === 1, scheme);
  }

  async function poll(request: Request): Promise<Response> {
    const input = await body(request, 2048);
    if (typeof input.code !== "string" || !CAPABILITY.test(input.code)) throw new Failure("auth_expired", 410);
    await reserve(
      { bucket: "poll:" + await peer(request), seconds: 60, maximum: 90 },
      { bucket: "poll:all", seconds: 60, maximum: 1200 },
    );
    const token = secret();
    const result = await database<Login>("rpc/cortex_finish_login", "POST", {
      p_poll_hash: await hash(input.code), p_token_hash: await hash(token),
    });
    if (result.state === "expired") throw new Failure("auth_expired", 410);
    if (result.state === "denied") throw new Failure("auth_denied", 403);
    if (result.state === "forbidden") throw new Failure("account_forbidden", 403);
    if (result.state !== "signed_in" || !result.account) return json({ state: "pending" });
    await claimGuest(request, result.account);
    return json({ ...result, token });
  }

  return async request => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^(?:\/functions\/v1)?\/cortex(?=\/)/, "");
    const method = request.method;
    const isCallback = method === "GET" && path === YANDEX_CALLBACK;
    try {
      if (method === "GET" && path === "/v1/status") {
        const storage = await ready();
        const [account, key] = storage
          ? await Promise.all([lookup(request), providerKey().catch(() => "")])
          : [null, ""];
        const [quota, publicId] = storage ? await Promise.all([
          usage(request, account).catch(() => null),
          account ? database<string>("rpc/cortex_public_account", "POST", { p_subject: account.id }).catch(() => null) : null,
        ]) : [null, null];
        return json({
          service: "CORTEX", configured: Boolean(storage && key), provider: "openrouter_free",
          yandex, email_login: emailLogin, email_auth: emailReady, account: account ? { ...account, public_id: publicId } : null, guest: guests, support: storage, device_tools: true,
          device_profiles: true, device_repair: true, device_action_plan: true, visual_plan: true, model_fallback: true,
          ...(storage ? { gate: await control.gate(request, account), quota } : { fault: "storage_config" }),
        });
      }
      if (path === "/v1/subscription" && method === "GET") {
        const caller = await actor(request);
        const id = await subject(request, caller.account);
        if (!id) throw new Failure("sign_in", 401);
        await reserve({ bucket: "subscription:" + caller.bucket, seconds: 60, maximum: 20 });
        const result = await database<Record<string, unknown>>("rpc/cortex_subscription", "POST", { p_subject: id });
        return json({ ...result, checkout: Boolean(caller.account && result.checkout && checkoutReady) });
      }
      if (path === "/v1/subscription/payment" && method === "POST") {
        const caller = await actor(request);
        if (!caller.account) throw new Failure("sign_in", 401);
        const gate = await control.gate(request, caller.account);
        if (gate.mode !== "open") throw new Failure(gate.mode, 403);
        if (!billingOrigin || !billingToken) throw new Failure("payments_disabled", 503);
        await reserve({ bucket: "billing:" + caller.bucket, seconds: 60, maximum: 6 });
        const input = await body(request, 2048);
        if (!["checkout", "renew", "status"].includes(String(input.operation))) throw new Failure("invalid", 400);
        if (input.operation !== "status" && !checkoutReady) throw new Failure("payments_disabled", 503);
        const response = await network(billingOrigin + "/api/billing", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { Authorization: "Bearer " + billingToken, "Content-Type": "application/json" },
          body: JSON.stringify({ subject: caller.account.id, email: caller.account.email, operation: input.operation, plan: input.plan, id: input.id }),
        });
        const result = await response.json();
        return json(result, response.status);
      }
      if (method === "GET" && path === "/v1/support/inbox") {
        const { account } = await actor(request);
        if (account) await claimGuest(request, account);
        return json(await control.inbox(await ticketOwners(request, account)));
      }
      if (method === "POST" && path === "/v1/presence") {
        const install = await installIdentity(request);
        if (!install) throw new Failure("client_version", 400);
        const input = await body(request, 2048);
        const account = await lookup(request);
        await reserve({ bucket: "presence:" + install, seconds: 60, maximum: 4 });
        const version = request.headers.get("x-cortex-version-name") || "";
        const device = request.headers.get("x-cortex-device") || "";
        const stable = /^[a-f0-9]{16}$/.test(device) ? await hash("cortex-device-v1:" + device) : null;
        await control.presence(install, input, /^[A-Za-z0-9.+-]{1,24}$/.test(version) ? version : "unknown", stable, account?.id);
        return json({ gate: await control.gate(request, account) });
      }
      if (method === "POST" && path === "/v1/auth/start") {
        return await begin(request, url.searchParams.get("return") === "android", url.searchParams.get("scheme"));
      }
      if (isCallback) return await callback(url.searchParams.get("state") || "", url.searchParams.get("code") || "");
      const emailRoute = /^\/v1\/auth\/(signup|password|verify|recover|reset)$/.exec(path);
      if (method === "POST" && emailRoute) return await emailAuth(request, emailRoute[1]);
      if (method === "POST" && path === "/v1/auth/poll") return await poll(request);
      if (method === "DELETE" && path === "/v1/session") {
        const token = bearer(request);
        if (token) await database("cortex_sessions?token_hash=eq." + await hash(token), "DELETE");
        return json({ ok: true });
      }
      if (method === "POST" && (path === "/v1/chat" || path === "/v1/check")) {
        const caller = await actor(request);
        const isChat = path === "/v1/chat";
        const input = isChat ? chatInput(await body(request, 260_000)) : {
          messages: [{ role: "user", content: "Reply with just OK." }] as const, limit: 512, device: false, repair: false, plan: false, visual: false, profile: undefined,
        };
        const gate = await control.gate(request, caller.account);
        if (gate.mode !== "open") throw new Failure(gate.mode, 403);
        const id = await subject(request, caller.account);
        if (!id) throw new Failure("sign_in", 401);
        const [key, modelOverride, access] = await Promise.all([
          providerKey().catch(() => ""), configuredModel(), caller.account ? usage(request, caller.account) : null,
        ]);
        const hasPaidPlan = ["start", "pro", "ultra"].includes(access?.plan || "");
        if (!key && !(paidKey && hasPaidPlan)) throw new Failure("unconfigured", 503);
        const wantsAdvanced = isChat && (input.profile === "deep" ||
          (input.visual || input.plan) && ["pro", "ultra"].includes(access?.plan || ""));
        const premium = Boolean(hasPaidPlan && paidKey && wantsAdvanced && access?.advanced_tokens && paidModelId.test(paidDeep));
        const basic = Boolean(hasPaidPlan && paidKey && paidModelId.test(paidFast));
        const preferred = input.repair ? profiles.auto : input.profile ? profiles[input.profile] : models;
        const candidates = input.visual ? [...visualTools, ...visualSchemas]
          : [...new Set([modelOverride, ...preferred, ...models].filter(model => FREE_MODEL.test(model)))];
        await budget(caller);
        let quota: Quota | undefined;
        const hold = (model?: string, advanced = false) => async (estimatedInput: number, output: number) => {
          const amounts = { p_subject: id, p_input: estimatedInput, p_output: output };
          const result = await database<{ attempt?: string; max_output?: number; quota: Quota; error?: string; retry_after?: number }>(
            model ? "rpc/cortex_paid_reserve" : "rpc/cortex_ai_reserve", "POST",
            model ? { ...amounts, p_model: model, p_advanced: advanced }
              : { ...amounts, p_day_cap: dayCap, p_minute_cap: minuteCap });
          if (!result?.quota || result.quota.id !== id || result.quota.unit !== "tokens") {
            throw new Failure("storage_config", 503);
          }
          quota = result.quota;
          if (result.error) {
            const reset = Math.max(1, Math.ceil((Date.parse(quota.reset_at) - Date.now()) / 1000));
            throw new BudgetFailure(result.error, result.retry_after || (result.error === "daily_limit" ? reset : 0), quota);
          }
          if (!result.attempt || !result.max_output) throw new Failure("storage_config", 503);
          return {
            maxOutput: result.max_output,
            async finish(usage: MeasuredUsage | null) {
              const payload = { p_attempt: result.attempt, p_input: usage?.input ?? null, p_output: usage?.output ?? null };
              for (let retry = 0; retry < 2; retry++) {
                try {
                  return await database<Record<string, unknown>>(
                    model ? "rpc/cortex_paid_finish" : "rpc/cortex_ai_finish", "POST",
                    model ? { ...payload, p_cost: usage?.costMicros ?? null } : payload);
                } catch {
                  if (retry === 1) console.warn("CORTEX could not record model usage");
                }
              }
              return null;
            },
          };
        };
        const upstream = new AbortController();
        const quick = input.visual || input.profile !== "deep";
        const firstTokenMs = input.visual ? 5_200 : quick ? 5_500 : 15_000;
        const signal = AbortSignal.any([request.signal, upstream.signal,
          AbortSignal.timeout(input.visual ? 12_500 : quick ? 29_000 : 69_000)]);
        const scope = input.visual ? "visual:" : (input.profile || "default") + (input.device ? ":tools:" : ":chat:");
        const choices = [...new Set(candidates)];
        const ready = choices.filter(model => (modelCooldown.get(scope + model) || 0) <= Date.now());
        const ordered = input.visual ? [
          ...ready.filter(model => visualTools.includes(model)).slice(0, 1),
          ...ready.filter(model => visualSchemas.includes(model)).slice(0, 1),
        ] : ready;
        if (!ordered.length && choices[0]) ordered.push(choices[0]);
        // Paid capacity is earmarked per subscription. Free requests retain their own provider quota.
        const paidCandidates = [ ...(premium ? [{ model: paidDeep, advanced: true }] : []),
          ...(basic && (!premium || paidFast !== paidDeep) ? [{ model: paidFast, advanced: false }] : []) ];
        const routeModels = [...paidCandidates, ...ordered.map(model => ({ model, advanced: false }))];
        const maxAttempts = paidCandidates.length + (input.visual ? 2 : 3);
        const messages = [...input.messages];
        if (access?.context_chars) {
          let chars = messages.reduce((total, turn) => total + turn.content.length, 0);
          while (chars > access.context_chars && messages.length > 2) {
            const oldest = messages[0].role === "system" ? 1 : 0;
            chars -= messages.splice(oldest, 1)[0].content.length;
          }
          if (chars > access.context_chars) throw new Failure("context_limit", 400);
        }
        if (input.visual) {
          if (messages[0]?.role === "system") messages[0] = { role: "system", content: visualGuide + "\n" + messages[0].content };
          else messages.unshift({ role: "system", content: visualGuide });
        }
        let catalogChecked = false;
        const restModel = (model: string, failure: Failure) => {
          if (!["timeout", "provider_limit", "invalid_plan", "provider_quota", "provider_quota_daily", "provider", "empty", "model", "provider_key", "provider_access"].includes(failure.code)) return;
          const seconds = failure.code === "model" ? 90 : Math.min(60, Math.max(18, failure.retryAfter));
          modelCooldown.set(scope + model, Date.now() + seconds * 1000);
        };
        let lastModel = "";
        let next = 0;
        let checkedDaily = false;
        const examine = async (failure: Failure): Promise<Failure> => {
          if (!checkedDaily && ["provider_quota", "provider_limit_unknown"].includes(failure.code)) {
            checkedDaily = true;
            failure = await confirmedQuota(network, key, signal, failure);
          }
          blockQuota(key, failure);
          return failure;
        };
        const canTryNext = (failure: Failure) => retryableModelError(failure.code);
        const getResponse = async (previous?: Failure): Promise<ModelResponse | undefined> => {
          let failure = previous && await examine(previous);
          if (failure && !canTryNext(failure) && !["advanced_limit", "paid_unavailable"].includes(failure.code)) throw failure;
          if (failure && lastModel) restModel(lastModel, failure);
          while (!signal.aborted && next < maxAttempts) {
            if (next >= routeModels.length) {
              if (catalogChecked || input.visual) break;
              catalogChecked = true;
              const live = await freeCatalog();
              routeModels.push(...live.filter(model => !choices.includes(model) &&
                (modelCooldown.get(scope + model) || 0) <= Date.now()).slice(0, 3).map(model => ({ model, advanced: false })));
              if (next >= routeModels.length) break;
            }
            const { model, advanced } = routeModels[next++];
            const paid = next <= paidCandidates.length;
            lastModel = model;
            try {
              if (!paid && !key) throw new Failure("unconfigured", 503);
              if (!paid && quotaBlock?.key === key && quotaBlock.until > Date.now()) {
                const { failure, until } = quotaBlock;
                throw new Failure(failure.code, failure.status, Math.ceil((until - Date.now()) / 1000));
              }
              const format = !input.visual ? undefined : visualTools.includes(model)
                ? { tools: [visualTool], tool_choice: "required" } : { response_format: visualFormat };
              const result = await completion(network, paid ? paidKey : key, [model], messages, isChat && !input.visual,
                input.limit, signal, input.device, input.repair, firstTokenMs, quick, input.plan,
                hold(paid ? model : undefined, advanced), format, paid ? (advanced ? 0.60 : 0.20) : undefined);
              modelCooldown.delete(scope + model);
              return result;
            } catch (error) {
              if (!(error instanceof Failure)) throw error;
              failure = paid ? error : await examine(error);
              if (!canTryNext(failure) && !(paid && ["advanced_limit", "paid_unavailable", "provider_key",
                "provider_budget", "provider_balance", "provider_quota", "provider_quota_daily"].includes(failure.code))) throw failure;
              restModel(model, failure);
              console.warn("CORTEX provider candidate rejected:", model, failure.code);
            }
          }
          if (signal.aborted) throw new Failure("timeout", 504);
          if (failure) throw failure;
        };
        let response = await getResponse();
        if (!response) throw new Failure("model", 502);
        if (input.visual) {
          while (response) {
            try {
              const plan = checkedVisualPlan(await completeText(response, visualToolName));
              return json({ text: JSON.stringify(plan), quota: await response.finish() ?? quota });
            } catch (error) {
              if (!(error instanceof Failure)) throw error;
              console.warn("CORTEX visual plan rejected:", lastModel, error.code);
              response = await getResponse(error);
            }
          }
          throw new Failure("invalid_plan", 502);
        }
        if (!isChat) {
          while (response) {
            try { return json({ connected: true, quota: await verifyCompletion(response) ?? quota }); }
            catch (error) {
              if (!(error instanceof Failure)) throw error;
              response = await getResponse(error);
            }
          }
          throw new Failure("model", 502);
        }
        return new Response(relay(response, getResponse, input.device, input.repair, next > 1, () => upstream.abort(), input.plan), {
          headers: { ...JSON_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no",
            "X-Cortex-Quota": JSON.stringify(quota || {}) },
        });
      }
      if (method === "POST" && path === "/v1/support") {
        const caller = await actor(request);
        const ticket = supportInput(await body(request), caller.account);
        const [owner] = await ticketOwners(request, caller.account);
        if (!owner) throw new Failure("client_version", 400);
        await reserve(
          { bucket: "support:" + caller.bucket, seconds: 3600, maximum: 5 },
          { bucket: "support:all", seconds: 86_400, maximum: 50 },
          ...(caller.account ? [] : [{ bucket: "support:ip:" + caller.ip, seconds: 3600, maximum: 8 }]),
        );
        await database("cortex_support?on_conflict=id", "POST", { ...ticket, device_hash: owner }, "resolution=ignore-duplicates");
        const receipt = await database<Array<{ id: string }>>(
          "cortex_support?select=id&id=eq." + ticket.id + "&device_hash=eq." + owner + "&limit=1",
        );
        if (!receipt.length) throw new Failure("conflict", 409);
        return json({ sent: true, reference: ticket.id.slice(0, 8).toUpperCase() });
      }
      return json({ error: "endpoint" }, 404);
    } catch (error) {
      if (isCallback) return browserResult(false, androidReturn(url.searchParams.get("state") || "").scheme);
      if (error instanceof BudgetFailure) {
        return Response.json({ ...failureBody(error), quota: error.quota }, {
          status: error.status, headers: { ...JSON_HEADERS, "Retry-After": String(error.retryAfter || 1) },
        });
      }
      if (error instanceof Failure) return json(failureBody(error), error.status);
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return json({ error: "timeout" }, 504);
      console.warn("CORTEX gateway request failed");
      return json({ error: "server" }, 503);
    }
  };
}

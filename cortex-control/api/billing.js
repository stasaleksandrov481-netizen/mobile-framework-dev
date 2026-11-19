import { timingSafeEqual, randomUUID, createHash } from "node:crypto";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const subjectPattern = /^(?:yandex_[A-Za-z0-9_-]{43}|[a-f0-9-]{36})$/;
const paymentEmail = /^[^\s@<>(),:;\\"]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const plans = new Set(["start", "pro", "ultra"]);
const checkoutHost = "https://auth.robokassa.ru";

function invoiceId(id) {
  return (BigInt("0x" + id.replaceAll("-", "").slice(0, 15)) + 1n).toString();
}

function amountInKopecks(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,9})\.[0-9]{2}(?:0{0,4})$/.test(value)) return -1;
  const [rubles, fractional] = value.split(".");
  const kopecks = BigInt(rubles) * 100n + BigInt(fractional.slice(0, 2));
  return kopecks <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(kopecks) : -1;
}

function formBody(req) {
  if (Number(req.headers["content-length"] || 0) > 8192) throw new BillingError(400, "invalid");
  const value = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 8192) {
    throw new BillingError(400, "invalid");
  }
  return value;
}

class BillingError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function matches(actual, expected) {
  if (typeof actual !== "string" || !expected || actual.length !== expected.length) return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonObject(req) {
  try {
    if (Number(req.headers["content-length"] || 0) > 8192) throw new Error();
    const input = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 8192) throw new Error();
    return input;
  } catch {
    throw new BillingError(400, "invalid");
  }
}

function httpsUrl(value, checkHost = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (checkHost && url.origin !== checkoutHost)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function kopecks(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return -1;
  const result = Math.round(value * 100);
  return Math.abs(value * 100 - result) < 0.00001 ? result : -1;
}

export function createBillingHandler(env = process.env, network = fetch) {
  const mode = env.CORTEX_BILLING_MODE;
  const merchant = env.ROBOKASSA_MERCHANT_LOGIN?.trim();
  const password1 = env.ROBOKASSA_PASSWORD_1;
  const password2 = env.ROBOKASSA_PASSWORD_2;
  const hashAlgorithm = (env.ROBOKASSA_HASH_ALGORITHM || "md5").toLowerCase();
  const dbOrigin = httpsUrl(env.SUPABASE_URL);
  const dbKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const gatewaySecret = env.CORTEX_BILLING_TOKEN;
  const liveReady = mode === "live" && /^[A-Za-z0-9_.-]{1,128}$/.test(merchant || "") &&
    Boolean(password1 && password2) && ["md5", "sha256"].includes(hashAlgorithm) &&
    env.ROBOKASSA_LIVE_APPROVED === "true";

  function digest(value) {
    return createHash(hashAlgorithm).update(value, "utf8").digest("hex");
  }

  async function database(path, payload, accessToken) {
    const headers = {
      apikey: accessToken ? env.SUPABASE_PUBLISHABLE_KEY : dbKey,
      Authorization: "Bearer " + (accessToken || dbKey),
      "Content-Type": "application/json"
    };
    if (!dbOrigin || !headers.apikey) throw new BillingError(503, "storage_config");
    const response = await network(new URL("rest/v1/" + path, dbOrigin), {
      method: payload ? "POST" : "GET", headers, body: payload ? JSON.stringify(payload) : undefined,
      redirect: "error", signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new BillingError(accessToken ? 403 : 503, accessToken ? "forbidden" : "billing_unavailable");
    }
    return response.json();
  }

  function record(order, providerId, state, url) {
    return database("rpc/cortex_billing_payment", {
      p_id: order.id, p_mode: order.mode, p_provider: providerId,
      p_state: state, p_amount: order.amount, p_url: url || null
    });
  }

  async function lookup(id, currentMode, subject) {
    if (!uuid.test(id || "")) throw new BillingError(400, "invalid");
    const params = new URLSearchParams({ id: "eq." + id, mode: "eq." + currentMode, limit: "1" });
    if (subject) params.set("subject", "eq." + subject);
    return (await database("cortex_payments?" + params))[0];
  }

  function present(order) {
    return { id: order.id, state: order.state, plan: order.plan, amount: order.amount,
      ends_at: order.ends_at, checkout_url: order.state === "pending" ? order.checkout_url : null,
      test: order.mode === "test" };
  }

  async function confirmCallback(req) {
    const data = formBody(req);
    const { OutSum: amount, InvId: invoice, SignatureValue: signature, Shp_order: id } = data;
    if (!uuid.test(id || "") || typeof invoice !== "string" || !/^[1-9][0-9]{0,18}$/.test(invoice) ||
        typeof signature !== "string" || !/^[a-f0-9]{32,64}$/i.test(signature) ||
        amountInKopecks(amount) < 1) throw new BillingError(400, "invalid");
    const expected = digest([amount, invoice, password2, "Shp_order=" + id].join(":"));
    if (!matches(signature.toLowerCase(), expected)) throw new BillingError(401, "forbidden");
    if (invoiceId(id) !== invoice) throw new BillingError(409, "payment_mismatch");
    const order = await lookup(id, "live");
    if (!order || order.mode !== "live" || order.amount !== amountInKopecks(amount) ||
        (order.provider_id && order.provider_id !== id)) {
      throw new BillingError(409, "payment_mismatch");
    }
    const saved = await record(order, id, "confirmed");
    if (!saved || saved.state !== "confirmed") throw new BillingError(409, "payment_mismatch");
    return invoice;
  }

  async function checkout(input) {
    if (!plans.has(input.plan)) throw new BillingError(400, "invalid_plan");
    // The signed gateway supplies the account address, never the checkout form.
    const email = input.email;
    if (typeof email !== "string" || email.length > 254 || email.trim() !== email || !paymentEmail.test(email) ||
        email.indexOf("@") > 64 || email.startsWith(".") || email.includes("..") || email.includes(".@")) {
      throw new BillingError(400, "invalid_email");
    }
    const order = await database("rpc/cortex_billing_order", {
      p_subject: input.subject, p_plan: input.plan, p_mode: mode
    });
    if (order?.error) throw new BillingError(409, order.error);
    if (!order || !uuid.test(order.id)) throw new BillingError(503, "billing_unavailable");
    if (order.existing) {
      if (order.plan !== input.plan) throw new BillingError(409, "payment_pending");
      if (order.state === "creating") throw new BillingError(409, "payment_creating");
      return present(order);
    }
    if (mode === "test") {
      return present(await record(order, randomUUID(), "pending"));
    }
    const sum = (order.amount / 100).toFixed(2);
    const invoice = invoiceId(order.id);
    const signature = digest([merchant, sum, invoice, password1, "Shp_order=" + order.id].join(":"));
    const paymentUrl = new URL("/Merchant/Index.aspx", checkoutHost);
    paymentUrl.search = new URLSearchParams({
      MerchantLogin: merchant, OutSum: sum, InvId: invoice,
      Description: "CORTEX " + order.plan + " subscription for one month",
      Email: email, Culture: "ru", Shp_order: order.id, SignatureValue: signature
    }).toString();
    const url = httpsUrl(paymentUrl.href, true);
    if (!url) throw new BillingError(502, "payment_provider");
    // The database provider_id column is a UUID. Use the signed order UUID as its stable
    // internal reference; Robokassa's numeric invoice is independently checked on callback.
    const saved = await record(order, order.id, "pending", url);
    if (!saved) throw new BillingError(409, "payment_mismatch");
    return present(saved);
  }

  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method" });
    }
    try {
      const isWebhook = req.query?.webhook === "1";
      if (isWebhook) {
        if (!liveReady) throw new BillingError(503, "payments_disabled");
        const invoice = await confirmCallback(req);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send("OK" + invoice);
      }
      if (mode !== "test" && !liveReady) throw new BillingError(503, "payments_disabled");
      const input = jsonObject(req);
      if (input.operation === "refund") {
        if (!liveReady) throw new BillingError(503, "payments_disabled");
        const auth = req.headers.authorization;
        if (typeof auth !== "string" || !/^Bearer [A-Za-z0-9._-]{40,4096}$/.test(auth)) {
          throw new BillingError(401, "forbidden");
        }
        await database("rpc/cortex_admin_billing", { p_action: "authorize_refund", p_data: { id: input.id } }, auth.slice(7));
        // Merchant-initiated refunds require Robokassa Password #3 and verified operation IDs.
        // Until configured, direct administrators to the provider dashboard.
        throw new BillingError(409, "refund_unavailable");
      }
      if (!matches(req.headers.authorization, gatewaySecret && "Bearer " + gatewaySecret)) {
        throw new BillingError(401, "forbidden");
      }
      if (typeof input.subject !== "string" || !subjectPattern.test(input.subject) ||
          (!input.subject.startsWith("yandex_") && !uuid.test(input.subject))) throw new BillingError(400, "invalid");
      if (input.operation === "checkout" || input.operation === "renew") {
        return res.status(200).json(await checkout(input));
      }
      const order = await lookup(input.id, mode, input.subject);
      if (!order) throw new BillingError(404, "payment_not_found");
      if (input.operation === "status") {
        return res.status(200).json(present(order));
      }
      if (input.operation === "simulate" && mode === "test" &&
          matches(req.headers["x-cortex-billing-test-key"], env.CORTEX_BILLING_TEST_KEY) &&
          ["confirmed", "canceled", "refunded"].includes(input.state) && order.provider_id) {
        return res.status(200).json(present(await record(order, order.provider_id, input.state)));
      }
      throw new BillingError(400, "invalid");
    } catch (error) {
      if (!(error instanceof BillingError)) console.error("CORTEX billing request failed");
      return res.status(error instanceof BillingError ? error.status : 503)
        .json({ error: error instanceof BillingError ? error.message : "billing_unavailable" });
    }
  };
}

export default createBillingHandler();

import { timingSafeEqual } from "node:crypto";

const ORDER_PAYLOAD = /^cortex-stars:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const TOKEN = /^[0-9]{6,16}:[A-Za-z0-9_-]{30,128}$/;
const SECRET = /^[A-Za-z0-9_-]{16,256}$/;

export type StarsPlan = "start" | "pro" | "ultra";

export function starsPlan(value: unknown): value is StarsPlan {
  return value === "start" || value === "pro" || value === "ultra";
}

export function starsPayloadId(value: unknown): string | null {
  return typeof value === "string" ? ORDER_PAYLOAD.exec(value)?.[1]?.toLowerCase() ?? null : null;
}

export function telegramConfigurationValid(token: string | undefined, secret: string | undefined): boolean {
  return Boolean(token && secret && TOKEN.test(token) && SECRET.test(secret));
}

export function webhookSecretValid(actual: string | null, expected: string | undefined): boolean {
  if (!expected || !SECRET.test(expected) || !actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function starsInvoiceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "t.me" || parsed.port ||
        parsed.username || parsed.password || parsed.hash || parsed.search || parsed.pathname.length < 2) return null;
    return parsed.href;
  } catch { return null; }
}

export async function boundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("content-length") || "0") > maxBytes || !request.body) {
    throw new Error("invalid_body");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("invalid_body");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const raw = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  return JSON.parse(raw.toString("utf8"));
}

export async function telegramBotApi<T>(
  token: string | undefined, method: string, data: Record<string, unknown>,
  network: typeof fetch = fetch,
): Promise<T> {
  if (!token || !TOKEN.test(token) || !/^[A-Za-z]{2,48}$/.test(method)) {
    throw new Error("telegram_not_configured");
  }
  // Telegram requires bot credentials in its API path. Do not log this URL.
  const response = await network(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(data), redirect: "error", signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("telegram_provider_unavailable");
  }
  const payload = await response.json() as { ok?: boolean; result?: T };
  if (payload.ok !== true) throw new Error("telegram_provider_unavailable");
  return payload.result as T;
}

type StarsTransaction = {
  id?: unknown;
  amount?: unknown;
  nanostar_amount?: unknown;
  date?: unknown;
  source?: { type?: unknown; transaction_type?: unknown;
    invoice_payload?: unknown; user?: { id?: unknown } };
  receiver?: { type?: unknown; user?: { id?: unknown } };
};

export type StarsReceipt = {
  kind: "payment" | "refund";
  charge: string;
  orderId?: string;
  buyer?: number;
  stars?: number;
};

// A webhook secret authenticates a Telegram transport, but is not proof that a
// financial transaction exists. Check the independently fetched BOT ledger.
// If the provider is delayed or the receipt is older than the scan horizon,
// fail closed and let Telegram retry; never issue an entitlement speculatively.
export async function verifyTelegramStarsReceipt(
  token: string | undefined, receipt: StarsReceipt,
  botApi: typeof telegramBotApi = telegramBotApi,
): Promise<boolean> {
  if (typeof receipt.charge !== "string" || receipt.charge.length < 1 || receipt.charge.length > 128) return false;
  if (receipt.kind === "payment" &&
      (!receipt.orderId || !ORDER_PAYLOAD.test(`cortex-stars:${receipt.orderId}`) ||
       !Number.isSafeInteger(receipt.buyer) || Number(receipt.buyer) <= 0 ||
       !Number.isInteger(receipt.stars) || Number(receipt.stars) < 1 || Number(receipt.stars) > 10000)) return false;

  let latest = Number.POSITIVE_INFINITY;
  let sawRefund = false;
  let sawPayment = false;
  for (let offset = 0; offset < 300; offset += 100) {
    const page = await botApi<{ transactions?: StarsTransaction[] }>(token, "getStarTransactions", {
      offset, limit: 100,
    });
    if (!page || !Array.isArray(page.transactions) || page.transactions.length > 100) return false;
    for (const tx of page.transactions) {
      if (!tx || !Number.isSafeInteger(tx.date) || Number(tx.date) > latest) return false;
      latest = Number(tx.date);
      if (tx.id !== receipt.charge || !Number.isInteger(tx.amount) ||
          (tx.nanostar_amount !== undefined && tx.nanostar_amount !== 0)) continue;
      if (Number(tx.amount) < 0 && tx.receiver?.type === "user") {
        if (receipt.kind === "refund") return true;
        sawRefund = true;
      }
      if (receipt.kind === "payment" && Number(tx.amount) === receipt.stars &&
          tx.source?.type === "user" && tx.source.transaction_type === "invoice_payment" &&
          tx.source.invoice_payload === `cortex-stars:${receipt.orderId}` &&
          tx.source.user?.id === receipt.buyer) sawPayment = true;
    }
    if (receipt.kind === "payment" && sawPayment) return !sawRefund;
    if (page.transactions.length < 100) break;
  }
  return false;
}

// Recovery path: a user supplies only their own order UUID to the web route;
// this scan finds the charge in Telegram itself. Never accept a charge ID,
// price or payer ID from the browser as evidence of payment.
export async function findTelegramStarsPurchase(
  token: string | undefined,
  order: { id: string; buyer: number; stars: number },
  botApi: typeof telegramBotApi = telegramBotApi,
): Promise<string | null> {
  if (!ORDER_PAYLOAD.test(`cortex-stars:${order.id}`) ||
      !Number.isSafeInteger(order.buyer) || order.buyer <= 0 ||
      !Number.isInteger(order.stars) || order.stars < 1 || order.stars > 10000) return null;
  let lastDate = Number.POSITIVE_INFINITY;
  const refunds = new Set<string>();
  for (let offset = 0; offset < 300; offset += 100) {
    const page = await botApi<{ transactions?: StarsTransaction[] }>(token, "getStarTransactions", {
      offset, limit: 100,
    });
    if (!page || !Array.isArray(page.transactions) || page.transactions.length > 100) return null;
    let candidate: string | null = null;
    for (const tx of page.transactions) {
      if (!tx || !Number.isSafeInteger(tx.date) || Number(tx.date) > lastDate) return null;
      lastDate = Number(tx.date);
      if (typeof tx.id !== "string" || tx.id.length < 1 || tx.id.length > 128) continue;
      if (Number.isInteger(tx.amount) && Number(tx.amount) < 0 && tx.receiver?.type === "user") {
        refunds.add(tx.id);
      }
      if (tx.amount === order.stars && (tx.nanostar_amount === undefined || tx.nanostar_amount === 0) &&
          tx.source?.type === "user" && tx.source.transaction_type === "invoice_payment" &&
          tx.source.invoice_payload === `cortex-stars:${order.id}` &&
          tx.source.user?.id === order.buyer) {
        if (candidate && candidate !== tx.id) return null;
        candidate = tx.id;
      }
    }
    if (candidate && !refunds.has(candidate)) return candidate;
    if (page.transactions.length < 100) break;
  }
  return null;
}

export function plainBotCommand(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 128) return null;
  if (/^\/paysupport(?:@[A-Za-z0-9_]{5,32})?(?:\s|$)/i.test(text)) {
    return "Поддержка платежей CORTEX: support@cortexapp.ru. Напишите с почты аккаунта, укажите номер заказа, дату и проблему. Никому не отправляйте пароли, коды входа и полный номер карты.";
  }
  if (/^\/(?:start|help)(?:@[A-Za-z0-9_]{5,32})?(?:\s|$)/i.test(text)) {
    return "CORTEX: подписки и управление аккаунтом доступны на cortexapp.ru. Никому не отправляйте коды входа и пароли. Новые функции бота появятся позже.";
  }
  return null;
}

import { plainBotCommand, starsPayloadId, type StarsReceipt } from "./telegram-stars.ts";

type PaymentEvent = {
  currency?: unknown; total_amount?: unknown; invoice_payload?: unknown;
  telegram_payment_charge_id?: unknown;
};

export type TelegramStarsUpdate = {
  update_id?: unknown;
  pre_checkout_query?: {
    id?: unknown; from?: { id?: unknown }; currency?: unknown;
    total_amount?: unknown; invoice_payload?: unknown;
  };
  message?: {
    from?: { id?: unknown }; chat?: { id?: unknown; type?: unknown }; text?: unknown;
    successful_payment?: PaymentEvent; refunded_payment?: PaymentEvent;
  };
};

type RpcResult = { data?: unknown; error?: unknown };
type StarsWebhookServices = {
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>;
  telegram(name: string, params: Record<string, unknown>): Promise<unknown>;
  verify(receipt: StarsReceipt): Promise<boolean>;
};

function rpcOk(result: RpcResult): boolean {
  return !result.error && result.data !== null && typeof result.data === "object" &&
    (result.data as { ok?: unknown }).ok === true;
}

// Independently injectable business engine. Nothing here trusts a client
// amount, a webhook payload or an admin UI state as payment proof.
export async function processTelegramStarsUpdate(
  update: TelegramStarsUpdate, services: StarsWebhookServices,
): Promise<number> {
  const pre = update.pre_checkout_query;
  if (pre) {
    if (typeof pre.id !== "string" || pre.id.length > 256 || !pre.id) return 400;
    const id = starsPayloadId(pre.invoice_payload);
    let approved = false;
    if (id && pre.currency === "XTR" && Number.isSafeInteger(pre.from?.id) &&
        Number.isInteger(pre.total_amount) && Number(pre.total_amount) > 0) {
      const result = await services.rpc("cortex_stars_precheckout", {
        p_id: id, p_buyer: pre.from!.id, p_query: pre.id, p_stars: pre.total_amount,
      });
      approved = rpcOk(result);
    }
    const answered = await services.telegram("answerPreCheckoutQuery", {
      pre_checkout_query_id: pre.id, ok: approved,
      ...(!approved ? { error_message: "Счёт истёк или не прошёл проверку. Откройте тарифы CORTEX и создайте новый счёт." } : {}),
    });
    return answered === true ? 200 : 503;
  }

  const payment = update.message?.successful_payment;
  if (payment) {
    const id = starsPayloadId(payment.invoice_payload);
    if (!id || payment.currency !== "XTR" || !Number.isInteger(payment.total_amount) ||
        !Number.isSafeInteger(update.message?.from?.id) ||
        typeof payment.telegram_payment_charge_id !== "string") return 409;
    if (!await services.verify({
      kind: "payment", charge: payment.telegram_payment_charge_id,
      orderId: id, buyer: Number(update.message!.from!.id), stars: Number(payment.total_amount),
    })) return 503;
    const result = await services.rpc("cortex_stars_confirm", {
      p_id: id, p_charge: payment.telegram_payment_charge_id,
      p_buyer: update.message!.from!.id, p_stars: payment.total_amount,
    });
    return rpcOk(result) ? 200 : 503;
  }

  const refund = update.message?.refunded_payment;
  if (refund) {
    if (refund.currency !== "XTR" || typeof refund.telegram_payment_charge_id !== "string") return 409;
    if (!await services.verify({ kind: "refund", charge: refund.telegram_payment_charge_id })) return 503;
    const result = await services.rpc("cortex_stars_refund", {
      p_charge: refund.telegram_payment_charge_id,
    });
    return rpcOk(result) ? 200 : 503;
  }

  const command = plainBotCommand(update.message?.text);
  const chat = update.message?.chat;
  if (command && chat?.type === "private" && Number.isSafeInteger(update.update_id) &&
      Number(update.update_id) > 0 && Number.isSafeInteger(chat.id) && Number(chat.id) > 0 &&
      chat.id === update.message?.from?.id) {
    const claim = await services.rpc("cortex_stars_claim_bot_command", {
      p_update: update.update_id, p_chat: chat.id,
    });
    if (claim.error) return 503;
    if (claim.data === true) await services.telegram("sendMessage", {
      chat_id: chat.id, text: command, disable_notification: true,
    });
  }
  return 200;
}

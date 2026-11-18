export type DeliveryState = "sent" | "skipped" | "failed" | "unconfirmed";

/**
 * SMTP and PostgreSQL cannot participate in one atomic transaction.
 * Once SMTP accepts a message, never release the queue claim just because
 * recording the receipt failed: that would immediately resend the email.
 */
export async function deliverClaimedNotification(actions: {
  eligible: () => Promise<boolean>;
  send: () => Promise<unknown>;
  confirm: () => Promise<boolean>;
  release: () => Promise<unknown>;
}): Promise<DeliveryState> {
  let acceptedBySmtp = false;
  try {
    if (!await actions.eligible()) {
      await actions.release();
      return "skipped";
    }
    await actions.send();
    acceptedBySmtp = true;
  } catch {
    if (!acceptedBySmtp) await actions.release().catch(() => {});
    return "failed";
  }

  // Retry transient storage failures while the short-lived claim is still ours.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { if (await actions.confirm()) return "sent"; }
    catch { /* Retry without issuing a second SMTP request. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 125));
  }
  return "unconfirmed";
}

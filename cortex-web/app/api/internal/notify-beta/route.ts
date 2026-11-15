import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { betaLaunchEmail, CORTEX_FROM, createCortexMailTransport } from "@/lib/launch-mail";

export const runtime = "nodejs";
export const maxDuration = 120;

type ClaimedRecipient = { user_id: string; email: string; claim_token: string };

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !provided) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // The planned date alone must never trigger sending. The owner enables the
  // release flag and provides a real installation URL only after publishing the APK.
  if (Date.now() < Date.parse("2026-11-20T00:00:00+03:00") || process.env.CORTEX_BETA_RELEASED !== "true") {
    return NextResponse.json({ state: "not_released", sent: 0 });
  }

  const url = process.env.CORTEX_BETA_DOWNLOAD_URL || "";
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(url);
    if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) throw new Error();
  } catch {
    return NextResponse.json({ error: "download_url_not_configured" }, { status: 503 });
  }

  const supabaseUrl = process.env.CORTEX_SUPABASE_URL || process.env.NEXT_PUBLIC_CORTEX_SUPABASE_URL;
  const serviceKey = process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  }

  let mailer;
  try {
    mailer = createCortexMailTransport();
  } catch {
    return NextResponse.json({ error: "mail_not_configured" }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("cortex_claim_beta_notifications", { p_limit: 40 });
  if (error) {
    mailer.close();
    console.error("CORTEX launch mail claim failed", error.code);
    return NextResponse.json({ error: "notification_queue_unavailable" }, { status: 503 });
  }

  const recipients = (data || []) as ClaimedRecipient[];
  const message = betaLaunchEmail(downloadUrl.toString());
  let sent = 0;
  let failed = 0;

  try {
    for (const recipient of recipients) {
      try {
        await mailer.sendMail({ ...message, from: CORTEX_FROM, to: recipient.email,
          messageId: `<cortex-beta-20261120-${recipient.user_id}@cortexapp.ru>` });
        const { data: updated, error: updateError } = await admin.from("cortex_preregistrations")
          .update({ notified_at: new Date().toISOString(), notification_claimed_at: null, notification_claim_token: null })
          .eq("user_id", recipient.user_id).eq("notification_claim_token", recipient.claim_token)
          .eq("notify_opt_in", true).select("user_id").maybeSingle();
        if (updateError || !updated) throw new Error("send_confirm_failed");
        sent++;
      } catch (mailError) {
        failed++;
        const { error: releaseError } = await admin.from("cortex_preregistrations")
          .update({ notification_claimed_at: null, notification_claim_token: null })
          .eq("user_id", recipient.user_id).eq("notification_claim_token", recipient.claim_token);
        if (releaseError) console.error("CORTEX notification claim release failed", releaseError.code);
        console.error("CORTEX launch notification failed", mailError instanceof Error ? mailError.name : "unknown");
        if (failed >= 3) break;
      }
    }
  } finally {
    mailer.close();
  }

  return NextResponse.json({ state: failed ? "partial" : "ok", sent, failed, remainingInBatch: Math.max(0, recipients.length - sent - failed) });
}

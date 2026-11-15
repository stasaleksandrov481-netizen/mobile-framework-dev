import nodemailer from "nodemailer";

const FROM = '"CORTEX" <noreply@cortexapp.ru>';

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

export function betaLaunchEmail(downloadUrl: string) {
  const href = escapeHtml(downloadUrl);
  return {
    subject: "CORTEX: открытая бета уже доступна",
    text: `Открытая бета CORTEX началась.\n\nУстановить приложение: ${downloadUrl}\n\nВы получили письмо, потому что при регистрации попросили сообщить о запуске.\nКоманда CORTEX`,
    html: `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 12px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#131313">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:20px">
<tr><td style="padding:38px 38px 22px;font-size:18px;font-weight:800;letter-spacing:3px">CORTEX</td></tr>
<tr><td style="padding:4px 38px 0"><p style="font-size:11px;letter-spacing:2px;color:#888;font-weight:bold">ОТКРЫТАЯ БЕТА</p>
<h1 style="margin:16px 0 18px;font-size:32px;line-height:1.15;letter-spacing:-1px">Можно начинать.</h1>
<p style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#595959">Бета CORTEX открыта. Установи приложение и войди с тем же аккаунтом, который создал на сайте.</p>
<a href="${href}" style="display:inline-block;padding:15px 24px;background:#111;color:#fff;text-decoration:none;border-radius:12px;font-size:14px;font-weight:bold">Установить CORTEX</a></td></tr>
<tr><td style="padding:35px 38px 36px;font-size:11px;line-height:1.7;color:#8a8a8a">Это одно письмо о запуске, на которое ты согласился при регистрации. Оно не является подпиской на рекламную рассылку.<br>CORTEX · cortexapp.ru</td></tr></table></body></html>`,
  };
}

export function createCortexMailTransport() {
  const username = process.env.CORTEX_SMTP_USER;
  const password = process.env.CORTEX_SMTP_APP_PASSWORD;
  if (username !== "noreply@cortexapp.ru" || !password) {
    throw new Error("VK Workspace SMTP credentials have not been configured");
  }
  return nodemailer.createTransport({
    host: process.env.CORTEX_SMTP_HOST || "smtp.mail.ru",
    port: 465,
    secure: true,
    auth: { user: username, pass: password },
    tls: { minVersion: "TLSv1.2" },
    pool: true,
    maxConnections: 2,
    maxMessages: 40,
  });
}

export const CORTEX_FROM = FROM;

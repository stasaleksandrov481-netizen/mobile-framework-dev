// One-off operational branch. Never run in preview or on other branches.
if (process.env.VERCEL_ENV !== "production" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "ops/telegram-webhook-recovery-20261121") process.exit(0);
const token = process.env.CORTEX_TELEGRAM_BOT_TOKEN;
const secret = process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET;
const target = "https://cortexapp.ru/api/telegram/webhook";
if (!/^[0-9]{6,16}:[A-Za-z0-9_-]{30,128}$/.test(token || "") ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(secret || "")) {
  console.error("TELEGRAM_RECOVERY: missing or invalid production credentials"); process.exit(1);
}
async function api(method, args = {}) {
  let res;
  try {res = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args),
    redirect:"error",signal:AbortSignal.timeout(12000)
  });} catch { throw new Error(method + ": network request failed"); }
  const body = await res.json().catch(()=>null);
  if(!res.ok || body?.ok !== true) throw new Error(method + ": HTTP " + res.status + " Bot API " + (Number(body?.error_code)||0));
  return body.result;
}
function status(info) {
  return {registered: Boolean(info.url), expectedUrl: info.url === target, pending: info.pending_update_count,
    allowed:info.allowed_updates, lastError:info.last_error_date ? String(info.last_error_message||"").replace(/https?:\/\/\S+/g,"[url]").replace(/[0-9]{6,16}:[A-Za-z0-9_-]{30,128}/g,"[redacted]").slice(0,180) : null};
}
try {
 const bot = await api("getMe");
 console.log("TELEGRAM_RECOVERY bot", JSON.stringify({username:bot.username,name:bot.first_name}));
 const before = await api("getWebhookInfo");
 console.log("TELEGRAM_RECOVERY before",JSON.stringify(status(before)));
 const allowed = [...new Set([...(Array.isArray(before.allowed_updates)?before.allowed_updates:[]),"message","callback_query","pre_checkout_query"])];
 await api("setWebhook",{url:target,secret_token:secret,allowed_updates:allowed,drop_pending_updates:false});
 const after = await api("getWebhookInfo");
 console.log("TELEGRAM_RECOVERY after",JSON.stringify(status(after)));
 if(after.url!==target || !after.allowed_updates?.includes("message") || !after.allowed_updates?.includes("callback_query") || !after.allowed_updates?.includes("pre_checkout_query")) throw new Error("webhook verification failed");
 try { await api("setMyCommands",{scope:{type:"all_private_chats"},commands:[{command:"start",description:"Открыть CORTEX"},{command:"menu",description:"Главное меню"},{command:"account",description:"Аккаунт и привязка"},{command:"plans",description:"Тарифы"},{command:"pay",description:"Оплата Stars"},{command:"support",description:"Поддержка"},{command:"paysupport",description:"Поддержка платежей"}]}); console.log("TELEGRAM_RECOVERY commands configured"); } catch(e){ console.warn("TELEGRAM_RECOVERY commands:",e.message); }
 console.log("TELEGRAM_RECOVERY verified");
} catch(e){console.error("TELEGRAM_RECOVERY failed:",e.message);process.exitCode=1;}

import { starsInvoiceUrl, starsPlan, starsPayloadId, type StarsPlan } from "./telegram-stars.ts";

export type BotCheckoutResult = {ok:true; id:string; stars:number; url:string} | {ok:false; error:string};
type Result = {data?:unknown;error?:unknown};
type Services = {
  rpc(name:string,args:Record<string,unknown>):Promise<Result>;
  telegram(name:string,args:Record<string,unknown>):Promise<unknown>;
};
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const failure=(error:string):BotCheckoutResult=>({ok:false,error});
const knownErrors=new Set(["link_required","payment_pending","payment_processing","other_checkout_pending","rate_limited","stars_disabled","payments_disabled","funding_unavailable","invalid_plan"]);
export async function createBotStarsCheckout(telegramId:number,plan:StarsPlan,services:Services):Promise<BotCheckoutResult>{
  if(!Number.isSafeInteger(telegramId)||telegramId<=0||!starsPlan(plan))return failure("invalid_plan");
  try {
    // Only the signed webhook supplies Telegram identity. Price/account are SQL-owned.
    const response=await services.rpc("cortex_stars_bot_new_order",{p_telegram:telegramId,p_plan:plan});
    const order=record(response.data);
    if(response.error||!order)return failure("billing_unavailable");
    if(typeof order.error==="string")return failure(knownErrors.has(order.error)?order.error:"billing_unavailable");
    const id=typeof order.id==="string"?starsPayloadId("cortex-stars:"+order.id):null;
    const stars=order.stars;
    if(!id||order.plan!==plan||typeof stars!=="number"||!Number.isSafeInteger(stars)||stars<1||stars>10000)return failure("billing_unavailable");
    if(order.status==="invoiced"){
      const url=starsInvoiceUrl(order.invoice_url);
      return url?{ok:true,id,stars,url}:failure("invoice_unavailable");
    }
    if(order.status!=="created")return failure("payment_pending");
    const title="CORTEX "+plan.toUpperCase();
    const link=await services.telegram("createInvoiceLink",{
      title,description:"Один месяц доступа. Без автопродления.",
      payload:"cortex-stars:"+id,currency:"XTR",prices:[{label:title,amount:stars}],
    });
    const url=starsInvoiceUrl(link);
    if(!url)return failure("invoice_unavailable");
    const result=await services.rpc("cortex_stars_invoice_ready",{p_id:id,p_url:url});
    const ready=record(result.data),finalUrl=starsInvoiceUrl(ready?.invoice_url);
    if(result.error||!ready||ready.error||ready.id!==id||ready.stars!==stars||!finalUrl)return failure("invoice_unavailable");
    return {ok:true,id,stars,url:finalUrl};
  }catch{return failure("billing_unavailable");}
}

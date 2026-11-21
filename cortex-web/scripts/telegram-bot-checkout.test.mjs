import test from "node:test";
import assert from "node:assert/strict";
import {createBotStarsCheckout} from "../lib/telegram-bot-checkout.ts";
const id="11111111-1111-1111-1111-111111111111",url="https://t.me/$invoice";
function harness(order={id,plan:"pro",stars:399,status:"created"}){
 const calls=[];
 return {calls,services:{
  rpc:async(name,args)=>{calls.push({name,args});return {data:name==="cortex_stars_bot_new_order"?order:{id,stars:399,invoice_url:url}};},
  telegram:async(name,args)=>{calls.push({name,args});return url;}
 }};
}
test("Creates Telegram-native XTR link with database-owned price, then finalizes",async()=>{
 const h=harness();assert.deepEqual(await createBotStarsCheckout(7851246214,"pro",h.services),{ok:true,id,stars:399,url});
 assert.deepEqual(h.calls.map(c=>c.name),["cortex_stars_bot_new_order","createInvoiceLink","cortex_stars_invoice_ready"]);
 assert.deepEqual(h.calls[0].args,{p_telegram:7851246214,p_plan:"pro"});assert.equal(h.calls[1].args.currency,"XTR");assert.equal(h.calls[1].args.prices[0].amount,399);
 assert.equal(h.calls[1].args.payload,"cortex-stars:"+id);
});
test("Reuses pending invoice rather than creating another",async()=>{
 const h=harness({id,plan:"pro",stars:399,status:"invoiced",invoice_url:url});
 assert.equal((await createBotStarsCheckout(123,"pro",h.services)).ok,true);assert.equal(h.calls.length,1);
});
test("Unlinked, pending and disabled states cannot generate invoice",async()=>{
 for(const error of ["link_required","payment_processing","stars_disabled"]){const h=harness({error});assert.deepEqual(await createBotStarsCheckout(123,"pro",h.services),{ok:false,error});assert.equal(h.calls.length,1);}
});
test("Rejects untrusted invoice destination",async()=>{
 const h=harness();h.services.telegram=async()=>"https://evil.example/pay";assert.deepEqual(await createBotStarsCheckout(123,"pro",h.services),{ok:false,error:"invoice_unavailable"});assert.equal(h.calls.length,1);
});
test("Rejects mismatched SQL order and invalid amount",async()=>{
 for(const order of [{id,plan:"ultra",stars:399,status:"created"},{id,plan:"pro",stars:0,status:"created"}]){const h=harness(order);assert.equal((await createBotStarsCheckout(123,"pro",h.services)).ok,false);assert.equal(h.calls.length,1);}
});
test("Ignores unfinalized invoice when DB finalization fails",async()=>{
 const h=harness(),rpc=h.services.rpc;h.services.rpc=async(n,a)=>n==="cortex_stars_invoice_ready"?{error:new Error()}:rpc(n,a);
 assert.deepEqual(await createBotStarsCheckout(123,"pro",h.services),{ok:false,error:"invoice_unavailable"});
});

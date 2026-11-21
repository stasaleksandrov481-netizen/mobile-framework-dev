import test from "node:test";
import assert from "node:assert/strict";
import {createNavigationClaim,NAVIGATION_GATE} from "../lib/telegram-navigation-cache.ts";
test("Fast gate uses one atomic call, pseudonymous key and bounded expiry",async()=>{
 let calls=0;const gate=createNavigationClaim(async(script,keys,args)=>{
   calls++;assert.equal(script,NAVIGATION_GATE);assert.match(script,/ZREMRANGEBYSCORE/);
   assert.match(script,/EXPIRE',key,180/);assert.match(script,/ZCOUNT/);
   assert.match(keys[0],/^cortex:telegram:nav:v1:[a-f0-9]{32}$/);
   assert.deepEqual(args,[123456,"101"]);return 1;
 },()=>"test-secret",()=>123456);
 assert.equal(await gate(101,123,async()=>{throw Error("no SQL")}),true);assert.equal(calls,1);
});
test("Duplicate or limited requests are not allowed to bypass via SQL",async()=>{
 const gate=createNavigationClaim(async()=>0,()=>"secret");
 assert.equal(await gate(1,1,async()=>{throw Error("no bypass")}),false);
});
test("Redis circuit opens on failure and retries after 30 seconds",async()=>{
 let calls=0,now=1000,fallbacks=0;
 const gate=createNavigationClaim(async()=>{calls++;throw Error("offline")},()=>"secret",()=>now);
 const fallback=async()=>{fallbacks++;return true};
 assert.equal(await gate(1,2,fallback),true);now+=1000;
 assert.equal(await gate(2,2,fallback),true);assert.equal(calls,1);
 now+=30000;await gate(3,2,fallback);assert.equal(calls,2);assert.equal(fallbacks,3);
});
test("Missing Redis secret falls back to durable SQL",async()=>{
 const gate=createNavigationClaim(async()=>{throw Error("no Redis")},()=>undefined);
 assert.equal(await gate(1,2,async()=>true),true);
});

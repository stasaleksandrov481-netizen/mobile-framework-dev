import {createHmac} from "node:crypto";

type EvalPort=(script:string,keys:string[],args:unknown[])=>Promise<unknown>;
type DurableClaim=()=>Promise<boolean>;
// One network round trip, atomic deduplication + sliding rate window.
// Keep only short-lived public-navigation update IDs, not account or payment data.
export const NAVIGATION_GATE = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local member = ARGV[2]
redis.call('ZREMRANGEBYSCORE',key,'-inf',now-180000)
if redis.call('ZSCORE',key,member) then return 0 end
if redis.call('ZCOUNT',key,now-60000,'+inf') >= 30 then return 0 end
redis.call('ZADD',key,now,member)
redis.call('EXPIRE',key,180)
return 1
`;
export function createNavigationClaim(evaluate:EvalPort,secret:()=>string|undefined,now=Date.now){
  let unavailableUntil=0;
  return async(updateId:number,chatId:number,fallback:DurableClaim):Promise<boolean>=>{
    const keySecret=secret();
    if(!keySecret||now()<unavailableUntil)return fallback();
    if(!Number.isSafeInteger(updateId)||updateId<=0||!Number.isSafeInteger(chatId)||chatId<=0)return false;
    const identity=createHmac("sha256",keySecret).update(String(chatId)).digest("hex").slice(0,32);
    try {
      const result=await evaluate(NAVIGATION_GATE,["cortex:telegram:nav:v1:"+identity],[now(),String(updateId)]);
      if(result===1||result==="1")return true;
      if(result===0||result==="0")return false;
      throw Error("invalid_redis_gate_result");
    }catch{
      unavailableUntil=now()+30000;
      return fallback();
    }
  };
}

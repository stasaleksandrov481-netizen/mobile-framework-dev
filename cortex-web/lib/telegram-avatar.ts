import {telegramBotApi,telegramConfigurationValid} from "./telegram-stars.ts";

const MAX=256*1024;
const TTL=60_000;
type Photo=ArrayBuffer|null;
type Api=(method:string,args:Record<string,unknown>)=>Promise<unknown>;
type Entry={until:number;value:Photo};
const cache=new Map<string,Entry>();
const inflight=new Map<string,Promise<Photo>>();
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;

export async function loadTelegramProfilePhoto(telegramId:number,token:string,api:Api,network:typeof fetch=fetch):Promise<Photo>{
  if(!Number.isSafeInteger(telegramId)||telegramId<=0||!/^[0-9]{6,16}:[A-Za-z0-9_-]{30,128}$/.test(token))return null;
  const info=obj(await api("getUserProfilePhotos",{user_id:telegramId,limit:1,offset:0}));
  if(!info||!Array.isArray(info.photos))throw Error("avatar_unavailable");
  if(info.photos.length===0)return null;
  const group=info.photos[0];
  if(!Array.isArray(group))throw Error("avatar_unavailable");
  const sizes=group.map(obj).filter((p):p is Record<string,unknown>=>!!p&&
    typeof p.file_id==="string"&&p.file_id.length>0&&p.file_id.length<=512&&
    Number.isInteger(p.width)&&Number(p.width)>0&&Number(p.width)<=640&&
    Number.isInteger(p.height)&&Number(p.height)>0&&Number(p.height)<=640&&
    (p.file_size===undefined||(Number.isSafeInteger(p.file_size)&&Number(p.file_size)>0&&Number(p.file_size)<=MAX)));
  sizes.sort((a,b)=>Math.abs(Number(a.width)-160)-Math.abs(Number(b.width)-160));
  if(!sizes.length)return null;
  const file=obj(await api("getFile",{file_id:sizes[0].file_id}));
  const path=file?.file_path;
  // Only the fixed Telegram origin and strictly bounded ordinary JPEG paths.
  // Never return the credential-bearing provider URL to the browser.
  if(typeof path!=="string"||path.length>256||!/^photos\/[A-Za-z0-9_-]+\.(?:jpg|jpeg)$/i.test(path))throw Error("avatar_unavailable");
  if(file?.file_size!==undefined&&(!Number.isSafeInteger(file.file_size)||Number(file.file_size)>MAX))throw Error("avatar_too_large");
  const response=await network("https://api.telegram.org/file/bot"+token+"/"+path,{
    redirect:"error",cache:"no-store",signal:AbortSignal.timeout(4000),
  });
  if(!response.ok||!response.body)throw Error("avatar_unavailable");
  const declared=Number(response.headers.get("content-length"));
  if(declared>MAX){await response.body.cancel();throw Error("avatar_too_large");}
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const part=await reader.read();if(part.done)break;
      total+=part.value.byteLength;
      if(total>MAX){await reader.cancel();throw Error("avatar_too_large");}
      chunks.push(part.value);
    }
  }finally{reader.releaseLock();}
  const data=new ArrayBuffer(total),bytes=new Uint8Array(data);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  if(total<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes[total-2]!==255||bytes[total-1]!==217)throw Error("avatar_invalid");
  return data;
}

// Small process-local cache only. Auth and current link are checked BEFORE calling.
// Cache key includes link generation, so a revoked or replaced link cannot reuse it.
export async function telegramAvatar(accountId:string,telegramId:number,revision:string):Promise<Photo>{
  const token=process.env.CORTEX_TELEGRAM_BOT_TOKEN;
  if(!token||!telegramConfigurationValid(token,process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET))return null;
  const key=accountId+":"+telegramId+":"+revision;
  const current=cache.get(key);
  if(current&&current.until>Date.now())return current.value;
  if(inflight.has(key))return inflight.get(key)!;
  // Bound concurrent provider calls as well as total in-memory image bytes.
  if(inflight.size>=16)throw Error("avatar_busy");
  const request=loadTelegramProfilePhoto(telegramId,token,(method,args)=>telegramBotApi(token,method,args))
    .then(value=>{
      const now=Date.now();
      for(const [id,item] of cache)if(item.until<=now||id.startsWith(accountId+":"))cache.delete(id);
      while(cache.size>=32){const first=cache.keys().next().value;if(first===undefined)break;cache.delete(first);}
      cache.set(key,{value,until:now+TTL});
      return value;
    }).finally(()=>inflight.delete(key));
  inflight.set(key,request);
  return request;
}

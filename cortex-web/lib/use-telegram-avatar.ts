"use client";
import {useEffect,useState} from "react";
import {cortexAuth} from "@/lib/cortex-auth";

const eventName="cortex:telegram-avatar-change";
const ttl=60_000;
type Snapshot={id:string;blob:Blob|null;until:number};
let cached:Snapshot|null=null;
let generation=0;
let pending:{id:string;promise:Promise<Blob|null>}|null=null;

export function invalidateTelegramAvatar(){
  generation++;
  cached=null;
  pending=null;
  if(typeof window!=="undefined")window.dispatchEvent(new Event(eventName));
}
async function load(id:string):Promise<Blob|null>{
  if(cached?.id===id&&cached.until>Date.now())return cached.blob;
  if(pending?.id===id)return pending.promise;
  const revision=++generation;
  const promise=(async()=>{
    try{
      const {data:{session}}=await cortexAuth.auth.getSession();
      if(!session?.access_token||session.user.id!==id)return null;
      const result=await fetch("/api/telegram/link?avatar=1",{
        credentials:"same-origin",cache:"no-store",headers:{Authorization:"Bearer "+session.access_token},signal:AbortSignal.timeout(20000)
      });
      let blob:Blob|null=null;
      if(result.ok&&result.status===200&&result.headers.get("content-type")==="image/jpeg"){
        const value=await result.blob();
        if(value.size>0&&value.size<=256*1024)blob=value;
      }
      if(revision===generation){cached={id,blob,until:Date.now()+(result.ok?ttl:10000)};}
      return revision===generation?blob:null;
    }catch{return null;}
  })().finally(()=>{if(pending?.promise===promise)pending=null;});
  pending={id,promise};return promise;
}

export function useTelegramAvatar(accountId:string|null|undefined){
  const [photo,setPhoto]=useState<{id:string;url:string}|null>(null);
  useEffect(()=>{
    if(!accountId)return;
    let alive=true,revision=0,objectUrl:string|null=null;
    const clear=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;setPhoto(null);};
    const refresh=async(force=false)=>{
      if(document.hidden&&!force)return;
      const request=++revision;
      const blob=await load(accountId);
      if(!alive||request!==revision)return;
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      objectUrl=blob?URL.createObjectURL(blob):null;
      setPhoto(objectUrl?{id:accountId,url:objectUrl}:null);
    };
    const changed=()=>{++revision;clear();void refresh(true);};
    const onFocus=()=>{if(!document.hidden)void refresh();};
    const onAuth=(event:string)=>{
      if(event==="SIGNED_OUT"){++generation;cached=null;pending=null;++revision;clear();}
    };
    const {data:{subscription}}=cortexAuth.auth.onAuthStateChange(onAuth);
    void refresh(true);
    window.addEventListener(eventName,changed);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onFocus);
    const interval=window.setInterval(onFocus,ttl);
    return ()=>{alive=false;++revision;if(objectUrl)URL.revokeObjectURL(objectUrl);subscription.unsubscribe();
      window.removeEventListener(eventName,changed);window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onFocus);window.clearInterval(interval);};
  },[accountId]);
  return photo?.id===accountId?photo?.url??null:null;
}

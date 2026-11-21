"use client";
import {useState} from "react";

export const avatarTones=["graphite","silver","stone","olive","clay","plum"] as const;
export type AvatarTone=typeof avatarTones[number];
export const avatarTone=(raw:unknown):AvatarTone=>typeof raw==="string"&&avatarTones.includes(raw as AvatarTone)?raw as AvatarTone:"graphite";
function initials(name:string):string{
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]?.toUpperCase()).join("")||"C";
}
export function AccountAvatar({name,tone="graphite",size="medium",photo=null}:{name:string;tone?:AvatarTone;size?:"small"|"medium"|"large";photo?:string|null}){
  const [failed,setFailed]=useState<string|null>(null);
  const show=photo&&photo!==failed&&photo.startsWith("blob:");
  return <span className={"account-avatar account-avatar--"+tone+" account-avatar--"+size} aria-hidden="true">
    {show?<img className="cortex-avatar-photo" src={photo} alt="" onError={()=>setFailed(photo)}/>:initials(name)}
  </span>;
}

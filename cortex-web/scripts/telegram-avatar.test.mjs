import test from "node:test";
import assert from "node:assert/strict";
import {loadTelegramProfilePhoto} from "../lib/telegram-avatar.ts";
const token="123456789:"+"x".repeat(35);
const jpeg=new Uint8Array([255,216,255,224,255,217]);
const photo={file_id:"small",width:160,height:160,file_size:6};
const mock=()=>({calls:[],networkCalls:[],api:null});
test("Only latest small profile picture is fetched through fixed Telegram path",async()=>{
 const calls=[];const image=await loadTelegramProfilePhoto(123,token,async(method,args)=>{
   calls.push([method,args]);
   return method==="getUserProfilePhotos"?{photos:[[photo,{file_id:"large",width:640,height:640}]]}:{file_path:"photos/file_12.jpg",file_size:6};
 },async(url,options)=>{
   assert.equal(url,"https://api.telegram.org/file/bot"+token+"/photos/file_12.jpg");
   assert.equal(options.redirect,"error");assert.equal(options.cache,"no-store");
   return new Response(jpeg,{headers:{"content-type":"image/jpeg"}});
 });
 assert.deepEqual(calls,[["getUserProfilePhotos",{user_id:123,limit:1,offset:0}],["getFile",{file_id:"small"}]]);
 assert.deepEqual(new Uint8Array(image),jpeg);
});
test("No photo returns null, private details stay on the server",async()=>{
 assert.equal(await loadTelegramProfilePhoto(123,token,async()=>({photos:[]}),async()=>{throw Error("must not download")}),null);
});
test("Provider path traversal and arbitrary URLs are rejected before downloading",async()=>{
 for(const path of ["photos/../file.jpg","https://example.com/x.jpg","photos/file.svg","photos/%2e%2e.jpg"]){
   await assert.rejects(loadTelegramProfilePhoto(123,token,async(method)=>method==="getUserProfilePhotos"?{photos:[[photo]]}:{file_path:path},async()=>{throw Error("must not download")}),/avatar_unavailable/);
 }
});
test("Oversized or non-JPEG responses cannot become avatars",async()=>{
 const api=async(method)=>method==="getUserProfilePhotos"?{photos:[[photo]]}:{file_path:"photos/file.jpg"};
 await assert.rejects(loadTelegramProfilePhoto(123,token,api,async()=>new Response(new Uint8Array(256*1024+1))),/avatar_too_large/);
 await assert.rejects(loadTelegramProfilePhoto(123,token,api,async()=>new Response("<svg/>")),/avatar_invalid/);
});

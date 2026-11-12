// PROTOTYPE — "Does Knock hold up against Cadence?" (#47): does a tenant default preference make
// new-enrollment off by default? Result: no, the Notification was still delivered. Never merge.
// Run: npx tsx --env-file=.env scripts/prototype-knock-tenant-default.ts
import Knock, { signUserToken } from "@knocklabs/node";
const k = new Knock();
const API="https://api.knock.app/v1", PUB=process.env.KNOCK_PUBLIC_API_KEY!, FEED=process.env.KNOCK_FEED_CHANNEL_ID!;
const uid="prototype-fresh-"+Date.now(); const inst={id:uid,name:"Fresh Instructor"}, james={id:"6",name:"James Park"};
await k.users.update(uid,{name:inst.name});
const tok=await signUserToken(uid,{expiresInSeconds:600});
const call=async(p:string,init?:RequestInit)=>{const r=await fetch(API+p,{...init,headers:{Authorization:`Bearer ${PUB}`,"X-Knock-User-Token":tok,"Content-Type":"application/json"}});return {status:r.status,body:await r.json().catch(()=>null) as any}};
const count=async()=>(await call(`/users/${uid}/feeds/${FEED}`)).body.meta.total_count;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const enroll=(tenant?:string)=>k.workflows.trigger("new-enrollment",{actor:james,recipients:[inst],...(tenant?{tenant}:{}),data:{course_title:"Prototype course"}});
console.log("prefs before", JSON.stringify((await call(`/users/${uid}/preferences/default`)).body));
let c=await count(); await enroll("cadence"); await sleep(5000); console.log("A fresh user, tenant default off (expect unchanged)", c,"->",await count());
c=await count(); await enroll(); await sleep(5000); console.log("A2 fresh user, no tenant (expect +1)", c,"->",await count());
await call(`/users/${uid}/preferences/default`,{method:"PUT",body:JSON.stringify({__persistence_strategy__:"merge",workflows:{"new-enrollment":{channel_types:{in_app_feed:true}}}})});
c=await count(); await enroll("cadence"); await sleep(5000); console.log("B opted in, tenant (expect +1)", c,"->",await count());

import { readFile,writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { mpRequest } from "../netlify/functions/lib/mercadopago.js";

let stage="verify_test_account";
try {
  const posName=(process.argv[2] || "MidatoPay pruebas").trim();
  if(!/^[A-Za-z0-9_-]+(?:[ A-Za-z0-9_-]*[A-Za-z0-9_-])?$/.test(posName) || posName.length>45)throw new Error("invalid_test_pos_name");
  const token=process.env.MP_ACCESS_TOKEN?.trim(),seller=process.env.MP_USER_ID?.trim();
  if(!token || !seller)throw new Error("missing_test_credentials");
  const response=await fetch("https://api.mercadolibre.com/users/me",{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  const account=await response.json();
  if(!response.ok || String(account.id)!==seller || account.site_id!=="MLA" || !(account.tags || []).includes("test_user"))throw new Error("test_seller_required");
  if(process.env.MP_ENVIRONMENT!=="test" || process.env.VITE_SOLANA_CLUSTER!=="devnet")throw new Error("test_network_required");
  const settings={token,seller},externalStore=`MIDATOTESTSTORE${seller}`,externalPos=`MIDATOTESTPOS${seller}`;
  const rows=result=>{
    const list=Array.isArray(result.results)?result.results:Array.isArray(result.data)?result.data:null;
    if(!list)throw new Error("unexpected_search_response");return list;
  };
  const search=async path=>{
    try{return rows(await mpRequest(path,settings));}
    catch(error){if(["mercadopago_store_not_found","mercadopago_pos_not_found"].includes(error.code))return [];throw error;}
  };
  stage="search_test_store";
  let store=(await search(`/users/${seller}/stores/search?external_id=${externalStore}&limit=30`))
    .find(s=>s.external_id===externalStore);
  if(!store) {
    // Reuse the location already registered by this test seller; never invent a fiscal address.
    const existing=rows(await mpRequest(`/users/${seller}/stores/search?limit=30`,settings));
    const source=existing.find(s=>s.location?.address_line && s.location?.latitude && s.location?.longitude);
    if(!source)throw new Error("test_store_location_required");
    const parts=source.location.address_line.split(",").map(x=>x.trim());
    const street=parts[0].match(/^(.*?)\s+(\d+[A-Za-z]?)$/);
    if(!street || !parts[1] || !parts[2])throw new Error("test_store_location_unrecognized");
    stage="create_test_store";
    store=await mpRequest(`/users/${seller}/stores`,settings,{method:"POST",body:JSON.stringify({
      name:"MidatoPay pruebas",external_id:externalStore,location:{street_name:street[1],street_number:street[2],
        city_name:source.location.city || parts[1],state_name:parts[2],latitude:source.location.latitude,
        longitude:source.location.longitude,reference:source.location.reference || "MidatoPay pruebas"}
    })});
  }
  stage="verify_created_store";
  store=await mpRequest(`/stores/${encodeURIComponent(store.id)}`,settings);
  if(String(store.user_id)!==seller || store.external_id!==externalStore)throw new Error("test_store_owner_mismatch");
  stage="search_test_pos";
  let pos=(await search(`/v2/pos?external_id=${externalPos}&limit=30`)).find(p=>p.external_id===externalPos);
  if(!pos) {
    const hex=createHash("sha256").update(`midatopay:test-pos:${seller}`).digest("hex");
    const key=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    stage="create_test_pos";
    pos=await mpRequest("/v2/pos",settings,{method:"POST",headers:{"X-Idempotency-Key":key},body:JSON.stringify({
      name:posName,store_id:String(store.id),external_id:externalPos,config:{qr:{operating_mode:"pdv"}}
    })});
  }
  if(!pos.id || String(pos.user_id)!==seller || String(pos.store_id)!==String(store.id) ||
    pos.external_id!==externalPos || pos.config?.qr?.operating_mode!=="pdv" || pos.status==="inactive")throw new Error("test_pos_mismatch");
  let contents=await readFile(".env","utf8");
  const values=parseEnv(contents);
  if(values.MP_ACCESS_TOKEN?.trim()!==token || values.MP_USER_ID?.trim()!==seller)throw new Error("env_changed_during_provisioning");
  for(const [key,value]of Object.entries({MP_STORE_ID:String(store.id),MP_EXTERNAL_POS_ID:externalPos})) {
    const pattern=new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`,"m");
    contents=pattern.test(contents)?contents.replace(pattern,()=>`${key}=${value}`):contents+`\n${key}=${value}`;
  }
  await writeFile(".env",contents);
  console.log(JSON.stringify({testSellerVerified:true,userId:seller,storeId:String(store.id),externalStoreId:externalStore,
    posId:String(pos.id),externalPosId:externalPos,envUpdated:true}));
} catch(error){
  const safe=["invalid_test_pos_name","missing_test_credentials","test_seller_required","test_network_required","unexpected_search_response",
    "test_store_location_required","test_store_location_unrecognized","test_store_owner_mismatch","test_pos_mismatch","env_changed_during_provisioning"];
  console.error(JSON.stringify({stage,error:error.code || (safe.includes(error.message)?error.message:"test_provisioning_failed")}));process.exitCode=1;
}

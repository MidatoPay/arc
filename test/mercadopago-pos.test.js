import test from "node:test";
import assert from "node:assert/strict";
import { verifySeller, verifySellerAccount, verifyStore, mpRequest } from "../netlify/functions/lib/mercadopago.js";

test("seller validation accepts current and legacy POS responses without masking configuration errors",async()=>{
  const original=globalThis.fetch;
  let payload, tags=[],calls=0;
  globalThis.fetch=async(url)=>{
    calls++;
    return {ok:true,json:async()=>String(url).includes("/users/me") ? {id:123,site_id:"MLA",tags} : payload};
  };
  const settings={token:"test-only-token",seller:"123",pos:"POS1",environment:"production"};
  const pos={external_id:"POS1",user_id:123,config:{qr:{operating_mode:"pdv"}}};
  try {
    for(const field of ["data","results"]) {
      payload={[field]:[pos]};
      await verifySeller({...settings,token:`test-only-${field}`});
    }
    for(const [body,code] of [[{data:[]},"mercadopago_pos_not_found"],
      [{data:[{...pos,config:{qr:{operating_mode:"static"}}}]},"mercadopago_pos_not_pdv"],
      [{data:[{...pos,user_id:456}]},"seller_account_mismatch"],
      [{unexpected:[]},"mercadopago_invalid_pos_response"]]) {
      payload=body;
      await assert.rejects(()=>verifySeller({...settings,token:`test-only-${code}`}),{code});
    }
    payload={data:[pos]};
    await verifySeller({...settings,token:"test-only-cache"});
    const before=calls;
    await verifySeller({...settings,token:"test-only-cache"});
    assert.equal(calls,before);
    await assert.rejects(()=>verifySeller({...settings,token:"test-only-cache",environment:"test"}),{code:"seller_is_not_test_account"});
    assert.ok(calls>before);
  } finally {globalThis.fetch=original;}
});

test("provider diagnostics distinguish credentials, malformed responses and store ownership",async()=>{
 const original=globalThis.fetch,settings={token:"offline",seller:"123",store:"456",environment:"production"};
 try {
  for(const [status,code] of [[401,"mercadopago_http_401"],[403,"mercadopago_forbidden"],[500,"mercadopago_account_unavailable"]]) {
   globalThis.fetch=async()=>({ok:false,status,json:async()=>({message:"private-provider-message"})});
   await assert.rejects(()=>verifySellerAccount(settings),{code});
  }
  for(const body of [null,[],"private-provider-message"]) {
   globalThis.fetch=async()=>({ok:true,json:async()=>body});
   await assert.rejects(()=>mpRequest("/v1/orders/example",settings),{code:"mercadopago_invalid_response"});
  }
  globalThis.fetch=async()=>({ok:true,json:async()=>({id:456,user_id:123})});
  assert.equal((await verifyStore(settings)).id,456);
  globalThis.fetch=async()=>({ok:true,json:async()=>({id:456,user_id:999})});
  await assert.rejects(()=>verifyStore(settings),{code:"mercadopago_store_owner_mismatch"});
  globalThis.fetch=async()=>{throw new Error("private-network-details");};
  await assert.rejects(()=>verifySellerAccount(settings),{code:"mercadopago_timeout"});
 } finally {globalThis.fetch=original;}
});

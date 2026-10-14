import test from "node:test";
import assert from "node:assert/strict";
import { verifySeller } from "../netlify/functions/lib/mercadopago.js";

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

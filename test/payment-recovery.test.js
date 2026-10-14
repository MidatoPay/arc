import test from "node:test";
import assert from "node:assert/strict";
import { prepareChargeAttempt, chargeError } from "../src/charges.js";
import { errorResponse } from "../netlify/functions/lib/paymentRuntime.js";

test("editing an unconfirmed amount retains the idempotency key and original wallet",()=>{
  const previous={key:"same-key",ars:"100",wallet:"original"};
  const edited=prepareChargeAttempt(previous,"250,50","different");
  assert.deepEqual(edited,{key:"same-key",ars:"250.50",wallet:"original"});
  assert.equal(previous.ars,"100");
});
test("a persisted operation cannot change its amount during a retry",()=>{
  const previous={key:"same-key",id:"persisted",ars:"100",wallet:"original"};
  assert.equal(prepareChargeAttempt(previous,"250","different"),previous);
});
test("database diagnostics expose safe codes and never raw credentials or SQL",()=>{
  const original=console.error,logs=[];console.error=(...args)=>logs.push(args);
  try {
    for(const [cause,expected] of [["42P01","payment_schema_missing"],["42703","payment_schema_outdated"],
      ["28P01","payment_database_auth_failed"],["SELF_SIGNED_CERT_IN_CHAIN","payment_database_tls_failed"],
      ["ECONNREFUSED","payment_database_unavailable"],["unknown","payment_service_unavailable"]]) {
      const response=errorResponse({code:cause,message:"private-password",query:"private-sql"});
      assert.equal(response.statusCode,503);assert.deepEqual(JSON.parse(response.body),{error:expected});
      assert.ok(!response.body.includes("private"));
      assert.ok(chargeError(expected).length>0);
    }
    assert.ok(!JSON.stringify(logs).includes("private"));
  } finally { console.error=original; }
});

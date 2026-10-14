import test from "node:test";
import assert from "node:assert/strict";
import { prepareChargeAttempt, chargeError } from "../src/charges.js";
import { errorResponse, paymentQuoteSettings } from "../netlify/functions/lib/paymentRuntime.js";

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
test("missing configuration identifies the variable without exposing values",()=>{
  for(const key of ["mp_access_token","mp_user_id","mp_webhook_secret","solana_rpc","internal_worker_secret","eth_rpc_url","chainlink_max_age_seconds"])
    assert.ok(chargeError(`missing_${key}`).includes(key.toUpperCase()));
  assert.ok(!chargeError("missing_untrusted-value/password").includes("password"));
});
test("quote configuration distinguishes absent RPC, invalid URL and absent or invalid freshness policy",()=>{
  const rpc=process.env.ETH_RPC_URL,age=process.env.CHAINLINK_MAX_AGE_SECONDS;
  try {
    delete process.env.ETH_RPC_URL;assert.throws(()=>paymentQuoteSettings(),{code:"missing_eth_rpc_url"});
    process.env.ETH_RPC_URL="invalid";assert.throws(()=>paymentQuoteSettings(),{code:"invalid_eth_rpc_url"});
    process.env.ETH_RPC_URL="https://example.invalid";delete process.env.CHAINLINK_MAX_AGE_SECONDS;
    assert.throws(()=>paymentQuoteSettings(),{code:"missing_chainlink_max_age_seconds"});
    for(const value of ["0","-1","1.5","1e3","Infinity","9007199254740992"]){
      process.env.CHAINLINK_MAX_AGE_SECONDS=value;assert.throws(()=>paymentQuoteSettings(),{code:"invalid_chainlink_max_age_seconds"});
    }
    process.env.CHAINLINK_MAX_AGE_SECONDS="60";assert.deepEqual(paymentQuoteSettings(),{rpc:"https://example.invalid",maxAge:60});
  } finally {
    if(rpc===undefined)delete process.env.ETH_RPC_URL;else process.env.ETH_RPC_URL=rpc;
    if(age===undefined)delete process.env.CHAINLINK_MAX_AGE_SECONDS;else process.env.CHAINLINK_MAX_AGE_SECONDS=age;
  }
});

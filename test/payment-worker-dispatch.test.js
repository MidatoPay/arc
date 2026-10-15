import test from "node:test";
import assert from "node:assert/strict";
import { kickWorker } from "../netlify/functions/lib/paymentRuntime.js";

test("worker dispatch reports failures without exposing credentials or losing the durable intent",async()=>{
  const env={PAYMENTS_BASE_URL:"https://example.invalid",INTERNAL_WORKER_SECRET:"private-worker-secret"};
  const logs=[];
  const log=(...args)=>logs.push(args);
  assert.deepEqual(await kickWorker({env:{},log}),{accepted:false,code:"payment_worker_not_configured"});
  const rejected=await kickWorker({env,log,request:async()=>({ok:false,status:401})});
  assert.equal(rejected.accepted,false);
  assert.deepEqual(logs.at(-1),["payments_worker_dispatch_failed",{code:"payment_worker_dispatch_failed",status:401}]);
  assert.equal((await kickWorker({env,log,request:async()=>{throw new Error("private-worker-secret");}})).accepted,false);
  assert.ok(!JSON.stringify(logs).includes(env.INTERNAL_WORKER_SECRET));
  const accepted=await kickWorker({env,log,request:async(url,options)=>{
    assert.equal(url.pathname,"/.netlify/functions/payments-worker-background");
    assert.equal(options.headers["x-worker-secret"],env.INTERNAL_WORKER_SECRET);
    return {ok:true,status:202};
  }});
  assert.deepEqual(accepted,{accepted:true});
});

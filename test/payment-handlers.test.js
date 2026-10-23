import test from "node:test";
import assert from "node:assert/strict";
import { createChargesHandler } from "../netlify/functions/charges.js";
import { createPaymentReportsHandler } from "../netlify/functions/payment-reports.js";
import { PaymentError } from "../netlify/functions/lib/paymentCore.js";

test("charge endpoint commits an intent before dispatch and returns 202 for asynchronous QR creation",async()=>{
 const events=[],c={id:"00000000-0000-4000-8000-000000000001",status:"creating",amount_cents:"10000",fee_cents:"50",usdc_raw:"60000",signed_tx:"private"};
 const handler=createChargesHandler({authenticatePayment:async()=>"merchant",paymentSettings:()=>({}),
 createCharge:async(user,input,key)=>{events.push({user,input,key});return c;},kickWorker:async()=>events.push("dispatch")});
 const result=await handler({path:"/charges",httpMethod:"POST",headers:{"idempotency-key":"same-attempt"},body:JSON.stringify({ars:"100",wallet:"wallet"})});
 assert.equal(result.statusCode,202);assert.equal(events[0].user,"merchant");assert.equal(events[0].key,"same-attempt");assert.equal(events[1],"dispatch");
 assert.ok(!result.body.includes("private"));
});
test("unauthenticated charge requests cannot create orders or dispatch workers",async()=>{
 const handler=createChargesHandler({authenticatePayment:async()=>{throw new PaymentError("unauthorized",401);},
 createCharge:async()=>assert.fail("unexpected creation"),kickWorker:async()=>assert.fail("unexpected dispatch")});
 assert.equal((await handler({path:"/charges",httpMethod:"POST"})).statusCode,401);
});
test("cloud readiness requires administrator authorization before inspecting dependencies",async()=>{
 for(const admin of [false,true]) {
  let checked=false;
  const handler=createPaymentReportsHandler({authenticatePayment:async()=>"merchant",
   assertPaymentAdmin:()=>{if(!admin)throw new PaymentError("forbidden",403);},
   runPaymentPreflight:async({userId})=>{assert.equal(userId,"merchant");checked=true;return {ready:true,readOnly:true};}});
  const result=await handler({path:"/payment-reports/readiness",httpMethod:"GET"});
  assert.equal(result.statusCode,admin?200:403);assert.equal(checked,admin);
 }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { quoteCharge, decimalUnits, unitsDecimal, verifyWebhook, validateOrder, orderBody, publicCharge } from "../netlify/functions/lib/paymentCore.js";
import { settlePayout } from "../netlify/functions/lib/paymentWorker.js";
import { validateRound,CHAINLINK_USD_ARS_HEARTBEAT_SECONDS } from "../src/priceFeed.js";
import { networkConfig } from "../src/network.js";
import { internalAuthorized, paymentSettings } from "../netlify/functions/lib/paymentRuntime.js";
import { verifySeller } from "../netlify/functions/lib/mercadopago.js";

test("0.5% fee is deducted from ARS; delivered USDC rounds down to six decimals", () => {
  assert.deepEqual(quoteCharge("10000","1650"),{amountCents:"1000000",feeCents:"5000",usdcRaw:"6030303",rate:"1650"});
  assert.equal(quoteCharge("1.00","1").feeCents,"1"); // half-cent rounds up
  assert.equal(unitsDecimal("6030303",6),"6.030303");
});
test("invalid, excessive and below-minimum amounts cannot create a charge", () => {
  for(const value of ["-1","0","NaN","Infinity","1e3","1.001","1000000.01"," 20","20,5"]) assert.throws(()=>quoteCharge(value,"1650"));
  for(const rate of ["0","-1","invalid"]) assert.throws(()=>quoteCharge("10000",rate));
  assert.throws(()=>quoteCharge("1","1650"));
  assert.throws(()=>quoteCharge("10000","1650",100));
});
test("fixed provider body contains the exact authorized cents and reference",()=>{
  const charge={amount_cents:"1500",external_reference:"mp_abc",pos_id:"POS1"};
  const body=orderBody(charge);
  assert.equal(body.total_amount,"15.00");assert.equal(body.transactions.payments[0].amount,"15.00");
  assert.equal(body.config.qr.mode,"dynamic");assert.equal(body.expiration_time,"PT15M");
  assert.ok(!("notification_url" in body));
  assert.equal(JSON.stringify(orderBody(charge)),JSON.stringify(body));
});

const secret="test-only-webhook-secret";
function notification(overrides={}) {
  const id="ORD01ABCDE",ts="1742505638683",requestId="req-1";
  const digest=createHmac("sha256",secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
  return {queryStringParameters:{"data.id":id,type:"order"},headers:{"x-request-id":requestId,"x-signature":`ts=${ts},v1=${digest}`},
    body:JSON.stringify({type:"order",action:"order.processed",data:{id}}),...overrides};
}
test("Orders QR HMAC validates lowercased ID and case-insensitive headers",()=>{
  const event=notification();assert.equal(verifyWebhook(event,secret).id,"ORD01ABCDE");
  event.headers={"X-Request-Id":event.headers["x-request-id"],"X-Signature":event.headers["x-signature"]};
  assert.equal(verifyWebhook(event,secret).id,"ORD01ABCDE");
  event.isBase64Encoded=true;event.body=Buffer.from(event.body).toString("base64");assert.ok(verifyWebhook(event,secret));
});
test("invalid or absent signature, malformed body and mismatched IDs fail closed",()=>{
  assert.throws(()=>verifyWebhook(notification(),""));
  assert.throws(()=>verifyWebhook(notification(),"wrong"));
  assert.throws(()=>verifyWebhook(notification({headers:{}}),secret));
  assert.throws(()=>verifyWebhook(notification({body:"{"}),secret));
  assert.throws(()=>verifyWebhook(notification({body:JSON.stringify({type:"order",data:{id:"ORDOTHER"}})}),secret));
  const event=notification();event.headers["x-signature"]+=",ts=1";assert.throws(()=>verifyWebhook(event,secret));
});
test("deduplication uses signed fields, never unsigned body or request ID",()=>{
  const event=notification(),key=verifyWebhook(event,secret).key;
  event.body=JSON.stringify({type:"order",data:{id:"ORD01ABCDE"},action:"attacker-controlled",date_created:"different"});
  assert.equal(verifyWebhook(event,secret).key,key);
});

function charge() {return {id:"internal",order_id:"ORD01ABCDE",seller_id:"123",pos_id:"POS1",environment:"production",
  external_reference:"mp_abc",amount_cents:"1500",payment_id:"PAY1",fee_cents:"8",fee_bps:50,usdc_raw:"10000",fx_rate:"1492"};}
function provider() {return {id:"ORD01ABCDE",user_id:"123",type:"qr",currency:"ARS",external_reference:"mp_abc",total_amount:"15.00",total_paid_amount:"15.00",
  status:"processed",status_detail:"accredited",config:{qr:{external_pos_id:"POS1"}},
  transactions:{payments:[{id:"PAY1",amount:"15.00",paid_amount:"15.00",status:"processed",status_detail:"accredited"}]}};}
test("only an accredited provider order and transaction can authorize delivery",()=>{
  assert.equal(validateOrder(provider(),charge()).paid,true);
  for(const status of ["created","expired","canceled"]) {const order=provider();order.status=status;assert.equal(validateOrder(order,charge()).paid,false);}
});
test("identity, seller, currency, POS, amount and transaction mismatches prevent delivery",()=>{
  for(const changes of [{id:"ORDOTHER"},{user_id:"456"},{currency:"USD"},{external_reference:"other"},{total_amount:"14.00"},{total_paid_amount:"14.00"},{live_mode:false},
    {config:{qr:{external_pos_id:"OTHER"}}}]) assert.throws(()=>validateOrder({...provider(),...changes},charge()));
  for(const changes of [{id:"PAY2"},{amount:"14.00"},{paid_amount:"14.00"},{status:"created"}]) {
    const order=provider();Object.assign(order.transactions.payments[0],changes);assert.throws(()=>validateOrder(order,charge()));
  }
});
test("partial or full refund signals stop delivery",()=>{
  const order=provider();order.status="refunded";assert.equal(validateOrder(order,charge()).refunded,true);
  order.status="partially_refunded";assert.equal(validateOrder(order,charge()).refunded,true);
  order.status="processed";order.transactions.refunds=[{id:"refund"}];assert.equal(validateOrder(order,charge()).refunded,true);
});
test("public response preserves QR exactly and never leaks signed wire or credentials",()=>{
  const c={...charge(),qr_data:"000201...EXACT-MP-QR",signed_wire:"private",idempotency_key:"private"};
  const result=publicCharge(c);assert.equal(result.qrData,c.qr_data);assert.equal(result.signed_wire,undefined);assert.equal(result.idempotency_key,undefined);
});
test("cancel requested hides the payable state until provider confirmation",()=>{
  assert.equal(publicCharge({...charge(),status:"awaiting_payment",cancel_requested:true}).status,"cancel_pending");
  assert.equal(publicCharge({...charge(),status:"paid",cancel_requested:true}).status,"paid");
});
test("a tagged Mercado Pago test seller cannot authorize production charges",async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({id:123,site_id:"MLA",tags:["test_user"]})});
  try { await assert.rejects(()=>verifySeller({token:"test-only-token",seller:"123",pos:"POS",environment:"production"}),/seller_is_test_account/); }
  finally {globalThis.fetch=before;}
});

test("Chainlink round must be positive, correct pair, fresh and complete",()=>{
  const round={answer:165000000000n,decimals:8,updatedAt:1000n,roundId:20n,answeredInRound:20n,description:"USD / ARS"};
  assert.equal(validateRound(round,300,1100).rate,"1650.0");
  for(const change of [{answer:0n},{updatedAt:0n},{updatedAt:1101n},{updatedAt:700n},{answeredInRound:19n},{description:"ARS / USD"}]) assert.throws(()=>validateRound({...round,...change},300,1100));
  assert.throws(()=>validateRound(round,NaN,1100));
});
test("network mint and chain configuration distinguish mainnet from testnet",()=>{
  assert.equal(networkConfig("mainnet-beta").mint,"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(networkConfig("mainnet-beta").chain,"solana:mainnet");
  assert.notEqual(networkConfig("mainnet-beta").mint,networkConfig("devnet").mint);
  assert.throws(()=>networkConfig("unknown"));
});

test("daily-feed metadata does not override the configured quote age limit",()=>{
  const now=200000,updatedAt=BigInt(now-10800),round={answer:165000000000n,decimals:8,updatedAt,
    roundId:20n,answeredInRound:20n,description:"USD / ARS"};
  assert.throws(()=>validateRound(round,120,now),error=>{
    assert.equal(error.message,"chainlink_invalid_or_stale");
    assert.deepEqual(error.quoteAge,{updatedAt:Number(updatedAt),ageSeconds:10800,maxAgeSeconds:120});return true;
  });
  assert.equal(validateRound(round,CHAINLINK_USD_ARS_HEARTBEAT_SECONDS,now).updatedAt,Number(updatedAt));
  assert.throws(()=>validateRound({...round,updatedAt:BigInt(now-86401)},86400,now),/chainlink_invalid_or_stale/);
  assert.throws(()=>validateRound(round,undefined,now),/chainlink_max_age_not_configured/);
});
test("internal worker requests require a strong exact secret",()=>{
  const before=process.env.INTERNAL_WORKER_SECRET;process.env.INTERNAL_WORKER_SECRET="a".repeat(64);
  try {assert.equal(internalAuthorized({headers:{"x-worker-secret":"a".repeat(64)}}),true);assert.equal(internalAuthorized({headers:{}}),false);}
  finally {if(before===undefined)delete process.env.INTERNAL_WORKER_SECRET;else process.env.INTERNAL_WORKER_SECRET=before;}
});
test("production Mercado Pago cannot run on a devnet deployment",()=>{
  const before=process.env.MP_ENVIRONMENT;process.env.MP_ENVIRONMENT="production";
  try {assert.throws(()=>paymentSettings(process.env,networkConfig("devnet")),/payment_network_mismatch/);}
  finally {if(before===undefined)delete process.env.MP_ENVIRONMENT;else process.env.MP_ENVIRONMENT=before;}
});

function payoutFixture() {
  const events=[],c={...charge(),wallet_address:"wallet",external_reference:"ref"};
  const adapters={save:async(fields)=>events.push(["save",fields]),prepare:async()=>({hash:"signature",wire:"signed-wire",lastValidBlockHeight:"100",memo:"memo"}),
    rpc:async(method,params)=>{events.push([method,params]);if(method==="getSignatureStatuses")return {value:[null]};if(method==="getBlockHeight")return 90;return "signature";}};
  return {events,c,adapters};
}
test("signed wire is durably saved before any transmit",async()=>{
  const {events,c,adapters}=payoutFixture();await settlePayout(null,c,adapters);
  assert.equal(events[0][0],"save");assert.equal(events[0][1].signed_wire,"signed-wire");
  assert.equal(events.find(([method])=>method==="sendTransaction")[1][0],"signed-wire");
});
test("database failure before durable save cannot transmit money",async()=>{
  const {events,c,adapters}=payoutFixture();adapters.save=async()=>{throw new Error("database unavailable");};
  await assert.rejects(()=>settlePayout(null,c,adapters));assert.equal(events.length,0);
});
test("transmit timeout preserves signature and retries the identical wire",async()=>{
  const {events,c,adapters}=payoutFixture();const rpc=adapters.rpc;
  adapters.rpc=async(method,params)=>{if(method==="sendTransaction"){events.push([method,params]);throw new Error("timeout");}return rpc(method,params);};
  await assert.rejects(()=>settlePayout(null,c,adapters));
  adapters.prepare=async()=>{throw new Error("must not sign again");};adapters.rpc=rpc;
  await settlePayout(null,c,adapters);
  assert.deepEqual(events.filter(([method])=>method==="sendTransaction").map(([,params])=>params[0]),["signed-wire","signed-wire"]);
});
test("confirmed is pending; only finalized completes delivery",async()=>{
  for(const level of ["confirmed","finalized"]){const {events,c,adapters}=payoutFixture();c.signature="signature";
    adapters.rpc=async()=>({value:[{confirmationStatus:level,slot:42}]});
    const result=await settlePayout(null,c,adapters);assert.equal(Boolean(result.finalized),level==="finalized");assert.equal(events.length,0);}
});
test("failed or expired ambiguous signatures require review instead of a second transfer",async()=>{
  for(const failed of [true,false]) {const {events,c,adapters}=payoutFixture();c.signature="signature";c.last_valid_block_height="80";
    const rpc=adapters.rpc;adapters.rpc=async(method,params)=>method==="getSignatureStatuses" && failed ? {value:[{err:{InstructionError:[1,"failed"]}}]} : rpc(method,params);
    const result=await settlePayout(null,c,adapters);assert.ok(result.review);assert.equal(events.some(([m])=>m==="sendTransaction"),false);}
});

test("paused payments still observe finalization but cannot sign or broadcast",async()=>{
 const {events,c,adapters}=payoutFixture();adapters.allowBroadcast=false;
 assert.deepEqual(await settlePayout(null,c,adapters),{pending:true});assert.equal(events.length,0);
 Object.assign(c,{signature:"signature",signed_wire:"signed-wire",last_valid_block_height:"100"});
 assert.deepEqual(await settlePayout(null,c,adapters),{pending:true});
 assert.equal(events.some(([method])=>method==="sendTransaction"),false);
 adapters.rpc=async()=>({value:[{confirmationStatus:"finalized",slot:42}]});
 assert.deepEqual(await settlePayout(null,c,adapters),{finalized:true,block:42});
});

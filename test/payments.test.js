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
test("public response preserves QR exactly and never leaks the signed transaction or credentials",()=>{
  const c={...charge(),qr_data:"000201...EXACT-MP-QR",tx_hash:"0xhash",signed_tx:"0x02private",nonce:"3",idempotency_key:"private"};
  const result=publicCharge(c);assert.equal(result.qrData,c.qr_data);assert.equal(result.txHash,"0xhash");
  assert.ok(!JSON.stringify(result).includes("private"));assert.equal(result.nonce,undefined);
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

test("Chainlink round must be positive, correct pair, complete and have a valid timestamp",()=>{
  const round={answer:165000000000n,decimals:8,updatedAt:1000n,roundId:20n,answeredInRound:20n,description:"USD / ARS"};
  assert.equal(validateRound(round,90000,1100).rate,"1650.0");
  for(const change of [{answer:0n},{updatedAt:0n},{updatedAt:1101n},{answeredInRound:19n},{description:"ARS / USD"}])
    assert.throws(()=>validateRound({...round,...change},90000,1100),/chainlink_invalid_round/);
  for(const maxAge of [undefined,0,-1,1.5,NaN,Infinity])
    assert.throws(()=>validateRound(round,maxAge,1100),/chainlink_max_age_not_configured/);
});
test("network configuration targets Arc Mainnet, its USDC and its Memo contract",()=>{
  const network=networkConfig("mainnet");
  assert.equal(network.chainId,5042);assert.equal(network.network,"arc-mainnet");
  assert.equal(network.usdc,"0x3600000000000000000000000000000000000000");
  assert.equal(network.memo,"0x5294E9927c3306DcBaDb03fe70b92e01cCede505");
  assert.equal(network.minFeePerGasWei,20_000_000_000n);
  assert.throws(()=>networkConfig("unknown"));
});

test("quotes older than CHAINLINK_MAX_AGE_SECONDS (25 h) are rejected; a round at the limit is accepted",()=>{
  const now=2000000,maxAge=90000,round=(age)=>({answer:165000000000n,decimals:8,updatedAt:BigInt(now-age),
    roundId:20n,answeredInRound:20n,description:"USD / ARS"});
  // A normal daily update (heartbeat) and a round exactly at the 25 h limit are valid.
  assert.equal(validateRound(round(CHAINLINK_USD_ARS_HEARTBEAT_SECONDS),maxAge,now).rate,"1650.0");
  assert.equal(quoteCharge("10000",validateRound(round(maxAge),maxAge,now).rate).usdcRaw,"6030303");
  // One second past the limit, and a ten-day-old round, cannot price a charge.
  for(const age of [maxAge+1,10*CHAINLINK_USD_ARS_HEARTBEAT_SECONDS])
    assert.throws(()=>validateRound(round(age),maxAge,now),error=>{
      assert.equal(error.message,"chainlink_stale_round");
      assert.deepEqual(error.quoteAge,{updatedAt:now-age,ageSeconds:age,maxAgeSeconds:maxAge});return true;
    });
});
test("internal worker requests require a strong exact secret",()=>{
  const before=process.env.INTERNAL_WORKER_SECRET;process.env.INTERNAL_WORKER_SECRET="a".repeat(64);
  try {assert.equal(internalAuthorized({headers:{"x-worker-secret":"a".repeat(64)}}),true);assert.equal(internalAuthorized({headers:{}}),false);}
  finally {if(before===undefined)delete process.env.INTERNAL_WORKER_SECRET;else process.env.INTERNAL_WORKER_SECRET=before;}
});
test("payment settings require ARC_RPC, and sandbox Mercado Pago never releases real USDC on Arc Mainnet",()=>{
  const env={MP_ENVIRONMENT:"production",MP_ACCESS_TOKEN:"test-token",MP_USER_ID:"123",
    MP_WEBHOOK_SECRET:"test-webhook",ARC_RPC:"https://rpc.example.invalid",INTERNAL_WORKER_SECRET:"x".repeat(32)};
  const settings=paymentSettings(env,networkConfig("mainnet"));
  assert.equal(settings.environment,"production");
  assert.equal(settings.network,"arc-mainnet");
  for(const environment of ["test",undefined])
    assert.throws(()=>paymentSettings({...env,MP_ENVIRONMENT:environment},networkConfig("mainnet")),/mp_test_requires_test_network/);
  assert.equal(paymentSettings({...env,MP_ENVIRONMENT:"test"},{...networkConfig("mainnet"),testnet:true}).environment,"test");
  assert.throws(()=>paymentSettings({...env,MP_ACCESS_TOKEN:""},networkConfig("mainnet")),/missing_mp_access_token/);
  assert.throws(()=>paymentSettings({...env,ARC_RPC:""},networkConfig("mainnet")),/missing_arc_rpc/);
});

// Treasury nonce assignment takes a session advisory lock; this fake database only records it.
const lockDb={query:async()=>({rows:[]})};
function payoutFixture() {
  const events=[],c={...charge(),network:"arc-mainnet",wallet_address:"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    treasury_address:"0x8ba1f109551bD432803012645Ac136ddd64DBA72",external_reference:"ref"};
  const state={receipt:null,latest:0};
  const adapters={save:async(fields)=>events.push(["save",fields]),nextNonce:async()=>4n,
    prepare:async({nonce})=>({hash:"0xhash",signedTx:"0x02signed",nonce:String(nonce),memo:"memo"}),
    rpc:async(method,params)=>{events.push([method,params]);
      if(method==="eth_getTransactionReceipt")return state.receipt;
      if(method==="eth_getTransactionCount")return `0x${(4+state.latest).toString(16)}`;
      if(method==="eth_sendRawTransaction")return "0xhash";
      assert.fail(`unexpected RPC: ${method}`);
    }};
  return {events,c,adapters,state};
}
const sends=events=>events.filter(([method])=>method==="eth_sendRawTransaction").map(([,params])=>params[0]);
test("the signed transaction and its nonce are durably saved before any transmit",async()=>{
  const {events,c,adapters}=payoutFixture();assert.deepEqual(await settlePayout(lockDb,c,adapters),{pending:true});
  assert.equal(events[0][0],"save");
  assert.deepEqual(events[0][1],{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"4",payout_memo:"memo",status:"delivery_pending"});
  assert.deepEqual(sends(events),["0x02signed"]);
  assert.deepEqual(events.at(-1),["save",{status:"broadcasting"}]);
});
test("database failure before durable save cannot transmit money",async()=>{
  const {events,c,adapters}=payoutFixture();adapters.save=async()=>{throw new Error("database unavailable");};
  await assert.rejects(()=>settlePayout(lockDb,c,adapters));assert.equal(events.length,0);
});
test("transmit timeout preserves the transaction and retries the identical bytes",async()=>{
  const {events,c,adapters}=payoutFixture();const rpc=adapters.rpc;
  adapters.rpc=async(method,params)=>{if(method==="eth_sendRawTransaction"){events.push([method,params]);throw new Error("timeout");}return rpc(method,params);};
  await assert.rejects(()=>settlePayout(lockDb,c,adapters));
  adapters.prepare=async()=>{throw new Error("must not sign again");};adapters.rpc=rpc;
  await settlePayout(lockDb,c,adapters);
  assert.deepEqual(sends(events),["0x02signed","0x02signed"]);
});
test("a successful receipt is final and completes delivery without transmitting again",async()=>{
  const {events,c,adapters,state}=payoutFixture();Object.assign(c,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"4"});
  state.receipt={status:"0x1",blockNumber:"0x2a"};
  assert.deepEqual(await settlePayout(lockDb,c,adapters),{finalized:true,block:"42"});
  assert.deepEqual(sends(events),[]);assert.equal(events.some(([kind])=>kind==="save"),false);
});
test("a reverted receipt or a nonce consumed elsewhere requires review instead of a second transfer",async()=>{
  for(const [setup,review] of [[state=>{state.receipt={status:"0x0",blockNumber:"0x2a"};},"arc_transaction_failed"],
    [state=>{state.latest=1;},"arc_payout_not_landed"]]) {
    const {events,c,adapters,state}=payoutFixture();Object.assign(c,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"4"});setup(state);
    adapters.prepare=async()=>assert.fail("must not sign again");
    assert.deepEqual(await settlePayout(lockDb,c,adapters),{review});assert.deepEqual(sends(events),[]);
  }
});

test("paused payments still observe finalization but cannot sign or broadcast",async()=>{
 const {events,c,adapters,state}=payoutFixture();adapters.allowBroadcast=false;
 assert.deepEqual(await settlePayout(lockDb,c,adapters),{pending:true});assert.equal(events.length,0);
 Object.assign(c,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"4"});
 assert.deepEqual(await settlePayout(lockDb,c,adapters),{pending:true});
 assert.deepEqual(sends(events),[]);
 state.receipt={status:"0x1",blockNumber:"0x2a"};
 assert.deepEqual(await settlePayout(lockDb,c,adapters),{finalized:true,block:"42"});
});

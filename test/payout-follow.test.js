import test from "node:test";
import assert from "node:assert/strict";
import {followPayout,runPaymentWorker,PAYOUT_FOLLOW_MS,PAYOUT_POLL_INTERVAL_MS} from "../netlify/functions/lib/paymentWorker.js";
import {PaymentError} from "../netlify/functions/lib/paymentCore.js";

function fixture(statuses=[null,null,{confirmationStatus:"confirmed",slot:42},{confirmationStatus:"finalized",slot:42}]) {
  const charge={id:"id",wallet_address:"wallet",usdc_raw:"10000",amount_cents:"1500",fx_rate:"1500",external_reference:"ref"};
  const saves=[],sends=[],waits=[];let time=0,preparations=0,lookups=0;
  const adapters={now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},
    prepare:async()=>{preparations++;return {hash:"signature",wire:"same-wire",lastValidBlockHeight:"100",memo:"memo"};},
    save:async fields=>saves.push(fields),
    rpc:async(method,params)=>{
      if(method==="getSignatureStatuses")return {value:[statuses[Math.min(lookups++,statuses.length-1)]]};
      if(method==="getBlockHeight")return 90;
      if(method==="sendTransaction"){sends.push(params);return "signature";}
      assert.fail(`unexpected RPC: ${method}`);
    }};
  return {charge,adapters,saves,sends,waits,preparations:()=>preparations,time:()=>time};
}

test("worker follows immediately, rebroadcasts identical bytes, persists confirmed and waits for finalized",async()=>{
  const f=fixture(),result=await followPayout(null,f.charge,f.adapters);
  assert.deepEqual(result,{finalized:true,block:42});
  assert.equal(f.preparations(),1);assert.equal(f.charge.signature,"signature");
  assert.deepEqual(f.sends.map(p=>p[0]),["same-wire","same-wire"]);
  assert.ok(f.sends.every(p=>p[1].maxRetries===undefined && p[1].preflightCommitment==="confirmed"));
  assert.deepEqual(f.waits,[2500,2500,2500]);
  assert.equal(f.saves[0].signed_wire,"same-wire");
  assert.equal(f.saves.filter(s=>s.status==="confirmed").length,1);
});

test("a transport timeout after broadcast retries the saved wire without signing another transaction",async()=>{
  const f=fixture([null,null,{confirmationStatus:"finalized",slot:42}]),rpc=f.adapters.rpc;let first=true;
  f.adapters.rpc=async(method,params)=>{
    const result=await rpc(method,params);
    if(method==="sendTransaction" && first){first=false;throw new PaymentError("solana_rpc_timeout");}
    return result;
  };
  assert.equal((await followPayout(null,f.charge,f.adapters)).finalized,true);
  assert.equal(f.preparations(),1);assert.deepEqual(f.sends.map(p=>p[0]),["same-wire","same-wire"]);
});

test("following never transmits before its signed wire is durably saved",async()=>{
  const f=fixture();f.adapters.save=async()=>{throw new Error("database unavailable");};
  await assert.rejects(()=>followPayout(null,f.charge,f.adapters),/database unavailable/);
  assert.equal(f.sends.length,0);assert.equal(f.waits.length,0);
});

test("expiry stops resubmission and does not construct a replacement",async()=>{
  const f=fixture([null]),rpc=f.adapters.rpc;let checks=0;
  f.adapters.rpc=(method,params)=>method==="getBlockHeight"?Promise.resolve(checks++===0?90:101):rpc(method,params);
  assert.deepEqual(await followPayout(null,f.charge,f.adapters),{review:"solana_expired_requires_review"});
  assert.equal(f.preparations(),1);assert.equal(f.sends.length,1);
});

test("a processed transaction can finalize after expiry without being misclassified as missing",async()=>{
  const f=fixture([{confirmationStatus:"processed",slot:42},{confirmationStatus:"confirmed",slot:42},{confirmationStatus:"finalized",slot:42}]);
  Object.assign(f.charge,{signature:"signature",signed_wire:"same-wire",last_valid_block_height:"80"});
  assert.equal((await followPayout(null,f.charge,f.adapters)).finalized,true);
  assert.equal(f.sends.length,0);assert.equal(f.preparations(),0);
});

test("observation-only recovery never signs or rebroadcasts",async()=>{
  const f=fixture([null,{confirmationStatus:"finalized",slot:42}]);f.adapters.allowBroadcast=false;
  assert.deepEqual(await followPayout(null,f.charge,f.adapters),{pending:true});
  Object.assign(f.charge,{signature:"signature",signed_wire:"same-wire",last_valid_block_height:"100"});
  assert.equal((await followPayout(null,f.charge,f.adapters)).finalized,true);
  assert.equal(f.preparations(),0);assert.equal(f.sends.length,0);
});

test("tracking has a bounded lifetime and respects the background worker deadline",async()=>{
  for(const deadline of [5001,undefined]){
    const f=fixture();Object.assign(f.charge,{signature:"signature"});f.adapters.deadline=deadline;
    f.adapters.settle=async()=>({pending:true});
    assert.deepEqual(await followPayout(null,f.charge,f.adapters),{pending:true});
    assert.equal(f.time(),deadline??PAYOUT_FOLLOW_MS);
    assert.ok(f.waits.every(ms=>ms>0 && ms<=PAYOUT_POLL_INTERVAL_MS));
  }
});

test("following stops on on-chain failure instead of transmitting again",async()=>{
  const f=fixture([{err:{InstructionError:[1,"failed"]}}]);
  Object.assign(f.charge,{signature:"signature",signed_wire:"same-wire",last_valid_block_height:"100"});
  assert.deepEqual(await followPayout(null,f.charge,f.adapters),{review:"solana_transaction_failed"});
  assert.equal(f.sends.length,0);assert.equal(f.waits.length,0);
});

test("an elapsed worker budget never starts signing or transmitting a new payout",async()=>{
  const f=fixture();f.adapters.deadline=0;
  assert.deepEqual(await followPayout(null,f.charge,f.adapters),{pending:true});
  assert.equal(f.preparations(),0);assert.equal(f.sends.length,0);
});

test("worker tracks several deliveries concurrently with at most three advisory-lock sessions",async()=>{
  const rows=Array.from({length:7},(_,i)=>({id:String(i)}));let active=0,peak=0;const processed=[];
  const db={query:async sql=>sql.includes("FROM payment_inbox")?{rows:[],rowCount:0}:{rows,rowCount:rows.length}};
  const result=await runPaymentWorker({},600000,{db,processCharge:async(id,settings,{deadline})=>{
    assert.ok(deadline>Date.now());active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));processed.push(id);active--;return true;
  }});
  assert.equal(peak,3);assert.equal(new Set(processed).size,7);assert.equal(result.checked,7);
});

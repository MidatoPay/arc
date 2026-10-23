import test from "node:test";
import assert from "node:assert/strict";
import {followPayout,runPaymentWorker,nextTreasuryNonce,PAYOUT_FOLLOW_MS,PAYOUT_POLL_INTERVAL_MS} from "../netlify/functions/lib/paymentWorker.js";
import {PaymentError} from "../netlify/functions/lib/paymentCore.js";

const TREASURY="0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const FINAL={status:"0x1",blockNumber:"0x2a"};

function fixture(receipts=[null,null,FINAL]) {
  const charge={id:"id",wallet_address:"0x0000000000000000000000000000000000000001",treasury_address:TREASURY,network:"arc-mainnet",
    usdc_raw:"10000",amount_cents:"1500",fx_rate:"1500",external_reference:"ref"};
  const saves=[],sends=[],waits=[],locks=[];let time=0,preparations=0,lookups=0,latestNonce=0;
  // settlePayout serializes nonce assignment with a session advisory lock.
  const db={query:async(sql,params)=>{locks.push([sql.includes("unlock")?"unlock":"lock",params[0]]);return {rows:[]};}};
  const adapters={now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},
    nextNonce:async()=>0n,
    prepare:async({nonce})=>{preparations++;return {hash:"0xhash",signedTx:"0x02signed",nonce:String(nonce),memo:"memo"};},
    save:async fields=>saves.push(fields),
    rpc:async(method,params)=>{
      if(method==="eth_getTransactionReceipt")return receipts[Math.min(lookups++,receipts.length-1)];
      if(method==="eth_getTransactionCount")return `0x${latestNonce.toString(16)}`;
      if(method==="eth_sendRawTransaction"){sends.push(params);return "0xhash";}
      assert.fail(`unexpected RPC: ${method}`);
    }};
  return {charge,db,adapters,saves,sends,waits,locks,preparations:()=>preparations,time:()=>time,setNonce:n=>{latestNonce=n;}};
}

test("worker signs once under the nonce lock, rebroadcasts identical bytes and stops at the final receipt",async()=>{
  const f=fixture(),result=await followPayout(f.db,f.charge,f.adapters);
  assert.deepEqual(result,{finalized:true,block:"42"});
  assert.equal(f.preparations(),1);assert.equal(f.charge.tx_hash,"0xhash");
  assert.deepEqual(f.sends.map(p=>p[0]),["0x02signed","0x02signed"]);
  assert.deepEqual(f.waits,[2500,2500]);
  assert.equal(f.saves[0].signed_tx,"0x02signed");assert.equal(f.saves[0].nonce,"0");
  assert.equal(f.saves.filter(s=>s.status==="broadcasting").length,1);
  assert.deepEqual(f.locks,[["lock",`treasury-nonce:${TREASURY}`],["unlock",`treasury-nonce:${TREASURY}`]]);
});

test("a transport timeout after broadcast retries the saved transaction without signing another one",async()=>{
  const f=fixture(),rpc=f.adapters.rpc;let first=true;
  f.adapters.rpc=async(method,params)=>{
    const result=await rpc(method,params);
    if(method==="eth_sendRawTransaction" && first){first=false;throw new PaymentError("arc_rpc_timeout");}
    return result;
  };
  assert.equal((await followPayout(f.db,f.charge,f.adapters)).finalized,true);
  assert.equal(f.preparations(),1);assert.deepEqual(f.sends.map(p=>p[0]),["0x02signed","0x02signed"]);
});

test("following never transmits before its signed transaction is durably saved",async()=>{
  const f=fixture();f.adapters.save=async()=>{throw new Error("database unavailable");};
  await assert.rejects(()=>followPayout(f.db,f.charge,f.adapters),/database unavailable/);
  assert.equal(f.sends.length,0);assert.equal(f.waits.length,0);
  assert.deepEqual(f.locks.map(l=>l[0]),["lock","unlock"]);
});

test("a nonce consumed by another transaction stops resubmission and does not construct a replacement",async()=>{
  const f=fixture([null]),rpc=f.adapters.rpc;let checks=0;
  f.adapters.rpc=(method,params)=>{if(method==="eth_getTransactionCount")f.setNonce(checks++===0?0:1);return rpc(method,params);};
  assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{review:"arc_payout_not_landed"});
  assert.equal(f.preparations(),1);assert.equal(f.sends.length,1);
});

test("a receipt is final even after the treasury nonce has advanced",async()=>{
  const f=fixture([FINAL]);f.setNonce(5);
  Object.assign(f.charge,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"0",status:"broadcasting"});
  assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{finalized:true,block:"42"});
  assert.equal(f.sends.length,0);assert.equal(f.preparations(),0);assert.equal(f.locks.length,0);
});

test("observation-only recovery never signs or rebroadcasts",async()=>{
  const f=fixture([null,FINAL]);f.adapters.allowBroadcast=false;
  assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{pending:true});
  Object.assign(f.charge,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"0"});
  assert.equal((await followPayout(f.db,f.charge,f.adapters)).finalized,true);
  assert.equal(f.preparations(),0);assert.equal(f.sends.length,0);assert.equal(f.locks.length,0);
});

test("tracking has a bounded lifetime and respects the background worker deadline",async()=>{
  for(const deadline of [5001,undefined]){
    const f=fixture();Object.assign(f.charge,{tx_hash:"0xhash"});f.adapters.deadline=deadline;
    f.adapters.settle=async()=>({pending:true});
    assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{pending:true});
    assert.equal(f.time(),deadline??PAYOUT_FOLLOW_MS);
    assert.ok(f.waits.every(ms=>ms>0 && ms<=PAYOUT_POLL_INTERVAL_MS));
  }
});

test("following stops on a reverted receipt instead of transmitting again",async()=>{
  const f=fixture([{status:"0x0",blockNumber:"0x2a"}]);
  Object.assign(f.charge,{tx_hash:"0xhash",signed_tx:"0x02signed",nonce:"0"});
  assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{review:"arc_transaction_failed"});
  assert.equal(f.sends.length,0);assert.equal(f.waits.length,0);
});

test("an elapsed worker budget never starts signing or transmitting a new payout",async()=>{
  const f=fixture();f.adapters.deadline=0;
  assert.deepEqual(await followPayout(f.db,f.charge,f.adapters),{pending:true});
  assert.equal(f.preparations(),0);assert.equal(f.sends.length,0);
});

test("the next treasury nonce never reuses the chain's pending count or a saved payout nonce",async()=>{
  const db=saved=>({query:async(sql,params)=>{
    assert.match(sql,/MAX\(nonce\)/);assert.deepEqual(params,[TREASURY,"arc-mainnet"]);
    return {rows:[{nonce:saved}]};
  }});
  const rpc=count=>async(method,params)=>{
    assert.equal(method,"eth_getTransactionCount");assert.deepEqual(params,[TREASURY,"pending"]);return `0x${count.toString(16)}`;
  };
  assert.equal(await nextTreasuryNonce(db(null),TREASURY,"arc-mainnet",rpc(3)),3n);
  assert.equal(await nextTreasuryNonce(db("5"),TREASURY,"arc-mainnet",rpc(3)),6n);
  assert.equal(await nextTreasuryNonce(db("5"),TREASURY,"arc-mainnet",rpc(9)),9n);
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

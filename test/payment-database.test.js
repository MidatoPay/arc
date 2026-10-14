import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createCharge, getChargeAttempt, ensureOrder, incident, releaseReservation } from "../netlify/functions/lib/paymentService.js";
import { finalizeDelivery } from "../netlify/functions/lib/paymentWorker.js";
import { reportFilters, listReportOperations, reportSummary, listOwnCharges } from "../netlify/functions/lib/paymentReporting.js";

test("PostgreSQL migration, charge creation, reservations and single ledger effect", async (t) => {
  const engine=new PGlite();await engine.waitReady;
  t.after(()=>engine.close());
  // gen_random_uuid is built into PostgreSQL; pgcrypto extension isn't needed by this schema in PGlite.
  const base=(await readFile(new URL("../db/schema.sql",import.meta.url),"utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;","");
  const migration=await readFile(new URL("../db/migrations/20261013_mercadopago.sql",import.meta.url),"utf8");
  await engine.exec(base);
  await engine.query("INSERT INTO transactions(user_id,hash,kind,direction,who,amt,fx_rate,ars) VALUES('legacy','same-hash','pay','out','contact',1,1650,1650)");
  await engine.exec(migration);await engine.exec(migration);
  const commissionMigration=await readFile(new URL("../db/migrations/20261013_commission_history.sql",import.meta.url),"utf8");
  await engine.exec(commissionMigration);await engine.exec(commissionMigration);
  const query=async(sql,params=[])=>{
    const result=await engine.query(sql,params);
    const rows=result.rows.map((row)=>Object.fromEntries(Object.entries(row).map(([k,v])=>
      [k,["amount_cents","fee_cents","usdc_raw","fx_rate","last_valid_block_height"].includes(k) && v!==null ? String(v):v])));
    return {...result,rows,rowCount:result.rows.length || result.affectedRows || 0};
  };
  let tail=Promise.resolve();
  const pool={query,connect:async()=>{
    const previous=tail;let release;tail=new Promise((r)=>{release=r;});await previous;
    return {query,release};
  }};
  const oldEnabled=process.env.PAYMENTS_ENABLED,oldRpc=process.env.ETH_RPC_URL;
  process.env.PAYMENTS_ENABLED="true";process.env.ETH_RPC_URL="https://example.invalid";
  t.after(()=>{if(oldEnabled===undefined)delete process.env.PAYMENTS_ENABLED;else process.env.PAYMENTS_ENABLED=oldEnabled;
    if(oldRpc===undefined)delete process.env.ETH_RPC_URL;else process.env.ETH_RPC_URL=oldRpc;});
  const wallet="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const settings={environment:"production",network:"mainnet-beta",seller:"123",pos:"POS1"};
  let liquidityRaw="100000000",verificationCalls=0;
  const adapters={db:pool,settings,assertWalletOwned:async(user)=>{if(user==="wrong")throw new Error("wallet_not_owned");},
    verifySeller:async()=>verificationCalls++,fetchQuote:async()=>({rate:"1650",roundId:"1",updatedAt:Math.floor(Date.now()/1000)}),
    getTreasuryAddress:async()=>wallet,treasuryLiquidity:async()=>({owner:wallet,raw:liquidityRaw,solLamports:"1000000000"})};
  const input={ars:"10000.00",wallet};let c;
  await t.test("migration retains devnet data and permits the same signature on mainnet",async()=>{
    const legacy=await query("SELECT network FROM transactions WHERE user_id='legacy'");assert.equal(legacy.rows[0].network,"devnet");
    await query("INSERT INTO transactions(user_id,network,hash,kind,direction,who,amt,fx_rate,ars) VALUES('legacy','mainnet-beta','same-hash','pay','out','contact',1,1650,1650)");
    assert.equal((await query("SELECT * FROM transactions WHERE user_id='legacy'")).rowCount,2);
  });
  await t.test("same intent across concurrent retries persists only one reservation",async()=>{
    const key=randomUUID();const result=await Promise.all([createCharge("u1",input,key,adapters),createCharge("u1",input,key,adapters)]);
    assert.equal(result[0].id,result[1].id);c=result[0];assert.equal(c.usdc_raw,"6030303");
    assert.equal((await query("SELECT * FROM charges WHERE user_id='u1'")).rowCount,1);
  });
  await t.test("retry after restart preserves key/body and rejects another user or changed amount",async()=>{
    const recovered=await createCharge("u1",input,c.idempotency_key,adapters);
    assert.deepEqual(recovered.order_body,c.order_body);
    await assert.rejects(()=>createCharge("u2",input,c.idempotency_key,adapters),/idempotency_conflict/);
    await assert.rejects(()=>createCharge("u1",{...input,ars:"20000"},c.idempotency_key,adapters),/idempotency_conflict/);
  });
  await t.test("wallet authorization fails before provider verification",async()=>{
    const before=verificationCalls;
    await assert.rejects(()=>createCharge("wrong",input,randomUUID(),adapters),/wallet_not_owned/);
    assert.equal(verificationCalls,before);
  });
  await t.test("attempt recovery is read-only and isolates merchant, environment and network",async()=>{
    assert.equal((await getChargeAttempt(c.idempotency_key,"u1",settings,pool)).id,c.id);
    assert.equal(await getChargeAttempt(c.idempotency_key,"u2",settings,pool),null);
    assert.equal(await getChargeAttempt(c.idempotency_key,"u1",{...settings,environment:"test"},pool),null);
    assert.equal(await getChargeAttempt(c.idempotency_key,"u1",{...settings,network:"devnet"},pool),null);
    assert.equal(await getChargeAttempt(randomUUID(),"u1",settings,pool),null);
    await assert.rejects(()=>getChargeAttempt("bad-key","u1",settings,pool),/invalid_idempotency_key/);
  });
  await t.test("pending reservations prevent spending the same USDC twice",async()=>{
    liquidityRaw="6030303";
    await assert.rejects(()=>createCharge("u3",input,randomUUID(),adapters),/insufficient_treasury/);
    assert.equal((await query("SELECT * FROM charges WHERE user_id='u3'")).rowCount,0);liquidityRaw="100000000";
  });
  await t.test("invalid amount fails before any Mercado Pago or quote request",async()=>{
    const before=verificationCalls;
    await assert.rejects(()=>createCharge("u1",{...input,ars:"-5"},randomUUID(),adapters),/invalid_amount/);
    assert.equal(verificationCalls,before);
  });
  await t.test("early webhook is retained before the provider response is stored",async()=>{
    await query("INSERT INTO payment_inbox(environment,event_key,order_id,payload) VALUES('production','event-1','ORD01ABCDE','{}')");
    await query("INSERT INTO payment_inbox(environment,event_key,order_id,payload) VALUES('production','event-1','ORD01ABCDE','{}') ON CONFLICT DO NOTHING");
    assert.equal((await query("SELECT * FROM payment_inbox WHERE processed_at IS NULL")).rowCount,1);
  });
  await t.test("creation saves exact QR and binds the verified provider order",async()=>{
    const received=[];
    const provider={id:"ORD01ABCDE",user_id:"123",type:"qr",currency:"ARS",external_reference:c.external_reference,total_amount:"10000.00",
      status:"created",status_detail:"created",config:{qr:{external_pos_id:"POS1"}},transactions:{payments:[{id:"PAY1",amount:"10000.00"}]}};
    const result=await ensureOrder({query},c,settings,{verifySeller:async()=>{},request:async(path,_settings,options)=>{
      received.push({path,options});return options?.method==="POST" ? {...provider,type_response:{qr_data:"EXACT-QR"}}:provider;
    }});
    assert.equal(result.qr_data,"EXACT-QR");assert.equal(result.status,"awaiting_payment");
    assert.equal(received[0].options.headers["X-Idempotency-Key"],c.idempotency_key);
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
  });
  await t.test("finalization and duplicate finalization insert one authoritative ledger movement",async()=>{
    c.signature="signature";c.payout_memo="memo";
    await query("UPDATE charges SET signature=$2,payout_memo=$3 WHERE id=$1",[c.id,c.signature,c.payout_memo]);
    await finalizeDelivery({query},c,42);await finalizeDelivery({query},c,42);
    assert.equal((await query("SELECT * FROM transactions WHERE charge_id=$1",[c.id])).rowCount,1);
    const entries=await query("SELECT * FROM commission_ledger WHERE charge_id=$1",[c.id]);
    assert.equal(entries.rowCount,1);assert.equal(String(entries.rows[0].fee_cents),"5000");
    const row=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];assert.equal(row.status,"delivered");assert.equal(row.reserved,false);
  });
  await t.test("refund after delivery creates one incident and blocks future charges",async()=>{
    await incident({query},c,"mercadopago_refund_after_payout");await incident({query},c,"mercadopago_refund_after_payout");
    assert.equal((await query("SELECT * FROM payment_incidents WHERE charge_id=$1",[c.id])).rowCount,1);
    await assert.rejects(()=>createCharge("u1",input,randomUUID(),adapters),/user_payment_review/);
  });
  await t.test("confirmed expiration releases the reservation without a ledger credit",async()=>{
    const pending=await createCharge("u4",input,randomUUID(),adapters);
    await releaseReservation({query},pending,{status:"expired"});
    assert.equal((await query("SELECT reserved FROM charges WHERE id=$1",[pending.id])).rows[0].reserved,false);
    assert.equal((await query("SELECT * FROM transactions WHERE charge_id=$1",[pending.id])).rowCount,0);
  });
  await t.test("admin can paginate every operation without counting USDC settlement twice",async()=>{
    const filters=reportFilters({environment:"production",limit:"1"});let after=null;const result=[];
    do{const page=await listReportOperations({query},filters,{cursor:after});result.push(...page.operations);after=page.nextCursor;}while(after);
    assert.equal(result.length,3);assert.equal(new Set(result.map((r)=>`${r.source}:${r.id}`)).size,3);
    assert.equal(result.filter((r)=>r.signature==="signature").length,1);
    assert.equal(result.find((r)=>r.merchantId==="u1").commissionState,"review");
  });
  await t.test("commission totals use durable entries and separate refund review from unearned fees",async()=>{
    const summary=await reportSummary({query},reportFilters({environment:"production"}));
    assert.equal(summary.totals.recordedFeeArs,"50.00");assert.equal(summary.totals.reviewFeeArs,"50.00");
    assert.equal(summary.totals.feeArsWithoutReview,"0.00");assert.equal(summary.totals.estimatedFeeArs,"0.00");
    assert.equal(summary.totals.operations,3);
    const own=await reportSummary({query},{...reportFilters({environment:"production"}),merchant:"u1"});
    assert.equal(own.merchants.length,1);assert.equal(own.totals.recordedFeeArs,"50.00");
    const testSummary=await reportSummary({query},reportFilters({environment:"test"}));
    assert.equal(testSummary.totals.recordedFeeArs,"0.00");assert.equal(testSummary.totals.operations,1);
  });
  await t.test("own history and cursors cannot expose another merchant",async()=>{
    const first=await listOwnCharges({query},"u1",settings,{limit:"1"});assert.equal(first.charges.length,1);
    const other=await listOwnCharges({query},"u2",settings);assert.equal(other.charges.length,0);
    const page=await listReportOperations({query},reportFilters({environment:"production",limit:"1"}));
    await assert.rejects(()=>listOwnCharges({query},"u2",settings,{cursor:page.nextCursor}),/invalid_report_cursor/);
  });
  await t.test("repeatable migration backfill does not duplicate booked commissions",async()=>{
    await engine.exec(commissionMigration);
    assert.equal((await query("SELECT * FROM commission_ledger")).rowCount,1);
  });
});

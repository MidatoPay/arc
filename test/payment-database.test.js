import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createCharge, getChargeAttempt, ensureOrder, incident, releaseReservation } from "../netlify/functions/lib/paymentService.js";
import { inspectPaymentDatabase } from "../netlify/functions/lib/paymentDatabase.js";
import { finalizeDelivery, reconcileCharge, settlePayout } from "../netlify/functions/lib/paymentWorker.js";
import { publicCharge } from "../netlify/functions/lib/paymentCore.js";
import { reportFilters, listReportOperations, reportSummary, listOwnCharges } from "../netlify/functions/lib/paymentReporting.js";
import { listUserActivity } from "../netlify/functions/lib/paymentActivity.js";

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
  for(const file of ["20261014_merchant_pos.sql","20261014_merchant_pos_assignments.sql","20261016_payment_payout_attempts.sql","20261016_charge_paid_at.sql","20261016_merchant_profiles.sql","20261016_wallet_transfers.sql"])
    await engine.exec(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8"));
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
  let liquidityRaw="100000000",solLamports="1000000000",verificationCalls=0;
  const adapters={db:pool,settings,assertWalletOwned:async(user)=>{if(user==="wrong")throw new Error("wallet_not_owned");},
    ensureMerchantPos:async(user)=>({external_id:`POS${user}`}),
    verifySeller:async()=>verificationCalls++,fetchQuote:async()=>({rate:"1650",roundId:"1",updatedAt:Math.floor(Date.now()/1000)}),
    getTreasuryAddress:async()=>wallet,treasuryLiquidity:async()=>({owner:wallet,raw:liquidityRaw,solLamports})};
  const input={ars:"10000.00",wallet};let c;
  await t.test("database preflight checks migrated tables and detects a missing migration without reading operations",async()=>{
    const healthy=await inspectPaymentDatabase(pool);assert.equal(healthy.ready,true);
    await query("ALTER TABLE merchant_pos_assignments RENAME TO temporarily_unavailable");
    const missing=await inspectPaymentDatabase(pool);assert.equal(missing.ready,false);
    assert.equal(missing.tables.find(row=>row.table==="merchant_pos_assignments").missingTable,true);
    await query("ALTER TABLE temporarily_unavailable RENAME TO merchant_pos_assignments");
    assert.equal((await inspectPaymentDatabase(pool)).ready,true);
  });
  await t.test("migration retains devnet data and permits the same signature on mainnet",async()=>{
    const legacy=await query("SELECT network FROM transactions WHERE user_id='legacy'");assert.equal(legacy.rows[0].network,"devnet");
    await query("INSERT INTO transactions(user_id,network,hash,kind,direction,who,amt,fx_rate,ars) VALUES('legacy','mainnet-beta','same-hash','pay','out','contact',1,1650,1650)");
    assert.equal((await query("SELECT * FROM transactions WHERE user_id='legacy'")).rowCount,2);
  });
  await t.test("same intent across concurrent retries persists one USDC reservation with no SOL minimum",async()=>{
    solLamports="0";
    const key=randomUUID();const result=await Promise.all([createCharge("u1",input,key,adapters),createCharge("u1",input,key,adapters)]);
    assert.equal(result[0].id,result[1].id);c=result[0];assert.equal(c.usdc_raw,"6030303");
    assert.equal(c.pos_id,"POSu1");assert.equal(c.order_body.config.qr.external_pos_id,c.pos_id);
    assert.equal((await query("SELECT * FROM charges WHERE user_id='u1'")).rowCount,1);
    solLamports="1000000000";
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
      status:"created",status_detail:"created",config:{qr:{external_pos_id:c.pos_id}},transactions:{payments:[{id:"PAY1",amount:"10000.00"}]}};
    const result=await ensureOrder({query},c,settings,{verifySeller:async()=>{},request:async(path,_settings,options)=>{
      received.push({path,options});return options?.method==="POST" ? {...provider,type_response:{qr_data:"EXACT-QR"}}:provider;
    }});
    assert.equal(result.qr_data,"EXACT-QR");assert.equal(result.status,"awaiting_payment");
    assert.equal(result.paid_at,null);
    assert.equal(received[0].options.headers["X-Idempotency-Key"],c.idempotency_key);
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
  });
  await t.test("lost canonical GET recovers the saved QR without creating another provider order",async()=>{
    await query("UPDATE charges SET status='creating' WHERE id=$1",[c.id]);
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    const provider={id:c.order_id,user_id:c.seller_id,type:"qr",currency:"ARS",external_reference:c.external_reference,
      total_amount:"10000.00",status:"created",status_detail:"created",config:{qr:{external_pos_id:c.pos_id}},
      transactions:{payments:[{id:"PAY1",amount:"10000.00"}]}};
    let gets=0;
    await reconcileCharge({query},c,settings,{ensureOrder:async()=>assert.fail("must reuse saved order"),
      request:async(path,_settings,options)=>{assert.equal(options,undefined);assert.equal(path,`/v1/orders/${c.order_id}`);gets++;return provider;}});
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    assert.equal(gets,1);assert.equal(c.status,"awaiting_payment");assert.equal(c.qr_data,"EXACT-QR");
    // Missing QR is recoverable from the canonical order as well.
    await query("UPDATE charges SET status='creating',qr_data=NULL WHERE id=$1",[c.id]);
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    await reconcileCharge({query},c,settings,{request:async()=>({...provider,type_response:{qr_data:"EXACT-QR"}})});
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    assert.equal(c.status,"awaiting_payment");assert.equal(c.qr_data,"EXACT-QR");
  });
  await t.test("an accredited charge reaches settlement without a fixed SOL minimum",async()=>{
    const provider={id:c.order_id,user_id:c.seller_id,type:"qr",currency:"ARS",external_reference:c.external_reference,
      total_amount:"10000.00",total_paid_amount:"10000.00",status:"processed",status_detail:"accredited",
      config:{qr:{external_pos_id:c.pos_id}},transactions:{payments:[{id:"PAY1",amount:"10000.00",
        paid_amount:"10000.00",status:"processed",status_detail:"accredited"}]}};
    let settlements=0;
    await reconcileCharge({query},c,settings,{request:async()=>provider,
      getTreasuryAddress:async()=>wallet,liquidity:async()=>({raw:c.usdc_raw,solLamports:"0"}),
      followPayout:async()=>{
        const row=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
        assert.ok(row.paid_at);assert.equal(row.status,"paid");
        assert.equal((await query("SELECT * FROM transactions WHERE charge_id=$1",[c.id])).rowCount,0);
        const activity=(await listUserActivity({query},"u1","mainnet-beta")).find(row=>row.charge_id===c.id);
        assert.ok(activity.paid_at);assert.equal(activity.settled,false);
        settlements++;return {pending:true};
      }});
    assert.equal(settlements,1);
    assert.equal((await query("SELECT signature FROM charges WHERE id=$1",[c.id])).rows[0].signature,null);
    const first=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    assert.equal(new Date(publicCharge(first).paidAt).getTime(),new Date(first.paid_at).getTime());
    await reconcileCharge({query},first,settings,{request:async()=>provider,
      getTreasuryAddress:async()=>wallet,liquidity:async()=>({raw:c.usdc_raw}),followPayout:async()=>({pending:true})});
    const second=(await query("SELECT paid_at FROM charges WHERE id=$1",[c.id])).rows[0];
    assert.equal(new Date(second.paid_at).getTime(),new Date(first.paid_at).getTime());
    const paidMigration=await readFile(new URL("../db/migrations/20261016_charge_paid_at.sql",import.meta.url),"utf8");
    await engine.exec(paidMigration);await engine.exec(paidMigration);
    assert.equal(new Date((await query("SELECT paid_at FROM charges WHERE id=$1",[c.id])).rows[0].paid_at).getTime(),new Date(first.paid_at).getTime());
  });
  await t.test("an invalid provider payment cannot acquire a received timestamp or release the UI's pending charge",async()=>{
    const unpaid=await createCharge("invalid-payment",input,randomUUID(),adapters);
    await query("UPDATE charges SET order_id='ORDINVALIDPAY',status='awaiting_payment',qr_data='qr' WHERE id=$1",[unpaid.id]);
    const current=(await query("SELECT * FROM charges WHERE id=$1",[unpaid.id])).rows[0];
    const provider={id:current.order_id,user_id:current.seller_id,type:"qr",currency:"ARS",external_reference:current.external_reference,
      total_amount:"10000.00",total_paid_amount:"10000.00",status:"processed",status_detail:"accredited",
      config:{qr:{external_pos_id:current.pos_id}},transactions:{payments:[{id:"PAYINVALID",amount:"10000.00",paid_amount:"1.00",status:"processed",status_detail:"accredited"}]}};
    await assert.rejects(()=>reconcileCharge({query},current,settings,{request:async()=>provider}),{code:"payment_mismatch"});
    const row=(await query("SELECT * FROM charges WHERE id=$1",[current.id])).rows[0];
    assert.equal(row.paid_at,null);assert.equal(row.status,"awaiting_payment");assert.equal(row.provider_status,null);
    await query("DELETE FROM charges WHERE id=$1",[current.id]);
  });
  await t.test("a configuration review does not block a new charge and finalized payout recovers after treasury rotation",async()=>{
    c.signature="signature";c.payout_memo="memo";
    await query("UPDATE charges SET signature=$2,payout_memo=$3 WHERE id=$1",[c.id,c.signature,c.payout_memo]);
    await incident({query},c,"charge_configuration_changed");
    assert.equal((await query("SELECT * FROM payment_user_blocks WHERE user_id='u1'")).rowCount,0);
    // Older deployments left this account-wide block behind; it must not prevent a new operation.
    await query("INSERT INTO payment_user_blocks(user_id,environment,reason) VALUES('u1','production','charge_configuration_changed')");
    const next=await createCharge("u1",input,randomUUID(),adapters);
    assert.notEqual(next.id,c.id);
    await query("DELETE FROM charges WHERE id=$1",[next.id]);
    const pendingActivity=await listUserActivity({query},"u1","mainnet-beta");
    const pending=pendingActivity.find(row=>row.charge_id===c.id);
    assert.equal(pending.status,"manual_review");assert.equal(pending.settled,false);
    assert.equal((await listUserActivity({query},"u2","mainnet-beta")).length,0);
    c=(await query("SELECT * FROM charges WHERE id=$1",[c.id])).rows[0];
    const provider={id:c.order_id,user_id:c.seller_id,type:"qr",currency:"ARS",external_reference:c.external_reference,
      total_amount:"10000.00",total_paid_amount:"10000.00",status:"processed",status_detail:"accredited",
      config:{qr:{external_pos_id:c.pos_id}},transactions:{payments:[{id:"PAY1",amount:"10000.00",
        paid_amount:"10000.00",status:"processed",status_detail:"accredited"}]}};
    await reconcileCharge({query},c,settings,{request:async()=>provider,
      getTreasuryAddress:async()=>assert.fail("observing a saved signature must not depend on the rotated treasury"),
      followPayout:async(_db,charge,options)=>{
        assert.equal(charge.signature,"signature");assert.equal(options.allowBroadcast,false);
        return {finalized:true,block:42};
      }});
    assert.equal((await query("SELECT status FROM charges WHERE id=$1",[c.id])).rows[0].status,"delivered");
    assert.equal((await query("SELECT * FROM payment_user_blocks WHERE user_id='u1'")).rowCount,0);
    assert.equal((await query("SELECT * FROM payment_incidents WHERE charge_id=$1 AND resolved_at IS NULL",[c.id])).rowCount,0);
    const deliveredActivity=(await listUserActivity({query},"u1","mainnet-beta")).filter(row=>row.charge_id===c.id);
    assert.equal(deliveredActivity.length,1);assert.equal(deliveredActivity[0].settled,true);
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
  await t.test("confirmed USDC is visible without completing the delivery ledger",async()=>{
    const pending=await createCharge("confirmation-user",input,randomUUID(),adapters);
    await query("UPDATE charges SET signature='confirmed-only',signed_wire='wire',status='broadcasting' WHERE id=$1",[pending.id]);
    const current=(await query("SELECT * FROM charges WHERE id=$1",[pending.id])).rows[0];
    const result=await settlePayout({query},current,{rpc:async()=>({value:[{confirmationStatus:"confirmed",slot:43}]})});
    assert.equal(result.confirmed,true);assert.equal(result.finalized,undefined);
    const row=(await query("SELECT status,reserved,delivered_at FROM charges WHERE id=$1",[pending.id])).rows[0];
    assert.equal(row.status,"confirmed");assert.equal(row.reserved,true);assert.equal(row.delivered_at,null);
    assert.equal((await query("SELECT * FROM transactions WHERE charge_id=$1",[pending.id])).rowCount,0);
    assert.equal((await query("SELECT * FROM commission_ledger WHERE charge_id=$1",[pending.id])).rowCount,0);
    const activity=(await listUserActivity({query},"confirmation-user","mainnet-beta"))[0];
    assert.equal(activity.status,"confirmed");assert.equal(activity.settled,false);
    await query("DELETE FROM charges WHERE id=$1",[pending.id]);
  });
  await t.test("reviewed retry history retains the previous signed wire without duplicate archive records",async()=>{
    for(let i=0;i<2;i++)await query(`INSERT INTO payment_payout_attempts(signature,charge_id,signed_wire,last_valid_block_height,payout_memo,reason)
      VALUES('expired-signature',$1,'original-signed-wire',100,'original-memo','expired_verified_not_landed') ON CONFLICT DO NOTHING`,[c.id]);
    const archived=await query("SELECT * FROM payment_payout_attempts WHERE charge_id=$1",[c.id]);
    assert.equal(archived.rows.length,1);assert.equal(archived.rows[0].signed_wire,"original-signed-wire");
    assert.equal((await query("SELECT * FROM transactions WHERE charge_id=$1",[c.id])).rowCount,1);
  });
  await t.test("refund after delivery stays under review without blocking independent new charges",async()=>{
    await incident({query},c,"mercadopago_refund_after_payout");await incident({query},c,"mercadopago_refund_after_payout");
    assert.equal((await query("SELECT * FROM payment_incidents WHERE charge_id=$1 AND resolved_at IS NULL",[c.id])).rowCount,1);
    await query("INSERT INTO payment_user_blocks(user_id,environment,reason) VALUES('u1','production','mercadopago_refund_after_payout')");
    const next=await createCharge("u1",input,randomUUID(),adapters);
    const activity=await listUserActivity({query},"u1","mainnet-beta");
    const unsigned=activity.find(row=>row.charge_id===next.id);
    assert.equal(unsigned.hash,`charge:${next.id}`);assert.equal(unsigned.signature,null);assert.equal(unsigned.settled,false);
    await query("DELETE FROM charges WHERE id=$1",[next.id]);
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
  await t.test("Activity uses the current business name for pending and settled charges and leaves other users unchanged",async()=>{
    await query("INSERT INTO merchant_profiles(user_id,user_name,business_name) VALUES('u1','Juan','Mi negocio'),('legacy','Otro','Otro negocio')");
    const pending=await createCharge("u1",input,randomUUID(),adapters);
    let activity=await listUserActivity({query},"u1","mainnet-beta");
    assert.equal(activity.find(row=>row.charge_id===pending.id).who,"Mi negocio");
    assert.equal(activity.find(row=>row.signature==="signature").who,"Mi negocio");
    await query("UPDATE merchant_profiles SET business_name=NULL WHERE user_id='u1'");
    activity=await listUserActivity({query},"u1","mainnet-beta");
    assert.equal(activity.find(row=>row.charge_id===pending.id).who,"Juan");
    assert.equal(activity.find(row=>row.signature==="signature").who,"Juan");
    const other=await listUserActivity({query},"legacy","mainnet-beta");
    assert.equal(other[0].who,"contact");
    await query("DELETE FROM charges WHERE id=$1",[pending.id]);
  });
});

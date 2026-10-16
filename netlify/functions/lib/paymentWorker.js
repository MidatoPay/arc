import { PaymentError, validateOrder, unitsDecimal, CHARGE_SCOPED_REVIEW_REASONS, RECOVERABLE_PAYOUT_REVIEW_REASONS } from "./paymentCore.js";
import { getPaymentDb, paymentSettings, assertPaymentsEnabled } from "./paymentRuntime.js";
import { withChargeLock, ensureOrder, updateCharge, assertChargeConfig, releaseReservation, incident } from "./paymentService.js";
import { mpRequest } from "./mercadopago.js";
import { getTreasuryAddress, treasuryLiquidity, prepareTreasuryPayout, treasuryRpc } from "./treasuryPayout.js";

export const PAYOUT_POLL_INTERVAL_MS = 2500;
export const PAYOUT_FOLLOW_MS = 120000;

export async function settlePayout(db, charge, adapters = {}) {
  const rpc = adapters.rpc || treasuryRpc;
  const prepare = adapters.prepare || prepareTreasuryPayout;
  const save = adapters.save || ((fields) => updateCharge(db, charge.id, fields));
  if (!charge.signature) {
    if(adapters.allowBroadcast===false)return {pending:true};
    const prepared = await prepare({ to: charge.wallet_address, rawAmount: charge.usdc_raw,
      usdc: unitsDecimal(charge.usdc_raw,6), kind: "charge_mercadopago",
      ars: unitsDecimal(charge.amount_cents,2), fxRate: charge.fx_rate, factura: charge.external_reference });
    const fields = { signature: prepared.hash, signed_wire: prepared.wire,
      last_valid_block_height: prepared.lastValidBlockHeight, payout_memo: prepared.memo, status: "delivery_pending" };
    // A durable commit must succeed before transmission; save is NOT in an uncommitted transaction.
    await save(fields);
    Object.assign(charge,fields);
  }
  const result = await rpc("getSignatureStatuses", [[charge.signature], { searchTransactionHistory: true }]);
  const status = result.value?.[0];
  if (status?.err) return { review: "solana_transaction_failed" };
  if (status?.confirmationStatus === "finalized") return { finalized: true, block: status.slot };
  if (status?.confirmationStatus === "confirmed") {
    if (charge.status !== "confirmed") {
      const fields={status:"confirmed",last_error:null};
      await save(fields);Object.assign(charge,fields);
    }
    return {pending:true,confirmed:true,block:status.slot};
  }
  const height = await rpc("getBlockHeight", [{ commitment: "finalized" }]);
  if (BigInt(height) > BigInt(charge.last_valid_block_height)) {
    // A processed signature may still finalize after its blockhash expires.
    if (status) return {pending:true};
    // Absence from one RPC is not proof of non-execution. Never build a second transfer blindly.
    return { review: "solana_expired_requires_review" };
  }
  if(adapters.allowBroadcast===false)return {pending:true};
  // Omit maxRetries so the RPC also rebroadcasts until the blockhash expires.
  await rpc("sendTransaction", [charge.signed_wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
  if (charge.status !== "broadcasting") {
    await save({status:"broadcasting"});charge.status="broadcasting";
  }
  return { pending: true };
}

export async function followPayout(db, charge, adapters = {}) {
  const now=adapters.now || Date.now;
  const wait=adapters.wait || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const settle=adapters.settle || settlePayout;
  const deadline=Math.min(now()+PAYOUT_FOLLOW_MS,adapters.deadline ?? Infinity);
  let result={pending:true},lastError;
  while(now()<deadline) {
    try {
      result=await settle(db,charge,adapters);lastError=null;
      if(result.finalized || result.review || !charge.signature)return result;
    } catch(error) {
      // Transport errors can follow an accepted broadcast. Keep the saved wire.
      if(!["solana_rpc_unavailable","solana_rpc_timeout"].includes(error?.code))throw error;
      lastError=error;
    }
    const remaining=deadline-now();
    if(remaining<=0)break;
    await wait(Math.min(PAYOUT_POLL_INTERVAL_MS,remaining));
  }
  if(lastError)throw lastError;
  return result;
}

export async function finalizeDelivery(db, charge, block) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`treasury:${charge.treasury_address}`]);
    await db.query(`INSERT INTO transactions(user_id,network,hash,kind,direction,who,amt,fx_rate,ars,factura,block,memo,charge_id)
      VALUES($1,$2,$3,'charge_mercadopago','in','Mercado Pago',$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(user_id,network,hash) DO UPDATE SET kind=EXCLUDED.kind,direction=EXCLUDED.direction,who=EXCLUDED.who,
      amt=EXCLUDED.amt,fx_rate=EXCLUDED.fx_rate,ars=EXCLUDED.ars,factura=EXCLUDED.factura,block=EXCLUDED.block,
      memo=EXCLUDED.memo,charge_id=EXCLUDED.charge_id`,
      [charge.user_id,charge.network,charge.signature,unitsDecimal(charge.usdc_raw,6),charge.fx_rate,
        unitsDecimal(charge.amount_cents,2),charge.external_reference,block,charge.payout_memo,charge.id]);
    await db.query(`INSERT INTO commission_ledger(charge_id,merchant_user_id,environment,network,gross_amount_cents,fee_cents,fee_bps,fx_rate,usdc_raw)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(charge_id) DO NOTHING`,
      [charge.id,charge.user_id,charge.environment,charge.network,charge.amount_cents,charge.fee_cents,charge.fee_bps,charge.fx_rate,charge.usdc_raw]);
    await db.query("UPDATE charges SET status='delivered',reserved=false,delivered_at=COALESCE(delivered_at,now()),last_error=NULL WHERE id=$1",[charge.id]);
    await db.query("UPDATE payment_incidents SET resolved_at=now() WHERE charge_id=$1 AND resolved_at IS NULL AND reason=ANY($2::text[])",
      [charge.id,CHARGE_SCOPED_REVIEW_REASONS]);
    await db.query(`DELETE FROM payment_user_blocks b WHERE b.user_id=$1 AND b.environment=$2 AND b.reason=ANY($3::text[])
      AND NOT EXISTS (SELECT 1 FROM payment_incidents i JOIN charges c ON c.id=i.charge_id
        WHERE c.user_id=b.user_id AND c.environment=b.environment AND i.reason=b.reason AND i.resolved_at IS NULL)`,
      [charge.user_id,charge.environment,CHARGE_SCOPED_REVIEW_REASONS]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export async function reconcileCharge(db, charge, settings, adapters = {}) {
  const request=adapters.request || mpRequest;
  assertChargeConfig(charge,settings);
  const wasManual = charge.status === "manual_review";
  if (!charge.order_id) charge = await (adapters.ensureOrder || ensureOrder)(db,charge,settings);
  let order = await request(`/v1/orders/${encodeURIComponent(charge.order_id)}`, settings);
  let result = validateOrder(order,charge);
  if(!charge.qr_data && typeof order.type_response?.qr_data==="string" && order.type_response.qr_data) {
    charge={...charge,qr_data:order.type_response.qr_data};
    await updateCharge(db,charge.id,{qr_data:charge.qr_data});
  }
  if(!result.paid && !result.terminal && !result.refunded && !charge.qr_data) {
    charge={...charge,cancel_requested:true};
    await updateCharge(db,charge.id,{cancel_requested:true,status:"cancel_pending",last_error:"mercadopago_missing_qr"});
  }
  if ((charge.cancel_requested || new Date(charge.expires_at).getTime() <= Date.now()) && !result.paid && !result.terminal && !result.refunded) {
    try {
      await request(`/v1/orders/${encodeURIComponent(charge.order_id)}/cancel`, settings, {
        method:"POST", body:"{}", headers:{"X-Idempotency-Key":charge.id} });
    } catch { /* Cancellation may race with payment: GET is authoritative. */ }
    order = await request(`/v1/orders/${encodeURIComponent(charge.order_id)}`,settings);
    result = validateOrder(order,charge);
  }
  const providerFields={provider_status:order.status,provider_detail:order.status_detail,
    payment_id:result.paymentId,reconciled_at:new Date(),next_attempt_at:new Date(Date.now()+30000)};
  if(result.paid && !result.refunded)providerFields.paid_at=charge.paid_at || new Date();
  await updateCharge(db,charge.id,providerFields);
  Object.assign(charge,providerFields);
  if (result.refunded) {
    if (charge.signature) {
      // Even an ambiguous broadcast may have executed. Keep its reservation until manual reconciliation.
      await incident(db,charge,"mercadopago_refund_after_payout");
    } else {
      await releaseReservation(db,charge,{status:"refunded",last_error:null});
    }
    return;
  }
  if (result.terminal) {
    if (charge.signature) await incident(db,charge,"mercadopago_terminal_after_payout");
    else await releaseReservation(db,charge,{status:order.status,last_error:null});
    return;
  }
  if (charge.status === "delivered") return;
  // Observe the already authorized wire before consulting the current treasury.
  // A rotated signer must not prevent recording a transfer that already finalized.
  if (charge.signature && result.paid && (!wasManual || RECOVERABLE_PAYOUT_REVIEW_REASONS.includes(charge.last_error))) {
    const settlement = await (adapters.followPayout || followPayout)(db,charge,
      {allowBroadcast:!wasManual && process.env.PAYMENTS_ENABLED==="true",deadline:adapters.payoutDeadline});
    if (settlement.finalized) await finalizeDelivery(db,charge,settlement.block);
    else if (settlement.review) await incident(db,charge,settlement.review);
    return;
  }
  if (wasManual) return;
  if (!result.paid) {
    if(!wasManual && charge.status==="creating" && !charge.cancel_requested)
      await updateCharge(db,charge.id,{status:"awaiting_payment",last_error:null});
    return;
  }
  await updateCharge(db,charge.id,{status:charge.signature ? charge.status : "paid",last_error:null});
  if(!charge.signature)assertPaymentsEnabled();
  const owner = await (adapters.getTreasuryAddress || getTreasuryAddress)();
  assertChargeConfig(charge,settings,owner);
  if (!owner || owner !== charge.treasury_address) throw new PaymentError("treasury_account_mismatch");
  if (!charge.signature) {
    const liquidity = await (adapters.liquidity || treasuryLiquidity)();
    if (BigInt(liquidity.raw) < BigInt(charge.usdc_raw)) throw new PaymentError("insufficient_treasury");
  }
  const settlement = await (adapters.followPayout || followPayout)(db,charge,
    {allowBroadcast:process.env.PAYMENTS_ENABLED==="true",deadline:adapters.payoutDeadline});
  if (settlement.review) await incident(db,charge,settlement.review);
  else if (settlement.finalized) await finalizeDelivery(db,charge,settlement.block);
}

export async function processCharge(id, settings = paymentSettings(), options = {}) {
  return withChargeLock(id, async (db, charge) => {
    try { await reconcileCharge(db,charge,settings,{payoutDeadline:options.deadline}); return true; }
    catch (error) {
      const code = error instanceof PaymentError ? error.code : "payment_service_unavailable";
      if (["order_mismatch","payment_mismatch","charge_configuration_changed"].includes(code)) await incident(db,charge,code);
      const attempts = charge.attempts+1;
      await updateCharge(db,charge.id,{attempts,last_error:code,next_attempt_at:new Date(Date.now()+Math.min(300000, 10000*2**Math.min(attempts,5)))});
      return false;
    }
  });
}

export async function runPaymentWorker(settings = paymentSettings(), budgetMs = 600000, adapters = {}) {
  const db = adapters.db || getPaymentDb(),now=adapters.now || Date.now,deadline = now()+budgetMs;
  const process=adapters.processCharge || processCharge,request=adapters.request || mpRequest;
  // Each tracked charge holds one session advisory lock. Pool max is four;
  // leave one connection available for normal requests and queue reads.
  const batch=async(items,work)=>{
    let index=0;
    await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
      while(index<items.length && now()<deadline){const item=items[index++];await work(item);}
    }));
  };
  const inbox = await db.query(`SELECT * FROM payment_inbox WHERE environment=$1 AND processed_at IS NULL AND NOT quarantined
    AND next_attempt_at<=now() ORDER BY received_at LIMIT 50`,[settings.environment]);
  await batch(inbox.rows,async(event)=>{
    try {
      const order = await request(`/v1/orders/${encodeURIComponent(event.order_id)}`,settings);
      const found = await db.query("SELECT id FROM charges WHERE environment=$1 AND (order_id=$2 OR external_reference=$3)",
        [settings.environment,event.order_id,order.external_reference]);
      if (!found.rows[0]) throw new PaymentError("unknown_order");
      const success = await process(found.rows[0].id,settings,{deadline});
      if (!success) throw new PaymentError("reconciliation_pending");
      await db.query("UPDATE payment_inbox SET processed_at=now(),last_error=NULL WHERE id=$1",[event.id]);
    } catch (error) {
      await db.query(`UPDATE payment_inbox SET attempts=attempts+1,last_error=$2,next_attempt_at=now()+interval '1 minute',
        quarantined=(received_at<now()-interval '7 days') WHERE id=$1`,[event.id,error instanceof PaymentError ? error.code : "reconciliation_unavailable"]);
    }
  });
  // Status reconciliation also recovers missing webhooks. Delivered charges remain auditable via inbox.
  const pending = await db.query(`SELECT id FROM charges WHERE environment=$1 AND network=$2 AND next_attempt_at<=now()
    AND (status NOT IN ('delivered','expired','canceled','refunded','manual_review')
      OR (status='manual_review' AND signature IS NOT NULL AND last_error=ANY($3::text[]))) ORDER BY next_attempt_at LIMIT 50`,
    [settings.environment,settings.network,RECOVERABLE_PAYOUT_REVIEW_REASONS]);
  await batch(pending.rows,charge=>process(charge.id,settings,{deadline}));
  return { checked: pending.rowCount, notifications: inbox.rowCount };
}

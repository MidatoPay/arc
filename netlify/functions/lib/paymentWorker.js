import { PaymentError, validateOrder, unitsDecimal } from "./paymentCore.js";
import { getPaymentDb, paymentSettings, assertPaymentsEnabled } from "./paymentRuntime.js";
import { withChargeLock, ensureOrder, updateCharge, assertChargeConfig, releaseReservation, incident } from "./paymentService.js";
import { mpRequest } from "./mercadopago.js";
import { getTreasuryAddress, treasuryLiquidity, prepareTreasuryPayout, treasuryRpc } from "./treasuryPayout.js";

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
  if (status) return { pending: true };
  const height = await rpc("getBlockHeight", [{ commitment: "finalized" }]);
  if (BigInt(height) > BigInt(charge.last_valid_block_height)) {
    // Absence from one RPC is not proof of non-execution. Never build a second transfer blindly.
    return { review: "solana_expired_requires_review" };
  }
  if(adapters.allowBroadcast===false)return {pending:true};
  await rpc("sendTransaction", [charge.signed_wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  await save({ status: "broadcasting" });
  return { pending: true };
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
  await updateCharge(db,charge.id,{provider_status:order.status,provider_detail:order.status_detail,
    payment_id:result.paymentId,reconciled_at:new Date(),next_attempt_at:new Date(Date.now()+30000)});
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
  if (wasManual || charge.status === "delivered") return;
  if (!result.paid) {
    if(!wasManual && charge.status==="creating" && !charge.cancel_requested)
      await updateCharge(db,charge.id,{status:"awaiting_payment",last_error:null});
    return;
  }
  await updateCharge(db,charge.id,{status:charge.signature ? charge.status : "paid",last_error:null});
  if(!charge.signature)assertPaymentsEnabled();
  const blocked = await db.query("SELECT 1 FROM payment_user_blocks WHERE user_id=$1 AND environment=$2",[charge.user_id,charge.environment]);
  if (blocked.rowCount) { await incident(db,charge,"user_payment_review"); return; }
  const owner = await (adapters.getTreasuryAddress || getTreasuryAddress)();
  assertChargeConfig(charge,settings,owner);
  if (!owner || owner !== charge.treasury_address) throw new PaymentError("treasury_account_mismatch");
  if (!charge.signature) {
    const liquidity = await (adapters.liquidity || treasuryLiquidity)();
    if (BigInt(liquidity.raw) < BigInt(charge.usdc_raw)) throw new PaymentError("insufficient_treasury");
  }
  const settlement = await (adapters.settlePayout || settlePayout)(db,charge,{allowBroadcast:process.env.PAYMENTS_ENABLED==="true"});
  if (settlement.review) await incident(db,charge,settlement.review);
  else if (settlement.finalized) await finalizeDelivery(db,charge,settlement.block);
}

export async function processCharge(id, settings = paymentSettings()) {
  return withChargeLock(id, async (db, charge) => {
    try { await reconcileCharge(db,charge,settings); return true; }
    catch (error) {
      const code = error instanceof PaymentError ? error.code : "payment_service_unavailable";
      if (["order_mismatch","payment_mismatch","charge_configuration_changed"].includes(code)) await incident(db,charge,code);
      const attempts = charge.attempts+1;
      await updateCharge(db,charge.id,{attempts,last_error:code,next_attempt_at:new Date(Date.now()+Math.min(300000, 10000*2**Math.min(attempts,5)))});
      return false;
    }
  });
}

export async function runPaymentWorker(settings = paymentSettings(), budgetMs = 600000) {
  const db = getPaymentDb(), deadline = Date.now()+budgetMs;
  const inbox = await db.query(`SELECT * FROM payment_inbox WHERE environment=$1 AND processed_at IS NULL AND NOT quarantined
    AND next_attempt_at<=now() ORDER BY received_at LIMIT 50`,[settings.environment]);
  for (const event of inbox.rows) {
    if (Date.now()>deadline) break;
    try {
      const order = await mpRequest(`/v1/orders/${encodeURIComponent(event.order_id)}`,settings);
      const found = await db.query("SELECT id FROM charges WHERE environment=$1 AND (order_id=$2 OR external_reference=$3)",
        [settings.environment,event.order_id,order.external_reference]);
      if (!found.rows[0]) throw new PaymentError("unknown_order");
      const success = await processCharge(found.rows[0].id,settings);
      if (!success) throw new PaymentError("reconciliation_pending");
      await db.query("UPDATE payment_inbox SET processed_at=now(),last_error=NULL WHERE id=$1",[event.id]);
    } catch (error) {
      await db.query(`UPDATE payment_inbox SET attempts=attempts+1,last_error=$2,next_attempt_at=now()+interval '1 minute',
        quarantined=(received_at<now()-interval '7 days') WHERE id=$1`,[event.id,error instanceof PaymentError ? error.code : "reconciliation_unavailable"]);
    }
  }
  // Status reconciliation also recovers missing webhooks. Delivered charges remain auditable via inbox.
  const pending = await db.query(`SELECT id FROM charges WHERE environment=$1 AND network=$2 AND next_attempt_at<=now()
    AND status NOT IN ('delivered','expired','canceled','refunded','manual_review') ORDER BY next_attempt_at LIMIT 50`,
    [settings.environment,settings.network]);
  for (const charge of pending.rows) {
    if (Date.now()>deadline) break;
    await processCharge(charge.id,settings);
  }
  return { checked: pending.rowCount, notifications: inbox.rowCount };
}

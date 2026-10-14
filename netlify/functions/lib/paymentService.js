import { randomUUID } from "node:crypto";
import { isAddress } from "@solana/kit";
import { fetchArsQuote } from "../../../src/priceFeed.js";
import { PaymentError, quoteCharge, orderBody, unitsDecimal, validateOrder, decimalUnits } from "./paymentCore.js";
import { getPaymentDb, transaction, paymentSettings, assertPaymentsEnabled, assertWalletOwned } from "./paymentRuntime.js";
import { verifySeller, mpRequest } from "./mercadopago.js";
import { treasuryLiquidity, getTreasuryAddress } from "./treasuryPayout.js";

export async function createCharge(userId, input, key, adapters = {}) {
  assertPaymentsEnabled();
  const settings = adapters.settings || paymentSettings();
  const pool = adapters.db || getPaymentDb();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || "")) throw new PaymentError("invalid_idempotency_key", 400);
  const amount = decimalUnits(input.ars, 2);
  if (amount <= 0n || amount > 100000000n) throw new PaymentError("invalid_amount_or_fee",400);
  if (!isAddress(input.wallet || "")) throw new PaymentError("invalid_wallet", 400);
  await (adapters.assertWalletOwned || assertWalletOwned)(userId, input.wallet);
  const existing = await pool.query("SELECT * FROM charges WHERE idempotency_key=$1", [key]);
  if (existing.rows[0]) {
    const c = existing.rows[0];
    const amount = quoteCharge(input.ars, c.fx_rate).amountCents;
    if (c.user_id !== userId || c.environment !== settings.environment || c.wallet_address !== input.wallet || c.amount_cents !== amount) throw new PaymentError("idempotency_conflict", 409);
    return c;
  }
  await (adapters.verifySeller || verifySeller)(settings);
  const rpc = process.env.ETH_RPC_URL;
  if (!rpc) throw new PaymentError("missing_eth_rpc_url");
  let feed;
  try { feed = await (adapters.fetchQuote || fetchArsQuote)(rpc, Number(process.env.CHAINLINK_MAX_AGE_SECONDS)); }
  catch { throw new PaymentError("quote_unavailable"); }
  const quote = quoteCharge(input.ars, feed.rate);
  return transaction(async (db) => {
    const owner = await (adapters.getTreasuryAddress || getTreasuryAddress)();
    if (!owner) throw new PaymentError("treasury_not_configured");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`treasury:${owner}`]);
    // Take the snapshot while holding the reservation lock, including finalized balance changes.
    const liquidity = await (adapters.treasuryLiquidity || treasuryLiquidity)();
    const duplicate = await db.query("SELECT * FROM charges WHERE idempotency_key=$1", [key]);
    if (duplicate.rows[0]) {
      const c = duplicate.rows[0];
      if (c.user_id !== userId || c.environment !== settings.environment || c.wallet_address !== input.wallet || c.amount_cents !== quote.amountCents) throw new PaymentError("idempotency_conflict", 409);
      return c;
    }
    const blocked = await db.query("SELECT 1 FROM payment_user_blocks WHERE user_id=$1 AND environment=$2", [userId, settings.environment]);
    if (blocked.rowCount) throw new PaymentError("user_payment_review", 403);
    const reserves = await db.query(`SELECT COALESCE(SUM(usdc_raw),0)::text AS raw, COUNT(*)::text AS count FROM charges
      WHERE reserved AND treasury_address=$1 AND network=$2`, [liquidity.owner, settings.network]);
    if (BigInt(liquidity.raw) - BigInt(reserves.rows[0].raw) < BigInt(quote.usdcRaw)) throw new PaymentError("insufficient_treasury");
    // Conservative allowance for ATA rent and transfer fees for every reserved intention.
    if (BigInt(liquidity.solLamports) < (BigInt(reserves.rows[0].count) + 1n) * 3000000n + 10000000n) throw new PaymentError("insufficient_treasury_sol");
    const id = randomUUID();
    const charge = { external_reference: `mp_${id.replaceAll("-", "")}`, amount_cents: quote.amountCents, pos_id: settings.pos };
    const body = orderBody(charge);
    const { rows } = await db.query(`INSERT INTO charges(id,user_id,wallet_address,environment,network,seller_id,pos_id,treasury_address,
      amount_cents,fee_cents,fee_bps,usdc_raw,fx_rate,quote_round,quote_updated_at,external_reference,idempotency_key,order_body,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,50,$11,$12,$13,$14,$15,$16,$17,now()+interval '15 minutes') RETURNING *`,
      [id,userId,input.wallet,settings.environment,settings.network,settings.seller,settings.pos,liquidity.owner,
        quote.amountCents,quote.feeCents,quote.usdcRaw,quote.rate,feed.roundId,new Date(feed.updatedAt*1000),charge.external_reference,key,body]);
    return rows[0];
  }, pool);
}

export async function getCharge(id, userId, settings = paymentSettings()) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new PaymentError("charge_not_found", 404);
  const { rows } = await getPaymentDb().query("SELECT * FROM charges WHERE id=$1 AND user_id=$2 AND environment=$3 AND network=$4",
    [id,userId,settings.environment,settings.network]);
  if (!rows[0]) throw new PaymentError("charge_not_found", 404);
  return rows[0];
}
export async function withChargeLock(id, fn) {
  const db = await getPaymentDb().connect();
  let locked = false;
  try {
    const result = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`charge:${id}`]);
    locked = result.rows[0].locked;
    if (!locked) return null;
    const { rows } = await db.query("SELECT * FROM charges WHERE id=$1", [id]);
    return rows[0] ? await fn(db, rows[0]) : null;
  } finally {
    let discard = false;
    try { if (locked) await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`charge:${id}`]); }
    catch { discard = true; }
    finally { db.release(discard); }
  }
}

export async function updateCharge(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await db.query(`UPDATE charges SET ${keys.map((k,i) => `${k}=$${i+2}`).join(",")} WHERE id=$1`, [id,...Object.values(fields)]);
}

export async function ensureOrder(db, charge, settings, adapters = {}) {
  if (charge.order_id) return charge;
  assertPaymentsEnabled();
  await (adapters.verifySeller || verifySeller)(settings);
  const request = adapters.request || mpRequest;
  const response = await request("/v1/orders", settings, { method: "POST", body: JSON.stringify(charge.order_body),
    headers: { "X-Idempotency-Key": charge.idempotency_key } });
  if (!/^ORD[A-Za-z0-9]+$/.test(response.id || "")) throw new PaymentError("mercadopago_invalid_order");
  // Persist the identity before further calls: even a malformed response must remain traceable.
  await updateCharge(db, charge.id, { order_id: response.id, qr_data: response.type_response?.qr_data || null });
  charge.order_id = response.id;
  charge.qr_data = response.type_response?.qr_data || null;
  const canonical = await request(`/v1/orders/${encodeURIComponent(response.id)}`, settings);
  const validated = validateOrder(canonical, charge);
  const fields = { payment_id: validated.paymentId, status: "awaiting_payment", provider_status: canonical.status,
    provider_detail: canonical.status_detail, last_error: charge.qr_data ? null : "mercadopago_missing_qr" };
  if (!charge.qr_data) {
    fields.cancel_requested = true;
    fields.status = "cancel_pending";
  }
  await updateCharge(db, charge.id, fields);
  return { ...charge, ...fields };
}

export function assertChargeConfig(charge, settings, treasury) {
  if (charge.environment !== settings.environment || charge.network !== settings.network || charge.seller_id !== settings.seller ||
      charge.pos_id !== settings.pos || (treasury && charge.treasury_address !== treasury)) throw new PaymentError("charge_configuration_changed");
}

export async function releaseReservation(db, charge, fields) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`treasury:${charge.treasury_address}`]);
    await updateCharge(db, charge.id, { ...fields, reserved: false });
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export async function incident(db, charge, reason) {
  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO payment_incidents(charge_id,reason) VALUES($1,$2) ON CONFLICT DO NOTHING", [charge.id,reason]);
    await db.query(`INSERT INTO payment_user_blocks(user_id,environment,reason) VALUES($1,$2,$3)
      ON CONFLICT(user_id,environment) DO NOTHING`, [charge.user_id,charge.environment,reason]);
    await updateCharge(db, charge.id, { status: "manual_review", last_error: reason });
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export { unitsDecimal };

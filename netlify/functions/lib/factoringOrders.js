import { randomUUID } from 'node:crypto';
import { clientForEnvironment } from './twentyOneMillions.js';
import { ORDER_COLUMNS, inTransaction, iso, nowMs } from './factoringDb.js';
// Execution of one 21 Millions withdrawal order, shared by the take (net and
// fee) and the debtor payment. Invariants (plan 5.3): the order and its
// Idempotency-Key are committed before calling the provider, a retry always
// reuses the key, and a PROCESSING order is looked up, never resent.
export const UNCERTAIN_WINDOW_MS = 30 * 60_000;
export const ORDER_IDEMPOTENCY_PREFIX = 'midatopay-factoring-';

export function newOrderId() {
  const id = randomUUID();
  return { id, idempotencyKey: ORDER_IDEMPOTENCY_PREFIX + id };
}

export async function loadOrder(db, id, lock = false) {
  return (await db.query(`SELECT ${ORDER_COLUMNS} FROM factoring_orders o WHERE o.id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0] || null;
}

export function orderClient(order, { client, env = process.env } = {}) {
  if (client) return client;
  return clientForEnvironment(order.environment, env);
}

export async function openReview(db, { invoiceId, takeId = null, orderId = null, chainEventId = null, reason, evidence = null, now }) {
  await db.query(`INSERT INTO factoring_reviews(invoice_id,take_id,order_id,chain_event_id,reason,evidence,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
  [invoiceId, takeId, orderId, chainEventId, reason, evidence ? JSON.stringify(evidence) : null, iso(nowMs(now))]);
}

/**
 * Sends (or looks up) the order once. Returns the provider result, or null when
 * the order is not due, already final, or its environment is not configured.
 * `settings.paymentsMode === 'disabled'` stops orders that were never requested.
 */
export async function executeOrder(db, orderId, { now, settings, client, env }) {
  const ms = nowMs(now);
  const prepared = await inTransaction(db, async tx => {
    const order = await loadOrder(tx, orderId, true);
    if (!order || !['pending', 'submitting', 'processing'].includes(order.status)) return null;
    if (new Date(order.next_attempt_at).getTime() > ms) return null;
    if (order.status === 'processing' && order.provider_order_id) return { order, lookup: true };
    if (settings?.paymentsMode === 'disabled' && order.attempts === 0) return null;
    // Persist the attempt before calling: a crash after the call is recovered with the same key.
    const updated = (await tx.query(`UPDATE factoring_orders SET status='submitting',attempts=attempts+1,
      first_attempt_at=COALESCE(first_attempt_at,$2) WHERE id=$1 RETURNING id`, [orderId, iso(ms)])).rows[0];
    return updated ? { order: { ...order, status: 'submitting', first_attempt_at: order.first_attempt_at || new Date(ms) }, lookup: false } : null;
  });
  if (!prepared) return null;
  const { order, lookup } = prepared;
  const provider = orderClient(order, { client, env });
  if (!provider) return null;
  const expected = { amountCents: BigInt(order.amount_cents), cvu: order.destination_cvu, idempotencyKey: order.idempotency_key };
  const result = lookup
    ? await provider.getOrder(order.payer_customer_id, order.provider_order_id, expected)
    : await provider.createBankWithdrawal({ customerId: order.payer_customer_id, idempotencyKey: order.idempotency_key,
      amountCents: BigInt(order.amount_cents), cvu: order.destination_cvu, requestId: order.id });
  return { order, result };
}

/**
 * Writes the provider result on the order row (inside the caller's transaction)
 * and returns a decision: completed | processing | failed | waiting | review | configuration.
 */
export async function recordOrderResult(tx, order, result, { now }) {
  const ms = nowMs(now), at = iso(ms);
  const provider = result.order || {};
  const started = order.first_attempt_at ? new Date(order.first_attempt_at).getTime() : ms;
  const exhausted = ms - started >= UNCERTAIN_WINDOW_MS;
  const set = async (sql, params = []) => tx.query(`UPDATE factoring_orders SET ${sql} WHERE id=$1`, [order.id, ...params]);
  switch (result.outcome) {
    case 'completed':
      await set(`status='completed',provider_order_id=COALESCE($2,provider_order_id),provider_status='COMPLETED',coelsa_id=$3,
        completed_at=$4,last_error=NULL,provider_error=NULL`, [provider.id || null, provider.coelsaId || null, at]);
      return 'completed';
    case 'processing':
      await set(`status='processing',provider_order_id=COALESCE($2,provider_order_id),provider_status=$3,next_attempt_at=$4,last_error=NULL`,
        [provider.id || null, provider.status || 'PROCESSING', iso(ms + 30_000)]);
      return 'processing';
    case 'failed':
    case 'rejected':
      await set(`status='failed',provider_order_id=COALESCE($2,provider_order_id),provider_status=$3,provider_error=$4,failed_at=$5`,
        [provider.id || null, provider.status || null, result.code || (result.outcome === 'failed' ? 'FAILED' : 'REJECTED'), at]);
      return 'failed';
    case 'retry':
    case 'uncertain': {
      if (exhausted) {
        await set(`status='manual_review',last_error=$2`, [result.outcome === 'retry' ? 'provider_retries_exhausted' : 'provider_uncertain']);
        return 'review';
      }
      const delay = result.outcome === 'retry' ? (result.retryAfterSeconds || 60) * 1000 : Math.min(300_000, 15_000 * 2 ** Math.min(order.attempts || 1, 5));
      await set(`next_attempt_at=$2,last_error=$3`, [iso(ms + delay), result.code || result.outcome]);
      return 'waiting';
    }
    case 'mismatch':
      await set(`status='manual_review',provider_order_id=COALESCE($2,provider_order_id),last_error='provider_mismatch'`, [provider.id || null]);
      return 'review';
    case 'configuration':
      // Nothing was created (401/403/404): wait for the configuration to be fixed.
      await set(`status=CASE WHEN status='submitting' THEN 'pending' ELSE status END,next_attempt_at=$2,last_error='provider_configuration'`, [iso(ms + 300_000)]);
      return 'configuration';
    default:
      await set(`next_attempt_at=$2,last_error='provider_unknown_outcome'`, [iso(ms + 60_000)]);
      return 'waiting';
  }
}

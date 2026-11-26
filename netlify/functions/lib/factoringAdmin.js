import { centsToArs } from '../../../src/invoiceCession.js';
import { PaymentError } from './paymentCore.js';
import { lockInvoice } from './factoringService.js';
import { completeTake, reopenAfterNetFailure } from './factoringTakes.js';
import { INVOICE_COLUMNS, TAKE_COLUMNS, inTransaction, iso, nowMs } from './factoringDb.js';
import { loadOrder, newOrderId } from './factoringOrders.js';
import { INVOICE_STATUSES } from './factoringStates.js';
// Manual review (plan T14). Closed actions only: `retry` and `resolve` (with a
// note). Every action leaves an audit row with actor='admin'.
const FEE_REASONS = ['fee_failed', 'fee_retries_exhausted', 'fee_mismatch'];
const NET_REASONS = ['net_uncertain', 'net_mismatch'];
const PAYMENT_REASONS = ['payment_uncertain', 'payment_mismatch'];

export async function listReviews(db) {
  const { rows } = await db.query(`SELECT r.id,r.invoice_id,r.reason,r.created_at,o.purpose,o.status AS order_status,o.provider_order_id,
      o.provider_error,o.last_error,c.kind,c.status AS chain_status,c.tx_hash,c.nonce
    FROM factoring_reviews r LEFT JOIN factoring_orders o ON o.id=r.order_id LEFT JOIN factoring_chain_events c ON c.id=r.chain_event_id
    WHERE r.resolved_at IS NULL ORDER BY r.created_at LIMIT 200`);
  return rows.map(r => ({ id: r.id, invoiceId: r.invoice_id, reason: r.reason, createdAt: new Date(r.created_at).toISOString(),
    order: r.purpose ? { purpose: r.purpose, status: r.order_status, providerOrderId: r.provider_order_id, providerError: r.provider_error || r.last_error || null } : null,
    chainEvent: r.kind ? { kind: r.kind, status: r.chain_status, txHash: r.tx_hash, nonce: r.nonce == null ? null : String(r.nonce) } : null }));
}

export async function listInvoicesForReconciliation(db, status) {
  if (status && !INVOICE_STATUSES.includes(status)) throw new PaymentError('invalid_status', 400);
  const { rows } = await db.query(`SELECT ${INVOICE_COLUMNS},t.advance_cents::text AS advance_cents,t.fee_cents::text AS fee_cents,
      t.investor_cvu,t.status AS take_status
    FROM invoices i LEFT JOIN invoice_takes t ON t.invoice_id=i.id AND t.status IN ('paying','completed','manual_review')
    WHERE ($1::text IS NULL OR i.status=$1) ORDER BY i.created_at DESC LIMIT 200`, [status || null]);
  return rows.map(r => ({ id: r.id, status: r.status, simulated: r.simulated, issuerCuit: r.issuer_cuit, debtorCuit: r.debtor_cuit,
    cbte: { tipo: Number(r.cbte_tipo), ptoVta: Number(r.pto_vta), nro: Number(r.cbte_nro) }, issuedOn: r.issued_on, dueOn: r.due_on,
    nominal: centsToArs(BigInt(r.nominal_cents)), take: r.take_status ? { status: r.take_status, advance: centsToArs(BigInt(r.advance_cents)),
      fee: centsToArs(BigInt(r.fee_cents)), investorCvu: r.investor_cvu } : null }));
}

export function assertReviewBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['action', 'note'].includes(k)) ||
      !['retry', 'resolve'].includes(body.action)) throw new PaymentError('invalid_body', 400);
  const note = body.note === undefined ? null : body.note;
  if (note !== null && (typeof note !== 'string' || note.trim().length < 10 || note.trim().length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(note)))
    throw new PaymentError('invalid_note', 400);
  if (body.action === 'resolve' && !note) throw new PaymentError('invalid_note', 400);
  return { action: body.action, note: note?.trim() || null };
}

async function auditAdmin(tx, invoice, adminId, reason, now) {
  await tx.query(`INSERT INTO factoring_audit(invoice_id,from_status,to_status,actor,actor_user_id,reason,created_at)
    VALUES($1,$2,$2,'admin',$3,$4,$5)`, [invoice.id, invoice.status, adminId, reason, iso(nowMs(now))]);
}

async function liveOrders(tx, takeId) {
  return (await tx.query(`SELECT id,purpose,status FROM factoring_orders WHERE take_id=$1 AND purpose IN ('net_to_issuer','fee_to_midatopay')
    ORDER BY created_at DESC,id`, [takeId])).rows;
}

export async function resolveReview(db, adminId, reviewId, body, { now, settings }) {
  const { action, note } = assertReviewBody(body);
  return inTransaction(db, async tx => {
    const peek = (await tx.query('SELECT invoice_id FROM factoring_reviews WHERE id=$1', [reviewId])).rows[0];
    if (!peek) throw new PaymentError('review_not_found', 404);
    let invoice = await lockInvoice(tx, peek.invoice_id);
    const review = (await tx.query('SELECT * FROM factoring_reviews WHERE id=$1 FOR UPDATE', [reviewId])).rows[0];
    if (review.resolved_at) throw new PaymentError('review_already_resolved', 409);
    const order = review.order_id ? await loadOrder(tx, review.order_id, true) : null;
    const take = review.take_id ? (await tx.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1 FOR UPDATE`, [review.take_id])).rows[0] : null;
    const at = iso(nowMs(now));
    const invalid = () => { throw new PaymentError('invalid_review_action', 409); };
    if (action === 'retry') {
      if (!order) invalid();
      if (order.status === 'failed' && order.purpose === 'fee_to_midatopay') {
        // A definitive fee failure: a new order with a new key (the old key is tied to the failed order).
        if (!take || take.status !== 'manual_review') invalid();
        const { id, idempotencyKey } = newOrderId();
        await tx.query(`INSERT INTO factoring_orders(id,invoice_id,take_id,purpose,environment,payer_customer_id,destination_cvu,amount_cents,
          idempotency_key,status,next_attempt_at,created_at) SELECT $2,invoice_id,take_id,purpose,environment,payer_customer_id,destination_cvu,
          amount_cents,$3,'pending',$4,$4 FROM factoring_orders WHERE id=$1`, [order.id, id, idempotencyKey, at]);
      } else if (order.status === 'manual_review') {
        // An uncertain or mismatched order is looked up again with the same key, with a fresh 30-minute window.
        await tx.query(`UPDATE factoring_orders SET status=CASE WHEN provider_order_id IS NULL THEN 'submitting' ELSE 'processing' END,
          next_attempt_at=$2,first_attempt_at=$2,last_error=NULL WHERE id=$1`, [order.id, at]);
      } else if (['pending', 'submitting', 'processing'].includes(order.status)) {
        await tx.query('UPDATE factoring_orders SET next_attempt_at=$2 WHERE id=$1', [order.id, at]);
      } else invalid();
      await auditAdmin(tx, invoice, adminId, `review_retry:${review.reason}`, now);
    } else if (FEE_REASONS.includes(review.reason)) {
      // Fee collected outside the system or forgiven, with a note: the invoice is ceded (transition 12).
      if (!take || invoice.status !== 'revision_manual') invalid();
      const orders = await liveOrders(tx, take.id);
      if (orders.find(o => o.purpose === 'net_to_issuer')?.status !== 'completed') invalid();
      await tx.query(`UPDATE factoring_orders SET status='cancelled' WHERE take_id=$1 AND purpose='fee_to_midatopay'
        AND status IN ('pending','submitting','processing','manual_review')`, [take.id]);
      invoice = await completeTake(tx, take, invoice, { now, settings, actor: 'admin', actorUserId: adminId, reason: `review_resolve:${review.reason}` });
    } else if (NET_REASONS.includes(review.reason)) {
      // Evidence from 21 Millions that the net did not move: published again (transition 13).
      if (!take || invoice.status !== 'revision_manual' || !order || order.status === 'completed') invalid();
      await tx.query(`UPDATE factoring_orders SET status='failed',provider_error='admin_resolved',failed_at=$2 WHERE id=$1`, [order.id, at]);
      await tx.query(`UPDATE factoring_orders SET status='cancelled' WHERE take_id=$1 AND purpose='fee_to_midatopay' AND status NOT IN ('completed','failed')`, [take.id]);
      invoice = await reopenAfterNetFailure(tx, take, invoice, { now, settings, actor: 'admin', actorUserId: adminId, reason: `review_resolve:${review.reason}` });
    } else if (PAYMENT_REASONS.includes(review.reason)) {
      // The payment did not land: the debtor can pay again. The invoice does not change.
      if (!order || order.status === 'completed') invalid();
      if (order.status === 'manual_review')
        await tx.query(`UPDATE factoring_orders SET status='failed',provider_error='admin_resolved',failed_at=$2 WHERE id=$1`, [order.id, at]);
      await auditAdmin(tx, invoice, adminId, `review_resolve:${review.reason}`, now);
    } else {
      await auditAdmin(tx, invoice, adminId, `review_resolve:${review.reason}`, now);
    }
    const resolved = (await tx.query(`UPDATE factoring_reviews SET resolved_at=$2,resolved_by=$3,resolution=$4,note=$5 WHERE id=$1
      RETURNING id,invoice_id,reason,resolution,resolved_at,note`, [reviewId, at, adminId, action === 'retry' ? 'retried' : 'resolved', note])).rows[0];
    return { review: { id: resolved.id, invoiceId: resolved.invoice_id, reason: resolved.reason, resolution: resolved.resolution,
      resolvedAt: new Date(resolved.resolved_at).toISOString(), note: resolved.note }, invoice: { id: invoice.id, status: invoice.status } };
  });
}

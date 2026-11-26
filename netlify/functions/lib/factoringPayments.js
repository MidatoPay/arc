import { argentinaDate } from '../../../src/invoiceCession.js';
import { PaymentError } from './paymentCore.js';
import { CHAIN_DETAIL } from './factoringStates.js';
import { evidenceHash } from './factoringHashes.js';
import { lockInvoice, transition, hydrateInvoices } from './factoringService.js';
import { INVOICE_COLUMNS, ORDER_COLUMNS, assertIdempotencyKey, inTransaction, iso, isUniqueViolation, nowMs, withSessionLock } from './factoringDb.js';
import { clientForEnvironment } from './twentyOneMillions.js';
import { assertFundsAndLimits } from './factoringTakes.js';
import { executeOrder, loadOrder, newOrderId, openReview, recordOrderResult } from './factoringOrders.js';
// Debtor payment (plan T12): from the due date, the debtor pays the full
// nominal (S-2) to the investor's CVU frozen in the take. Late payment from
// en_mora is allowed (D-05). The client never sends the amount or destination.
const PAYABLE = ['cedida', 'en_mora'];

async function loadOwed(db, userId, invoiceId, lock) {
  const invoice = lock ? await lockInvoice(db, invoiceId)
    : (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1`, [invoiceId])).rows[0];
  if (!invoice || invoice.status === 'cargada') throw new PaymentError('invoice_not_found', 404);
  const debtor = (await db.query(`SELECT id,user_id,tw_customer_id FROM factoring_parties WHERE id=$1 AND user_id=$2 AND role='debtor'`,
    [invoice.debtor_party_id, userId])).rows[0];
  if (!debtor) throw new PaymentError('invoice_not_found', 404);
  return { invoice, debtor };
}

const livePayment = (db, invoiceId) => db.query(`SELECT ${ORDER_COLUMNS} FROM factoring_orders o WHERE o.invoice_id=$1
  AND o.purpose='nominal_to_investor' AND o.status NOT IN ('failed','cancelled') LIMIT 1`, [invoiceId]).then(r => r.rows[0] || null);

async function paymentByKey(db, userId, key) {
  return (await db.query(`SELECT ${ORDER_COLUMNS} FROM factoring_orders o WHERE o.requested_by=$1 AND o.client_key=$2`, [userId, key])).rows[0] || null;
}

async function respond(db, invoiceId, order, settings, existing) {
  const invoice = (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1`, [invoiceId])).rows[0];
  const [shown] = await hydrateInvoices(db, [invoice], 'debtor', settings);
  return { invoice: shown, payment: { status: order.status, error: order.provider_error || null }, existing };
}

export async function createDebtorPayment(db, userId, invoiceId, idempotencyKey, { now, settings, client, env, kick }) {
  const key = assertIdempotencyKey(idempotencyKey);
  const { invoice, debtor } = await loadOwed(db, userId, invoiceId, false);
  const repeated = await paymentByKey(db, userId, key);
  if (repeated) {
    if (repeated.invoice_id !== invoiceId) throw new PaymentError('idempotency_conflict', 409);
    return respond(db, invoiceId, repeated, settings, true);
  }
  if (settings.paymentsMode === 'disabled' || !settings.twentyOneEnvironment) throw new PaymentError('factoring_payments_disabled', 503);
  const check = inv => {
    if (!PAYABLE.includes(inv.status)) throw new PaymentError('invalid_transition', 409);
    if (argentinaDate(nowMs(now)) < inv.due_on) throw new PaymentError('payment_not_yet_due', 422);
  };
  check(invoice);
  if (await livePayment(db, invoiceId)) throw new PaymentError('payment_in_progress', 409);
  const take = (await db.query(`SELECT id,investor_cvu FROM invoice_takes WHERE invoice_id=$1 AND status='completed'`, [invoiceId])).rows[0];
  if (!take) throw new PaymentError('invalid_transition', 409);
  const provider = client || clientForEnvironment(settings.twentyOneEnvironment, env || process.env);
  if (!provider) throw new PaymentError('twentyone_unavailable', 503);
  const nominal = BigInt(invoice.nominal_cents);
  await assertFundsAndLimits(provider, debtor.tw_customer_id, [nominal], { insufficient: 'debtor_insufficient_funds' });
  let created;
  try {
    created = await inTransaction(db, async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`factoring-payment-create:${userId}:${key}`]);
      const again = await paymentByKey(tx, userId, key);
      if (again) {
        if (again.invoice_id !== invoiceId) throw new PaymentError('idempotency_conflict', 409);
        return { order: again, existing: true };
      }
      const locked = await lockInvoice(tx, invoiceId);
      check(locked);
      if (await livePayment(tx, invoiceId)) throw new PaymentError('payment_in_progress', 409);
      const { id, idempotencyKey: orderKey } = newOrderId(), at = iso(nowMs(now));
      await tx.query(`INSERT INTO factoring_orders(id,invoice_id,take_id,purpose,environment,payer_customer_id,destination_cvu,amount_cents,
        idempotency_key,requested_by,client_key,status,next_attempt_at,created_at)
        VALUES($1,$2,$3,'nominal_to_investor',$4,$5,$6,$7,$8,$9,$10,'pending',$11,$11)`,
      [id, invoiceId, take.id, settings.twentyOneEnvironment, debtor.tw_customer_id, take.investor_cvu, String(nominal), orderKey, userId, key, at]);
      return { order: await loadOrder(tx, id), existing: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PaymentError('payment_in_progress', 409);
    throw error;
  }
  if (!created.existing && kick) await kick().catch(() => {});
  return respond(db, invoiceId, created.order, settings, created.existing);
}

/** One step of a debtor payment, under a per-order lock. Returns the number of provider calls. */
export async function processPayment(db, orderId, { now, settings, client, env } = {}) {
  const outcome = await withSessionLock(db, `factoring-payment:${orderId}`, async conn => {
    const executed = await executeOrder(conn, orderId, { now, settings, client, env });
    if (!executed) return 0;
    await inTransaction(conn, async tx => {
      const order = await loadOrder(tx, orderId);
      const invoice = await lockInvoice(tx, order.invoice_id);
      const current = await loadOrder(tx, orderId, true);
      const result = await recordOrderResult(tx, current, executed.result, { now });
      if (result === 'completed' && PAYABLE.includes(invoice.status)) {
        await transition(tx, invoice, 'cobrada', { actor: 'worker', now, settings, set: { collected_at: iso(nowMs(now)) },
          chain: { collected: { tokenId: invoice.token_id, detail: CHAIN_DETAIL.none,
            evidenceHash: evidenceHash({ orderId, providerOrderId: executed.result.order?.id || current.provider_order_id }) } } });
      } else if (result === 'review') {
        await openReview(tx, { invoiceId: invoice.id, takeId: order.take_id, orderId, now,
          reason: executed.result.outcome === 'mismatch' ? 'payment_mismatch' : 'payment_uncertain' });
      } else if (result === 'configuration') {
        await openReview(tx, { invoiceId: invoice.id, takeId: order.take_id, orderId, reason: 'provider_configuration', now });
      }
    });
    return 1;
  });
  return outcome.locked ? outcome.value : 0;
}

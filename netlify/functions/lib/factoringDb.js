import { PaymentError } from './paymentCore.js';
import { transaction } from './paymentRuntime.js';
// Small helpers shared by the factoring domain modules.
// Dates are read as text ('YYYY-MM-DD') and money as text, so the code behaves
// the same with node-postgres and PGlite; money is converted with BigInt().
export const INVOICE_COLUMNS = `i.id,i.issuer_user_id,i.issuer_party_id,i.debtor_party_id,i.idempotency_key,i.source,i.simulated,i.is_fce,
  i.issuer_cuit,i.debtor_cuit,i.cbte_tipo,i.pto_vta,i.cbte_nro::text AS cbte_nro,i.issued_on::text AS issued_on,i.due_on::text AS due_on,
  i.nominal_cents::text AS nominal_cents,i.currency,i.auth_mode,i.auth_code,i.qr_payload,i.arca_status,i.invoice_salt,i.invoice_hash,
  i.framework_sha256,i.token_id,i.issuer_wallet,i.status,i.acceptance_kind,i.sent_at,i.accepted_at,i.rejected_at,i.published_at,
  i.ceded_at,i.collected_at,i.defaulted_at,i.created_at,i.updated_at`;
export const TAKE_COLUMNS = `t.id,t.invoice_id,t.offer_id,t.investor_user_id,t.investor_party_id,t.investor_wallet,t.investor_cvu,t.issuer_cvu,
  t.fee_cvu,t.idempotency_key,t.taken_on::text AS taken_on,t.days,t.rate_bps,t.fee_bps,t.nominal_cents::text AS nominal_cents,
  t.discount_cents::text AS discount_cents,t.advance_cents::text AS advance_cents,t.fee_cents::text AS fee_cents,
  t.investor_outlay_cents::text AS investor_outlay_cents,t.investor_gain_cents::text AS investor_gain_cents,t.terms_hash,
  t.assignment_version,t.assignment_sha256,t.status,t.created_at,t.completed_at,t.failed_at`;
export const ORDER_COLUMNS = `o.id,o.invoice_id,o.take_id,o.purpose,o.environment,o.payer_customer_id,o.destination_cvu,
  o.amount_cents::text AS amount_cents,o.idempotency_key,o.requested_by,o.client_key,o.status,o.provider_order_id,o.provider_status,
  o.provider_error,o.provider_request_id,o.coelsa_id,o.attempts,o.next_attempt_at,o.first_attempt_at,o.last_error,o.created_at,
  o.completed_at,o.failed_at`;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `now` is an injected clock returning epoch milliseconds. */
export const nowMs = now => (typeof now === 'function' ? now() : Date.now());
export const iso = ms => new Date(ms).toISOString();

export function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || !UUID_V4.test(key)) throw new PaymentError('invalid_idempotency_key', 400);
  return key.toLowerCase();
}

/** Errors from src/ modules carry code and status; the server answers with PaymentError. */
export function asPaymentError(error) {
  if (error instanceof PaymentError) return error;
  if (error?.code && typeof error.code === 'string' && Number.isInteger(error.status)) return new PaymentError(error.code, error.status);
  return error;
}
export function translate(fn) {
  try { return fn(); } catch (error) { throw asPaymentError(error); }
}

export const inTransaction = (db, fn) => transaction(fn, db);

/**
 * A pool-like wrapper around one held connection: every transaction of a long
 * job (worker, take processing) runs on the connection that holds the
 * session-level advisory lock, one after another.
 */
export function pinned(client) {
  const query = (...args) => client.query(...args);
  return { query, connect: async () => ({ query, release() {} }), pinned: true };
}

/** Runs `fn` on one connection while holding a session advisory lock; returns `undefined` if busy. */
export async function withSessionLock(db, key, fn) {
  // With a pinned db this reuses its held connection (locks are re-entrant per session).
  const conn = await db.connect();
  let locked = false, discard = false;
  try {
    locked = (await conn.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key])).rows[0].locked;
    if (!locked) return { locked: false };
    return { locked: true, value: await fn(pinned(conn)) };
  } finally {
    try { if (locked) await conn.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); } catch { discard = true; }
    conn.release(discard);
  }
}

export function isUniqueViolation(error) {
  return error?.code === '23505';
}

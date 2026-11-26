import { randomUUID } from 'node:crypto';
import { argentinaDate, centsToArs, cessionQuote, daysBetween, fceTransferBlocked, arsToCents } from '../../../src/invoiceCession.js';
import { formatCuit, INVOICE_TYPES } from '../../../src/invoiceQr.js';
import { AR_BANK_HOLIDAYS } from '../../../src/arBankHolidays.js';
import { primaryArcWallet } from '../../../src/primaryWallet.js';
import { PaymentError } from './paymentCore.js';
import { requireRole } from './factoringAccess.js';
import { CHAIN_DETAIL } from './factoringStates.js';
import { termsHash, evidenceHash } from './factoringHashes.js';
import { ASSIGNMENT_TEMPLATE, renderAssignment, newAssignmentReference } from './factoringDocuments.js';
import { lockInvoice, transition, hydrateInvoices } from './factoringService.js';
import { INVOICE_COLUMNS, TAKE_COLUMNS, ORDER_COLUMNS, assertIdempotencyKey, inTransaction, iso, isUniqueViolation, nowMs,
  translate, withSessionLock } from './factoringDb.js';
import { clientForEnvironment } from './twentyOneMillions.js';
import { executeOrder, loadOrder, newOrderId, openReview, recordOrderResult } from './factoringOrders.js';
// Investor take (plan T11): quote, take with lock and idempotency, and the
// net-then-fee execution against 21 Millions, driven by the worker.
export const FCE_INVESTOR_TYPES = Object.freeze(['entidad_financiera', 'proveedor_no_financiero_credito']);

/** The PaymentError of a 409 terms_changed carries the fresh quote for the client. */
export class TermsChangedError extends PaymentError {
  constructor(quote) { super('terms_changed', 409); this.quote = quote; }
}

export function publicQuote(q) {
  return { days: q.days, rateBps: q.rateBps, feeBps: q.feeBps, nominal: centsToArs(q.nominalCents), discount: centsToArs(q.discountCents),
    advance: centsToArs(q.advanceCents), fee: centsToArs(q.feeCents), outlay: centsToArs(q.investorOutlayCents),
    gain: centsToArs(q.investorGainCents), investorTnaBps: q.investorTnaBps };
}

/** Recomputes the quote at `now` and why the investor cannot take it, if so. Never trusts the client. */
export function evaluateOffer({ offer, invoice, investor, debtorUserId, now, holidays = AR_BANK_HOLIDAYS }) {
  const ms = nowMs(now), today = argentinaDate(ms);
  const days = daysBetween(today, invoice.due_on);
  let quote = null, blockedReason = null;
  if (days > 0) quote = cessionQuote({ nominalCents: BigInt(invoice.nominal_cents), days, rateBps: offer.rate_bps, feeBps: offer.fee_bps });
  if (offer.status !== 'open' || invoice.status !== 'publicada') blockedReason = offer.status === 'expired' ? 'offer_expired' : 'offer_taken';
  else if (new Date(offer.expires_at).getTime() <= ms) blockedReason = 'offer_expired';
  else if (investor && (investor.user_id === invoice.issuer_user_id || investor.user_id === debtorUserId)) blockedReason = 'self_take_not_allowed';
  else if (days <= 0) blockedReason = 'invoice_due_too_soon';
  else if (invoice.is_fce && investor && !FCE_INVESTOR_TYPES.includes(investor.investor_type)) blockedReason = 'fce_investor_not_allowed';
  else if (invoice.is_fce && fceTransferBlocked(today, invoice.due_on, holidays)) blockedReason = 'fce_transfer_window_closed';
  return { quote, days, today, takeable: !blockedReason, blockedReason };
}

const BLOCKED_STATUS = { offer_taken: 409, offer_expired: 409, self_take_not_allowed: 403, invoice_due_too_soon: 422,
  fce_investor_not_allowed: 422, fce_transfer_window_closed: 422 };

async function loadOffer(db, offerId, lock = false) {
  return (await db.query(`SELECT id,invoice_id,status,rate_bps,fee_bps,opened_at,expires_at,closed_at FROM invoice_offers WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [offerId])).rows[0] || null;
}
async function partiesOf(db, invoice) {
  const { rows } = await db.query('SELECT id,user_id,role,cuit,legal_name,cvu,tw_customer_id,investor_type FROM factoring_parties WHERE id = ANY($1::uuid[])',
    [[invoice.issuer_party_id, invoice.debtor_party_id]]);
  return { issuer: rows.find(r => r.id === invoice.issuer_party_id), debtor: rows.find(r => r.id === invoice.debtor_party_id) };
}

function paymentsEnvironment(settings) {
  if (settings.paymentsMode === 'disabled' || !settings.twentyOneEnvironment) throw new PaymentError('factoring_payments_disabled', 503);
  return settings.twentyOneEnvironment;
}
function providerFor(environment, { client, env }) {
  const provider = client || clientForEnvironment(environment, env || process.env);
  if (!provider) throw new PaymentError('twentyone_unavailable', 503);
  return provider;
}

/** Pre-check of balance and limits (D-09). It reserves nothing: the withdrawal itself decides. */
export async function assertFundsAndLimits(provider, customerId, amounts, { insufficient }) {
  const balance = await provider.getBalanceCents(customerId);
  const total = amounts.reduce((sum, value) => sum + value, 0n);
  if (balance < total) throw new PaymentError(insufficient, 422);
  const limit = await provider.getBankWithdrawalLimit(customerId);
  for (const amount of amounts) {
    if (amount > 0n && amount < limit.minCents) throw new PaymentError('amount_below_provider_minimum', 422);
    if (amount > limit.maxCents) throw new PaymentError('amount_above_provider_maximum', 422);
  }
  if (total > limit.availableCents) throw new PaymentError('daily_limit_exceeded', 422);
}

function publicOrderStatus(order) {
  return order ? { status: order.status, error: order.provider_error || null } : null;
}

export function publicTake(take, orders = [], invoiceStatus = null) {
  const net = orders.find(o => o.purpose === 'net_to_issuer'), fee = orders.find(o => o.purpose === 'fee_to_midatopay');
  return { id: take.id, status: take.status, invoiceId: take.invoice_id, offerId: take.offer_id, takenOn: take.taken_on, days: take.days,
    rateBps: take.rate_bps, feeBps: take.fee_bps, nominal: centsToArs(BigInt(take.nominal_cents)), discount: centsToArs(BigInt(take.discount_cents)),
    advance: centsToArs(BigInt(take.advance_cents)), fee: centsToArs(BigInt(take.fee_cents)), outlay: centsToArs(BigInt(take.investor_outlay_cents)),
    gain: centsToArs(BigInt(take.investor_gain_cents)), net: publicOrderStatus(net), feeOrder: publicOrderStatus(fee), invoiceStatus,
    createdAt: take.created_at ? new Date(take.created_at).toISOString() : null };
}

async function takeOrders(db, takeId) {
  // The live orders of each purpose (a failed fee retried by an admin has a newer row).
  return (await db.query(`SELECT ${ORDER_COLUMNS} FROM factoring_orders o WHERE o.take_id=$1 AND o.purpose IN ('net_to_issuer','fee_to_midatopay')
    ORDER BY o.created_at,o.id`, [takeId])).rows.reverse()
    .filter((order, i, all) => all.findIndex(o => o.purpose === order.purpose) === i);
}

export async function listOffers(db, userId, { now, settings, holidays }) {
  const investor = await requireRole(db, userId, 'investor');
  const { rows } = await db.query(`SELECT ${INVOICE_COLUMNS},o.id AS offer_id,o.status AS offer_status,o.rate_bps,o.fee_bps,o.expires_at AS offer_expires_at,
      d.user_id AS debtor_user_id
    FROM invoice_offers o JOIN invoices i ON i.id=o.invoice_id JOIN factoring_parties d ON d.id=i.debtor_party_id
    WHERE o.status='open' AND i.status='publicada' AND o.expires_at>$1 ORDER BY o.expires_at LIMIT 50`, [iso(nowMs(now))]);
  const visible = rows.filter(r => r.issuer_user_id !== userId && r.debtor_user_id !== userId);
  const shown = await hydrateInvoices(db, visible, 'investor', settings);
  const offers = visible.map((row, i) => {
    const offer = { id: row.offer_id, status: row.offer_status, rate_bps: row.rate_bps, fee_bps: row.fee_bps, expires_at: row.offer_expires_at };
    const evaluation = evaluateOffer({ offer, invoice: row, investor, debtorUserId: row.debtor_user_id, now, holidays });
    return { offerId: row.offer_id, invoice: shown[i], expiresAt: new Date(row.offer_expires_at).toISOString(),
      quote: evaluation.quote ? { ...publicQuote(evaluation.quote), takeable: evaluation.takeable, blockedReason: evaluation.blockedReason } : null };
  });
  const takes = (await db.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.investor_user_id=$1 ORDER BY t.created_at DESC LIMIT 50`, [userId])).rows;
  const holdingsInvoices = takes.length ? (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id = ANY($1::uuid[])`, [takes.map(t => t.invoice_id)])).rows : [];
  const byId = new Map((await hydrateInvoices(db, holdingsInvoices, 'investor', settings)).map(inv => [inv.id, inv]));
  const holdings = [];
  for (const take of takes) {
    const invoice = byId.get(take.invoice_id);
    holdings.push({ takeId: take.id, invoice, take: publicTake(take, await takeOrders(db, take.id), invoice?.status || null) });
  }
  return { offers, holdings };
}

export async function quoteOffer(db, userId, offerId, { now, settings, holidays }) {
  const investor = await requireRole(db, userId, 'investor');
  const offer = await loadOffer(db, offerId);
  if (!offer) throw new PaymentError('offer_not_found', 404);
  const invoice = (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1`, [offer.invoice_id])).rows[0];
  const { issuer, debtor } = await partiesOf(db, invoice);
  const ownTake = (await db.query('SELECT 1 FROM invoice_takes WHERE offer_id=$1 AND investor_user_id=$2', [offerId, userId])).rows[0];
  // Only open offers are visible, except to the investor who took them.
  if (!ownTake && (offer.status !== 'open' || invoice.status !== 'publicada')) throw new PaymentError('offer_not_found', 404);
  if (investor.user_id === invoice.issuer_user_id || investor.user_id === debtor.user_id) throw new PaymentError('offer_not_found', 404);
  const evaluation = evaluateOffer({ offer, invoice, investor, debtorUserId: debtor.user_id, now, holidays });
  const [shown] = await hydrateInvoices(db, [invoice], 'investor', settings);
  return { offer: { id: offer.id, status: offer.status, expiresAt: new Date(offer.expires_at).toISOString(), rateBps: offer.rate_bps, feeBps: offer.fee_bps },
    invoice: shown,
    quote: evaluation.quote ? { ...publicQuote(evaluation.quote), takeable: evaluation.takeable, blockedReason: evaluation.blockedReason }
      : { days: evaluation.days, takeable: false, blockedReason: evaluation.blockedReason },
    debit: { issuerCvu: issuer.cvu, feeCvu: settings.feeCvu } };
}

function assertTakeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.expectedOutlay !== 'string')
    throw new PaymentError('invalid_body', 400);
  return translate(() => arsToCents(body.expectedOutlay));
}

async function existingTake(db, userId, key, offerId) {
  const take = (await db.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.investor_user_id=$1 AND t.idempotency_key=$2`, [userId, key])).rows[0];
  if (!take) return null;
  if (take.offer_id !== offerId) throw new PaymentError('idempotency_conflict', 409);
  return take;
}

export async function createTake(db, userId, offerId, body, idempotencyKey, { now, settings, client, env, getUser, holidays, template = ASSIGNMENT_TEMPLATE, kick }) {
  const key = assertIdempotencyKey(idempotencyKey);
  const expectedOutlay = assertTakeBody(body);
  const repeated = await existingTake(db, userId, key, offerId);
  if (repeated) return { take: publicTake(repeated, await takeOrders(db, repeated.id)), existing: true };
  const environment = paymentsEnvironment(settings);
  const investor = await requireRole(db, userId, 'investor');
  if (investor.kyc_status !== 'approved') throw new PaymentError('investor_kyc_required', 403);
  const offer = await loadOffer(db, offerId);
  if (!offer) throw new PaymentError('offer_not_found', 404);
  const invoice = (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1`, [offer.invoice_id])).rows[0];
  const { issuer, debtor } = await partiesOf(db, invoice);
  const check = (o, inv) => {
    const evaluation = evaluateOffer({ offer: o, invoice: inv, investor, debtorUserId: debtor.user_id, now, holidays });
    if (evaluation.blockedReason) throw new PaymentError(evaluation.blockedReason, BLOCKED_STATUS[evaluation.blockedReason]);
    if (evaluation.quote.investorOutlayCents !== expectedOutlay) throw new TermsChangedError(publicQuote(evaluation.quote));
    return evaluation;
  };
  const first = check(offer, invoice);
  const user = await (getUser || (async () => null))(userId);
  const wallet = primaryArcWallet(user)?.address;
  if (!wallet) throw new PaymentError('primary_wallet_required', 403);
  if (!/^\d{22}$/.test(settings.feeCvu || '')) throw new PaymentError('invalid_factoring_fee_cvu', 503);
  const provider = providerFor(environment, { client, env });
  const q = first.quote;
  await assertFundsAndLimits(provider, investor.tw_customer_id, [q.advanceCents, q.feeCents], { insufficient: 'investor_insufficient_funds' });
  let created;
  try {
    created = await inTransaction(db, async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`factoring-take-create:${userId}:${key}`]);
      const again = await existingTake(tx, userId, key, offerId);
      if (again) return { take: again, existing: true };
      const lockedInvoice = await lockInvoice(tx, offer.invoice_id);
      const lockedOffer = await loadOffer(tx, offerId, true);
      const { quote, today } = check(lockedOffer, lockedInvoice);
      const takeId = randomUUID(), at = iso(nowMs(now));
      const quoteText = publicQuote(quote);
      const terms = termsHash({ invoiceHash: lockedInvoice.invoice_hash, quote: { ...quoteText, takenOn: today, offerId, investorWallet: wallet.toLowerCase() } });
      const assignment = renderAssignment(template, { reference: newAssignmentReference(), takenOn: today,
        issuerName: issuer.legal_name, issuerCuit: formatCuit(issuer.cuit), investorName: investor.legal_name, investorCuit: formatCuit(investor.cuit),
        debtorName: debtor.legal_name, debtorCuit: formatCuit(debtor.cuit), cbteTipo: INVOICE_TYPES.get(Number(lockedInvoice.cbte_tipo)),
        ptoVta: lockedInvoice.pto_vta, cbteNro: lockedInvoice.cbte_nro, issuedOn: lockedInvoice.issued_on, dueOn: lockedInvoice.due_on,
        nominal: quoteText.nominal, days: quote.days, rateBps: quote.rateBps, advance: quoteText.advance, fee: quoteText.fee,
        outlay: quoteText.outlay, investorCvu: investor.cvu });
      await tx.query(`INSERT INTO invoice_takes(id,invoice_id,offer_id,investor_user_id,investor_party_id,investor_wallet,investor_cvu,issuer_cvu,
        fee_cvu,idempotency_key,taken_on,days,rate_bps,fee_bps,nominal_cents,discount_cents,advance_cents,fee_cents,investor_outlay_cents,
        investor_gain_cents,terms_hash,assignment_version,assignment_text,assignment_sha256,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'paying',$25)`,
      [takeId, lockedInvoice.id, offerId, userId, investor.id, wallet, investor.cvu, issuer.cvu, settings.feeCvu, key, today, quote.days,
        quote.rateBps, quote.feeBps, String(quote.nominalCents), String(quote.discountCents), String(quote.advanceCents), String(quote.feeCents),
        String(quote.investorOutlayCents), String(quote.investorGainCents), terms, assignment.version, assignment.text, assignment.sha256, at]);
      await tx.query(`UPDATE invoice_offers SET status='taken' WHERE id=$1`, [offerId]);
      await transition(tx, lockedInvoice, 'tomada', { actor: 'investor', actorUserId: userId, now, settings,
        chain: { taken: { tokenId: lockedInvoice.token_id, termsHash: terms, assignmentHash: '0x' + assignment.sha256, rateBps: quote.rateBps,
          feeBps: quote.feeBps, days: quote.days, discountCents: quote.discountCents, advanceCents: quote.advanceCents, feeCents: quote.feeCents } } });
      const orders = [['net_to_issuer', issuer.cvu, quote.advanceCents]];
      // A zero fee creates no order (D-09).
      if (quote.feeCents > 0n) orders.push(['fee_to_midatopay', settings.feeCvu, quote.feeCents]);
      for (const [purpose, destination, amount] of orders) {
        const { id, idempotencyKey: orderKey } = newOrderId();
        await tx.query(`INSERT INTO factoring_orders(id,invoice_id,take_id,purpose,environment,payer_customer_id,destination_cvu,amount_cents,
          idempotency_key,status,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$10)`,
        [id, lockedInvoice.id, takeId, purpose, environment, investor.tw_customer_id, destination, String(amount), orderKey, at]);
      }
      return { take: (await tx.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1`, [takeId])).rows[0], existing: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PaymentError('offer_taken', 409);
    throw error;
  }
  // The take is durable; a lost dispatch is picked up by the scheduled worker.
  if (!created.existing && kick) await kick().catch(() => {});
  return { take: publicTake(created.take, await takeOrders(db, created.take.id), created.existing ? null : 'tomada'), existing: created.existing };
}

export async function getTake(db, userId, takeId) {
  const take = (await db.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1 AND t.investor_user_id=$2`, [takeId, userId])).rows[0];
  if (!take) throw new PaymentError('take_not_found', 404);
  const status = (await db.query('SELECT status FROM invoices WHERE id=$1', [take.invoice_id])).rows[0].status;
  return publicTake(take, await takeOrders(db, takeId), status);
}

// ---- Execution (worker) --------------------------------------------------

async function lockTakeState(tx, takeId) {
  const take = (await tx.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1`, [takeId])).rows[0];
  const invoice = await lockInvoice(tx, take.invoice_id);
  const lockedTake = (await tx.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1 FOR UPDATE`, [takeId])).rows[0];
  return { take: lockedTake, invoice };
}

async function toManualReview(tx, take, invoice, order, reason, { now, settings }) {
  await tx.query(`UPDATE invoice_takes SET status='manual_review' WHERE id=$1 AND status='paying'`, [take.id]);
  await openReview(tx, { invoiceId: invoice.id, takeId: take.id, orderId: order?.id || null, reason, now,
    evidence: order ? { purpose: order.purpose, providerOrderId: order.provider_order_id || null } : null });
  if (invoice.status === 'pagos_en_curso') await transition(tx, invoice, 'revision_manual', { actor: 'worker', reason, now, settings });
}

/** Net and fee completed (or no fee): the invoice is ceded and the NFT transfer is queued (D-04). */
export async function completeTake(tx, take, invoice, { now, settings, actor = 'worker', actorUserId = null, reason = null }) {
  const at = iso(nowMs(now));
  const orders = (await tx.query(`SELECT provider_order_id,purpose FROM factoring_orders WHERE take_id=$1 AND status='completed' ORDER BY purpose`, [take.id])).rows;
  await tx.query(`UPDATE invoice_takes SET status='completed',completed_at=$2 WHERE id=$1`, [take.id, at]);
  await tx.query(`UPDATE invoice_offers SET status='closed',closed_at=$2 WHERE id=$1`, [take.offer_id, at]);
  return transition(tx, invoice, 'cedida', { actor, actorUserId, reason, now, settings, set: { ceded_at: at },
    chain: { cede: { tokenId: invoice.token_id, investor: take.investor_wallet,
      paymentEvidenceHash: evidenceHash({ takeId: take.id, orders: orders.map(o => [o.purpose, o.provider_order_id]) }) } } });
}

/** Net failed for good: no fee is charged and the invoice is published again with the same expiry (D-03). */
export async function reopenAfterNetFailure(tx, take, invoice, { now, settings, actor = 'worker', actorUserId = null, reason = 'net_failed' }) {
  const at = iso(nowMs(now));
  await tx.query(`UPDATE invoice_takes SET status='failed_net',failed_at=$2 WHERE id=$1`, [take.id, at]);
  await tx.query(`UPDATE factoring_orders SET status='cancelled' WHERE take_id=$1 AND purpose='fee_to_midatopay' AND status='pending' AND attempts=0`, [take.id]);
  await tx.query(`UPDATE invoice_offers SET status='open' WHERE id=$1 AND status='taken'`, [take.offer_id]);
  return transition(tx, invoice, 'publicada', { actor, actorUserId, reason, now, settings,
    chain: { published: { tokenId: invoice.token_id, detail: actor === 'admin' ? CHAIN_DETAIL.adminResolved : CHAIN_DETAIL.netFailed,
      evidenceHash: evidenceHash({ takeId: take.id, reason }) } } });
}

/**
 * One step of a take: sends or follows the net, then the fee. Runs under a
 * per-take session lock; returns the number of provider calls made.
 */
export async function processTake(db, takeId, { now, settings, client, env } = {}) {
  const outcome = await withSessionLock(db, `factoring-take:${takeId}`, async conn => {
    let calls = 0;
    for (let step = 0; step < 4; step += 1) {
      const take = (await conn.query(`SELECT ${TAKE_COLUMNS} FROM invoice_takes t WHERE t.id=$1`, [takeId])).rows[0];
      if (!take || !['paying', 'manual_review'].includes(take.status)) return calls;
      const orders = await takeOrders(conn, takeId);
      const net = orders.find(o => o.purpose === 'net_to_issuer'), fee = orders.find(o => o.purpose === 'fee_to_midatopay');
      if (!net) return calls;
      if (net.status === 'completed' && (!fee || fee.status === 'completed')) {
        await inTransaction(conn, async tx => {
          const state = await lockTakeState(tx, takeId);
          if (['pagos_en_curso', 'revision_manual'].includes(state.invoice.status) && ['paying', 'manual_review'].includes(state.take.status))
            await completeTake(tx, state.take, state.invoice, { now, settings });
        });
        return calls;
      }
      const order = net.status === 'completed' ? fee : net;
      if (!['pending', 'submitting', 'processing'].includes(order.status)) return calls;
      // Emergency stop: with payments disabled, orders never requested stay put.
      if (settings?.paymentsMode === 'disabled' && order.attempts === 0) return calls;
      if (order.purpose === 'net_to_issuer' && order.status === 'pending' && order.attempts === 0) {
        // tomada → pagos_en_curso before the first call to 21 Millions.
        await inTransaction(conn, async tx => {
          const state = await lockTakeState(tx, takeId);
          if (state.invoice.status === 'tomada') await transition(tx, state.invoice, 'pagos_en_curso', { actor: 'worker', now, settings });
        });
      }
      const executed = await executeOrder(conn, order.id, { now, settings, client, env });
      if (!executed) return calls;
      calls += 1;
      const decision = await inTransaction(conn, async tx => {
        const state = await lockTakeState(tx, takeId);
        const current = await loadOrder(tx, order.id, true);
        const result = await recordOrderResult(tx, current, executed.result, { now });
        if (order.purpose === 'net_to_issuer') {
          if (result === 'failed') await reopenAfterNetFailure(tx, state.take, state.invoice, { now, settings });
          else if (result === 'review') await toManualReview(tx, state.take, state.invoice, current, executed.result.outcome === 'mismatch' ? 'net_mismatch' : 'net_uncertain', { now, settings });
        } else if (result === 'failed') {
          await tx.query(`UPDATE invoice_takes SET status='manual_review' WHERE id=$1 AND status='paying'`, [takeId]);
          await toManualReview(tx, state.take, state.invoice, current, 'fee_failed', { now, settings });
        } else if (result === 'review') {
          await toManualReview(tx, state.take, state.invoice, current, executed.result.outcome === 'mismatch' ? 'fee_mismatch' : 'fee_retries_exhausted', { now, settings });
        }
        if (result === 'configuration') await openReview(tx, { invoiceId: state.invoice.id, takeId, orderId: current.id, reason: 'provider_configuration', now });
        return result;
      });
      if (decision !== 'completed') return calls;
    }
    return calls;
  });
  return outcome.locked ? outcome.value : 0;
}

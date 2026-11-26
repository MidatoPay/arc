import { randomBytes, randomUUID } from 'node:crypto';
import { NETWORK } from '../../../src/network.js';
import { validateInvoiceInput, cuitHint, INVOICE_TYPES } from '../../../src/invoiceQr.js';
import { argentinaDate, addDays, centsToArs } from '../../../src/invoiceCession.js';
import { PaymentError } from './paymentCore.js';
import { requireRole } from './factoringAccess.js';
import { assertTransition, chainEventsFor, CHAIN_DETAIL } from './factoringStates.js';
import { invoiceCommitment, invoiceTokenId, evidenceHash, chainDate } from './factoringHashes.js';
import { INVOICE_COLUMNS, assertIdempotencyKey, inTransaction, iso, isUniqueViolation, nowMs, translate } from './factoringDb.js';
// Invoice lifecycle without money (plan T8): every operation locks the invoice
// row, re-checks its state, and writes the state change, one audit row per
// transition and its on-chain events in the same transaction.

const ALLOWED_SET = new Set(['sent_at', 'token_id', 'issuer_wallet', 'framework_sha256', 'accepted_at', 'acceptance_kind',
  'rejected_at', 'published_at', 'ceded_at', 'collected_at', 'defaulted_at']);

export async function lockInvoice(client, invoiceId) {
  return (await client.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1 FOR UPDATE`, [invoiceId])).rows[0] || null;
}

/** Enqueue on-chain events with seq = max(seq)+1 per invoice (caller holds the invoice lock). */
export async function enqueueChainEvents(client, invoiceId, events, { now, settings }) {
  for (const event of events) {
    await client.query(`INSERT INTO factoring_chain_events(invoice_id,seq,kind,args,network,registry_address,next_attempt_at,created_at)
      VALUES($1,(SELECT COALESCE(max(seq),0)+1 FROM factoring_chain_events WHERE invoice_id=$1),$2,$3,$4,$5,$6,$6)`,
    [invoiceId, event.kind, JSON.stringify(event.args), NETWORK.network, settings?.registryAddress || null, iso(nowMs(now))]);
  }
}

/** UPDATE + audit + chain queue. Fails with invalid_transition if the row moved meanwhile. */
export async function transition(client, invoice, to, { actor, actorUserId = null, reason = null, chain = {}, set = {}, now, settings }) {
  assertTransition(invoice.status, to, actor);
  const events = chainEventsFor(invoice.status, to, chain);
  const at = iso(nowMs(now));
  const columns = Object.keys(set);
  for (const column of columns) if (!ALLOWED_SET.has(column)) throw new Error(`transition: column not allowed ${column}`);
  const assignments = columns.map((column, i) => `${column}=$${i + 4}`);
  const result = await client.query(`UPDATE invoices SET status=$2,updated_at=$3${assignments.length ? ',' + assignments.join(',') : ''}
    WHERE id=$1 AND status=$${columns.length + 4} RETURNING id`,
  [invoice.id, to, at, ...columns.map(column => set[column]), invoice.status]);
  if (!result.rowCount) throw new PaymentError('invalid_transition', 409);
  await client.query(`INSERT INTO factoring_audit(invoice_id,from_status,to_status,actor,actor_user_id,reason,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [invoice.id, invoice.status, to, actor, actorUserId, reason, at]);
  await enqueueChainEvents(client, invoice.id, events, { now, settings });
  return { ...invoice, ...set, status: to, updated_at: new Date(at) };
}

function canonicalFields(invoice) {
  return { source: invoice.source, debtorPartyId: invoice.debtor_party_id, cbteTipo: Number(invoice.cbte_tipo),
    ptoVta: Number(invoice.pto_vta), cbteNro: Number(invoice.cbte_nro), issuedOn: invoice.issued_on, dueOn: invoice.due_on,
    nominalCents: String(invoice.nominal_cents) };
}

async function findDebtor(db, valid, issuer) {
  const { rows: [debtor] } = valid.source === 'form'
    ? await db.query(`SELECT id,user_id,cuit,legal_name FROM factoring_parties WHERE id=$1 AND role='debtor' AND enabled`, [valid.debtorId])
    : await db.query(`SELECT id,user_id,cuit,legal_name FROM factoring_parties WHERE cuit=$1 AND role='debtor' AND enabled`, [valid.receiverCuit]);
  if (!debtor || debtor.user_id === issuer.user_id || debtor.cuit === issuer.cuit) throw new PaymentError('debtor_not_listed', 422);
  return debtor;
}

export async function createInvoice(db, userId, input, idempotencyKey, { now, settings }) {
  const key = assertIdempotencyKey(idempotencyKey);
  const todayIso = argentinaDate(nowMs(now));
  const valid = translate(() => validateInvoiceInput(input, { todayIso }));
  const issuer = await requireRole(db, userId, 'issuer');
  if (valid.source === 'qr' && valid.issuerCuit !== issuer.cuit) throw new PaymentError('issuer_cuit_mismatch', 422);
  const debtor = await findDebtor(db, valid, issuer);
  if (settings.maxNominalCents && valid.nominalCents > settings.maxNominalCents) throw new PaymentError('nominal_above_pilot_cap', 422);
  const wanted = { source: valid.source, debtorPartyId: debtor.id, cbteTipo: valid.cbteTipo, ptoVta: valid.ptoVta,
    cbteNro: valid.cbteNro, issuedOn: valid.issuedOn, dueOn: valid.dueOn, nominalCents: String(valid.nominalCents) };
  try {
    return await inTransaction(db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`factoring-invoice-create:${userId}:${key}`]);
      const existing = (await client.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.issuer_user_id=$1 AND i.idempotency_key=$2`,
        [userId, key])).rows[0];
      if (existing) {
        if (JSON.stringify(canonicalFields(existing)) !== JSON.stringify(wanted)) throw new PaymentError('idempotency_conflict', 409);
        return { invoice: existing, existing: true };
      }
      const duplicate = (await client.query(`SELECT 1 FROM invoices WHERE issuer_cuit=$1 AND cbte_tipo=$2 AND pto_vta=$3 AND cbte_nro=$4`,
        [issuer.cuit, valid.cbteTipo, valid.ptoVta, valid.cbteNro])).rows[0];
      if (duplicate) throw new PaymentError('invoice_duplicate', 409);
      const id = randomUUID(), salt = randomBytes(32).toString('hex'), at = iso(nowMs(now));
      const invoiceHash = invoiceCommitment({ salt, fields: { v: 1, issuerCuit: issuer.cuit, debtorCuit: debtor.cuit,
        cbteTipo: valid.cbteTipo, ptoVta: valid.ptoVta, cbteNro: valid.cbteNro, issuedOn: valid.issuedOn, dueOn: valid.dueOn,
        nominalCents: valid.nominalCents, currency: 'PES', authCode: valid.authCode } });
      assertTransition(null, 'cargada', 'issuer');
      await client.query(`INSERT INTO invoices(id,issuer_user_id,issuer_party_id,debtor_party_id,idempotency_key,source,simulated,is_fce,
        issuer_cuit,debtor_cuit,cbte_tipo,pto_vta,cbte_nro,issued_on,due_on,nominal_cents,auth_mode,auth_code,qr_payload,
        invoice_salt,invoice_hash,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)`,
      [id, userId, issuer.id, debtor.id, key, valid.source, valid.simulated, valid.isFce, issuer.cuit, debtor.cuit, valid.cbteTipo,
        valid.ptoVta, valid.cbteNro, valid.issuedOn, valid.dueOn, String(valid.nominalCents), valid.authMode, valid.authCode,
        valid.qrPayload ? JSON.stringify(valid.qrPayload) : null, salt, invoiceHash, at]);
      await client.query(`INSERT INTO factoring_audit(invoice_id,from_status,to_status,actor,actor_user_id,created_at)
        VALUES($1,NULL,'cargada','issuer',$2,$3)`, [id, userId, at]);
      return { invoice: await lockInvoice(client, id), existing: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PaymentError('invoice_duplicate', 409);
    throw error;
  }
}

export async function sendInvoice(db, userId, invoiceId, { now, settings, issuerWallet }) {
  if (!settings.frameworkSha256) throw new PaymentError('factoring_framework_missing', 503);
  return inTransaction(db, async client => {
    const invoice = await lockInvoice(client, invoiceId);
    if (!invoice || invoice.issuer_user_id !== userId) throw new PaymentError('invoice_not_found', 404);
    if (!/^0x[0-9a-fA-F]{40}$/.test(issuerWallet || '')) throw new PaymentError('primary_wallet_required', 403);
    const tokenId = invoiceTokenId(invoice.id), at = iso(nowMs(now));
    return transition(client, invoice, 'enviada', { actor: 'issuer', actorUserId: userId, now, settings,
      set: { sent_at: at, token_id: tokenId, issuer_wallet: issuerWallet, framework_sha256: settings.frameworkSha256 },
      chain: { register: { tokenId, issuer: issuerWallet, invoiceHash: invoice.invoice_hash, frameworkHash: '0x' + settings.frameworkSha256,
        nominalCents: invoice.nominal_cents, issueDate: chainDate(invoice.issued_on), dueDate: chainDate(invoice.due_on),
        fce: invoice.is_fce, simulated: invoice.simulated } } });
  });
}

export function tacitAcceptanceOn(invoice, settings) {
  return addDays(invoice.issued_on, settings.acceptanceDays);
}
function tacitDue(invoice, settings, now) {
  return argentinaDate(nowMs(now)) >= tacitAcceptanceOn(invoice, settings);
}

/** enviada → aceptada → publicada and a new 72-hour offer with frozen rate and fee. */
async function acceptAndPublish(client, invoice, kind, { actor, actorUserId, now, settings }) {
  const ms = nowMs(now), at = iso(ms), expiresAt = iso(ms + settings.offerHours * 3_600_000), offerId = randomUUID();
  const accepted = await transition(client, invoice, 'aceptada', { actor, actorUserId, now, settings, reason: kind,
    set: { accepted_at: at, acceptance_kind: kind },
    chain: { accepted: { tokenId: invoice.token_id, detail: kind === 'express' ? CHAIN_DETAIL.express : CHAIN_DETAIL.tacit,
      evidenceHash: evidenceHash({ acceptance: kind, at }) } } });
  await client.query(`INSERT INTO invoice_offers(id,invoice_id,status,rate_bps,fee_bps,opened_at,expires_at)
    VALUES($1,$2,'open',$3,$4,$5,$6)`, [offerId, invoice.id, settings.rateBps, settings.feeBps, at, expiresAt]);
  return transition(client, accepted, 'publicada', { actor, actorUserId, now, settings, set: { published_at: at },
    chain: { published: { tokenId: invoice.token_id, detail: CHAIN_DETAIL.none, evidenceHash: evidenceHash({ offerId, expiresAt }) } } });
}

async function lockOwedInvoice(client, userId, invoiceId) {
  const invoice = await lockInvoice(client, invoiceId);
  // Drafts are invisible to the debtor until sent.
  if (!invoice || invoice.status === 'cargada') throw new PaymentError('invoice_not_found', 404);
  const debtor = (await client.query(`SELECT 1 FROM factoring_parties WHERE id=$1 AND user_id=$2 AND role='debtor'`,
    [invoice.debtor_party_id, userId])).rows[0];
  if (!debtor) throw new PaymentError('invoice_not_found', 404);
  return invoice;
}

export async function acceptInvoice(db, userId, invoiceId, { now, settings }) {
  return inTransaction(db, async client => {
    const invoice = await lockOwedInvoice(client, userId, invoiceId);
    if (invoice.status !== 'enviada') throw new PaymentError('invalid_transition', 409);
    return acceptAndPublish(client, invoice, tacitDue(invoice, settings, now) ? 'tacit' : 'express',
      { actor: 'debtor', actorUserId: userId, now, settings });
  });
}

export async function rejectInvoice(db, userId, invoiceId, { now, settings }) {
  const result = await inTransaction(db, async client => {
    const invoice = await lockOwedInvoice(client, userId, invoiceId);
    if (invoice.status !== 'enviada') throw new PaymentError('invalid_transition', 409);
    // Past the tacit deadline the invoice is already accepted: record it, then refuse the rejection.
    if (tacitDue(invoice, settings, now)) return { tacit: await acceptAndPublish(client, invoice, 'tacit', { actor: 'worker', now, settings }) };
    return { invoice: await transition(client, invoice, 'rechazada', { actor: 'debtor', actorUserId: userId, now, settings,
      set: { rejected_at: iso(nowMs(now)) },
      chain: { rejected: { tokenId: invoice.token_id, detail: CHAIN_DETAIL.none, evidenceHash: evidenceHash({ rejected: invoice.id }) } } }) };
  });
  if (result.tacit) throw new PaymentError('already_accepted_tacitly', 409);
  return result.invoice;
}

export async function applyTacitAcceptances(db, { now, settings, limit = 50 }) {
  const cutoff = addDays(argentinaDate(nowMs(now)), -settings.acceptanceDays);
  const { rows } = await db.query(`SELECT id FROM invoices WHERE status='enviada' AND issued_on<=$1::date ORDER BY issued_on,id LIMIT $2`,
    [cutoff, limit]);
  let applied = 0;
  for (const { id } of rows) {
    const done = await inTransaction(db, async client => {
      const invoice = await lockInvoice(client, id);
      if (invoice?.status !== 'enviada' || !tacitDue(invoice, settings, now)) return false;
      await acceptAndPublish(client, invoice, 'tacit', { actor: 'worker', now, settings });
      return true;
    });
    if (done) applied += 1;
  }
  return applied;
}

export async function expireOffers(db, { now, settings, limit = 50 }) {
  const at = iso(nowMs(now));
  const { rows } = await db.query(`SELECT o.id,o.invoice_id FROM invoice_offers o JOIN invoices i ON i.id=o.invoice_id
    WHERE o.status='open' AND o.expires_at<=$1 AND i.status='publicada' ORDER BY o.expires_at LIMIT $2`, [at, limit]);
  let expired = 0;
  for (const offer of rows) {
    const done = await inTransaction(db, async client => {
      const invoice = await lockInvoice(client, offer.invoice_id);
      const current = (await client.query(`SELECT id,status,expires_at FROM invoice_offers WHERE id=$1 FOR UPDATE`, [offer.id])).rows[0];
      if (invoice?.status !== 'publicada' || current?.status !== 'open' || new Date(current.expires_at).getTime() > nowMs(now)) return false;
      await client.query(`UPDATE invoice_offers SET status='expired',closed_at=$2 WHERE id=$1`, [offer.id, at]);
      await transition(client, invoice, 'oferta_vencida', { actor: 'worker', now, settings,
        chain: { offer_expired: { tokenId: invoice.token_id, detail: CHAIN_DETAIL.none, evidenceHash: evidenceHash({ offerId: offer.id }) } } });
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}

const LIVE_PAYMENT = `SELECT 1 FROM factoring_orders f WHERE f.invoice_id=i.id AND f.purpose='nominal_to_investor' AND f.status NOT IN ('failed','cancelled')`;
export async function markDefaults(db, { now, settings, limit = 50 }) {
  const today = argentinaDate(nowMs(now));
  // Default from the day after the due date (due_on + 1 <= today).
  const { rows } = await db.query(`SELECT i.id FROM invoices i WHERE i.status='cedida' AND i.due_on<$1::date
    AND NOT EXISTS (${LIVE_PAYMENT}) ORDER BY i.due_on,i.id LIMIT $2`, [today, limit]);
  let defaulted = 0;
  for (const { id } of rows) {
    const done = await inTransaction(db, async client => {
      const invoice = await lockInvoice(client, id);
      if (invoice?.status !== 'cedida' || !(today >= addDays(invoice.due_on, 1))) return false;
      if ((await client.query(`SELECT 1 FROM invoices i WHERE i.id=$1 AND EXISTS (${LIVE_PAYMENT})`, [id])).rows[0]) return false;
      await transition(client, invoice, 'en_mora', { actor: 'worker', now, settings, set: { defaulted_at: iso(nowMs(now)) },
        chain: { defaulted: { tokenId: invoice.token_id, detail: CHAIN_DETAIL.none, evidenceHash: evidenceHash({ defaulted: id, on: today }) } } });
      return true;
    });
    if (done) defaulted += 1;
  }
  return defaulted;
}

// ---- Read models ---------------------------------------------------------

function nftStatus(events, settings) {
  if (!settings?.nftEnabled) return { status: 'disabled', txHash: null, explorerUrl: null };
  if (!events?.length) return { status: 'pending', txHash: null, explorerUrl: null };
  if (events.some(e => e.status === 'manual_review')) return { status: 'review', txHash: null, explorerUrl: null };
  const confirmed = events.filter(e => e.status === 'confirmed' && e.tx_hash);
  const last = confirmed.at(-1);
  return { status: confirmed.length === events.length ? 'confirmed' : 'pending', txHash: last?.tx_hash || null,
    explorerUrl: last ? `${NETWORK.explorer}/tx/${last.tx_hash}` : null };
}

const timestamp = value => (value ? new Date(value).toISOString() : null);

/** Public shape of an invoice per viewer (plan 7.2). Never exposes salts, hashes inputs or other parties' CUITs. */
export function publicInvoice(row, view, rel = {}) {
  const { settings } = rel;
  const base = {
    id: row.id, status: row.status, source: row.source, simulated: row.simulated, isFce: row.is_fce,
    cbte: { tipo: Number(row.cbte_tipo), letra: INVOICE_TYPES.get(Number(row.cbte_tipo)) || null, ptoVta: Number(row.pto_vta), nro: Number(row.cbte_nro) },
    issuedOn: row.issued_on, dueOn: row.due_on, nominal: centsToArs(BigInt(row.nominal_cents)),
    tacitAcceptanceOn: settings ? tacitAcceptanceOn(row, settings) : null,
    offer: rel.offer ? { expiresAt: timestamp(rel.offer.expires_at), status: rel.offer.status } : null,
    nft: { tokenId: row.token_id || null, ...nftStatus(rel.chain, settings) },
    createdAt: timestamp(row.created_at),
  };
  if (view === 'issuer') {
    return { ...base, debtor: { legalName: rel.debtor?.legal_name || null, cuit: row.debtor_cuit },
      take: rel.take ? { advance: centsToArs(BigInt(rel.take.advance_cents)), discount: centsToArs(BigInt(rel.take.discount_cents)),
        days: rel.take.days, status: rel.take.status } : null };
  }
  if (view === 'debtor') {
    const ceded = ['cedida', 'en_mora', 'cobrada'].includes(row.status);
    return { ...base, issuer: { legalName: rel.issuer?.legal_name || null },
      payTo: ceded && rel.take ? { legalName: rel.investor?.legal_name || null, cvu: rel.take.investor_cvu } : null,
      canPayFrom: ceded ? row.due_on : null,
      payment: rel.payment ? { status: rel.payment.status, error: rel.payment.provider_error || null } : null };
  }
  if (view === 'investor') return { ...base, issuer: { legalName: rel.issuer?.legal_name || null }, debtor: { legalName: rel.debtor?.legal_name || null } };
  throw new Error('publicInvoice: unknown view');
}

/** Loads the related rows publicInvoice needs, in a few batched queries. */
export async function hydrateInvoices(db, rows, view, settings) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const partyIds = [...new Set(rows.flatMap(r => [r.issuer_party_id, r.debtor_party_id]))];
  const parties = new Map((await db.query('SELECT id,legal_name FROM factoring_parties WHERE id = ANY($1::uuid[])', [partyIds])).rows.map(p => [p.id, p]));
  const offers = new Map((await db.query(`SELECT DISTINCT ON (invoice_id) invoice_id,id,status,expires_at FROM invoice_offers
    WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id,opened_at DESC`, [ids])).rows.map(o => [o.invoice_id, o]));
  const takes = new Map((await db.query(`SELECT DISTINCT ON (t.invoice_id) t.invoice_id,t.status,t.days,t.advance_cents::text AS advance_cents,
    t.discount_cents::text AS discount_cents,t.investor_cvu,t.investor_party_id FROM invoice_takes t
    WHERE t.invoice_id = ANY($1::uuid[]) AND t.status IN ('paying','completed','manual_review') ORDER BY t.invoice_id,t.created_at DESC`, [ids])).rows
    .map(t => [t.invoice_id, t]));
  const investorIds = [...new Set([...takes.values()].map(t => t.investor_party_id))];
  const investors = new Map(investorIds.length ? (await db.query('SELECT id,legal_name FROM factoring_parties WHERE id = ANY($1::uuid[])', [investorIds])).rows.map(p => [p.id, p]) : []);
  const payments = new Map((await db.query(`SELECT DISTINCT ON (invoice_id) invoice_id,status,provider_error FROM factoring_orders
    WHERE invoice_id = ANY($1::uuid[]) AND purpose='nominal_to_investor' ORDER BY invoice_id,created_at DESC`, [ids])).rows.map(p => [p.invoice_id, p]));
  const chain = new Map();
  for (const event of (await db.query(`SELECT invoice_id,seq,status,tx_hash FROM factoring_chain_events WHERE invoice_id = ANY($1::uuid[])
    ORDER BY invoice_id,seq`, [ids])).rows) chain.set(event.invoice_id, [...(chain.get(event.invoice_id) || []), event]);
  return rows.map(row => {
    const take = takes.get(row.id);
    return publicInvoice(row, view, { settings, issuer: parties.get(row.issuer_party_id), debtor: parties.get(row.debtor_party_id),
      offer: ['publicada', 'tomada', 'pagos_en_curso', 'oferta_vencida'].includes(row.status) ? offers.get(row.id) : null,
      take, investor: take ? investors.get(take.investor_party_id) : null, payment: payments.get(row.id), chain: chain.get(row.id) });
  });
}

export async function listInvoices(db, userId, view, { settings }) {
  if (view === 'issued') {
    const { rows } = await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.issuer_user_id=$1 ORDER BY i.created_at DESC LIMIT 50`, [userId]);
    return hydrateInvoices(db, rows, 'issuer', settings);
  }
  if (view === 'owed') {
    // A debtor only sees invoices already sent to them.
    const { rows } = await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN factoring_parties p ON p.id=i.debtor_party_id
      WHERE p.user_id=$1 AND p.role='debtor' AND i.status<>'cargada' ORDER BY i.created_at DESC LIMIT 50`, [userId]);
    return hydrateInvoices(db, rows, 'debtor', settings);
  }
  throw new PaymentError('invalid_view', 400);
}

export async function getInvoice(db, userId, invoiceId, { settings }) {
  const row = (await db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id=$1`, [invoiceId])).rows[0];
  if (!row) throw new PaymentError('invoice_not_found', 404);
  let view = null;
  if (row.issuer_user_id === userId) view = 'issuer';
  else if (row.status !== 'cargada' && (await db.query(`SELECT 1 FROM factoring_parties WHERE id=$1 AND user_id=$2 AND role='debtor'`,
    [row.debtor_party_id, userId])).rows[0]) view = 'debtor';
  if (!view) throw new PaymentError('invoice_not_found', 404);
  const [invoice] = await hydrateInvoices(db, [row], view, settings);
  const timeline = (await db.query(`SELECT to_status,created_at FROM factoring_audit WHERE invoice_id=$1 ORDER BY id`, [invoiceId])).rows
    .map(a => ({ status: a.to_status, at: timestamp(a.created_at) }));
  return { invoice, timeline, view };
}

export async function listDebtors(db, userId) {
  const { rows } = await db.query(`SELECT id,legal_name,cuit FROM factoring_parties WHERE role='debtor' AND enabled AND user_id<>$1
    ORDER BY legal_name,id`, [userId]);
  return rows.map(r => ({ id: r.id, legalName: r.legal_name, cuitHint: cuitHint(r.cuit) }));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, WALLETS, CUITS, CVUS, fiscalQr } from './factoring-fixtures.js';
import { factoringSettings } from '../netlify/functions/lib/factoringConfig.js';
import { createInvoice, sendInvoice, acceptInvoice, rejectInvoice, applyTacitAcceptances, expireOffers, markDefaults,
  listInvoices, getInvoice, listDebtors } from '../netlify/functions/lib/factoringService.js';

const settings = factoringSettings(pilotEnv());
const code = expected => error => { assert.equal(error.code, expected); return true; };

async function setup(t) {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock();
  let n = 0;
  const create = (extra = {}, user = USERS.issuer) => createInvoice(db, user, formInvoice(parties.debtor, { cbteNro: ++n + 100, ...extra }), randomUUID(), { now, settings });
  const sent = async (extra) => {
    const { invoice } = await create(extra);
    return sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
  };
  const status = async id => (await db.query('SELECT status FROM invoices WHERE id=$1', [id])).rows[0].status;
  return { db, parties, now, create, sent, status };
}

test('express cycle: cargada → enviada → publicada with audit and an ordered, anonymous chain queue', async t => {
  const { db, now, create, status } = await setup(t);
  const { invoice } = await create();
  assert.equal(invoice.status, 'cargada');
  await assert.rejects(() => sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: null }), code('primary_wallet_required'));
  await assert.rejects(() => sendInvoice(db, USERS.issuer, invoice.id, { now, settings: { ...settings, frameworkSha256: null }, issuerWallet: WALLETS.issuer }),
    code('factoring_framework_missing'));
  await assert.rejects(() => acceptInvoice(db, USERS.debtor, invoice.id, { now, settings }), code('invoice_not_found'));
  const sent = await sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
  assert.equal(sent.status, 'enviada');
  assert.match(sent.token_id, /^0x[0-9a-f]{64}$/);
  await assert.rejects(() => sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer }), code('invalid_transition'));
  const published = await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
  assert.equal(published.status, 'publicada');
  assert.equal(published.acceptance_kind, 'express');
  const offer = (await db.query('SELECT status,rate_bps,fee_bps,opened_at,expires_at FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0];
  assert.equal(offer.status, 'open'); assert.equal(offer.rate_bps, 3500); assert.equal(offer.fee_bps, 250);
  assert.equal(new Date(offer.expires_at) - new Date(offer.opened_at), 72 * 3_600_000);
  assert.equal(new Date(offer.opened_at).getTime(), now());
  const audit = (await db.query('SELECT from_status,to_status,actor FROM factoring_audit WHERE invoice_id=$1 ORDER BY id', [invoice.id])).rows;
  assert.deepEqual(audit.map(a => `${a.from_status}->${a.to_status}:${a.actor}`),
    ['null->cargada:issuer', 'cargada->enviada:issuer', 'enviada->aceptada:debtor', 'aceptada->publicada:debtor']);
  const chain = (await db.query('SELECT seq,kind,status,args FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [invoice.id])).rows;
  assert.deepEqual(chain.map(e => `${e.seq}:${e.kind}:${e.status}`), ['1:register:pending', '2:accepted:pending', '3:published:pending']);
  assert.equal(chain[0].args.issuer, WALLETS.issuer);
  assert.equal(chain[0].args.simulated, true);
  const text = JSON.stringify(chain);
  for (const secret of [CUITS.issuer, CUITS.debtor, 'Emisora', 'Deudora', CVUS.issuer]) assert.ok(!text.includes(secret), secret);
  assert.equal(await status(invoice.id), 'publicada');
});

test('tacit acceptance happens on day 21 from issue, not on day 20', async t => {
  const { db, now, sent, status } = await setup(t);
  const invoice = await sent();
  now.set('2026-12-10T15:00:00Z'); // day 20 in Argentina
  assert.equal(await applyTacitAcceptances(db, { now, settings }), 0);
  now.set('2026-12-11T02:59:59Z'); // still 10/12 in Argentina
  assert.equal(await applyTacitAcceptances(db, { now, settings }), 0);
  now.set('2026-12-11T03:00:00Z');
  assert.equal(await applyTacitAcceptances(db, { now, settings }), 1);
  assert.equal(await status(invoice.id), 'publicada');
  assert.equal((await db.query('SELECT acceptance_kind FROM invoices WHERE id=$1', [invoice.id])).rows[0].acceptance_kind, 'tacit');
  const actors = (await db.query('SELECT actor FROM factoring_audit WHERE invoice_id=$1 ORDER BY id', [invoice.id])).rows.map(r => r.actor);
  assert.deepEqual(actors.slice(-2), ['worker', 'worker']);
  assert.equal(await applyTacitAcceptances(db, { now, settings }), 0);
  // An express acceptance after the deadline is recorded as tacit.
  const late = await sent({ cbteNro: 900 });
  assert.equal((await acceptInvoice(db, USERS.debtor, late.id, { now, settings })).acceptance_kind, 'tacit');
});

test('rejection works before the deadline and turns into the tacit acceptance after it', async t => {
  const { db, now, sent, status } = await setup(t);
  const early = await sent();
  assert.equal((await rejectInvoice(db, USERS.debtor, early.id, { now, settings })).status, 'rechazada');
  await assert.rejects(() => acceptInvoice(db, USERS.debtor, early.id, { now, settings }), code('invalid_transition'));
  const late = await sent();
  now.set('2026-12-11T12:00:00Z');
  await assert.rejects(() => rejectInvoice(db, USERS.debtor, late.id, { now, settings }), code('already_accepted_tacitly'));
  assert.equal(await status(late.id), 'publicada');
  const kinds = (await db.query('SELECT kind FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [early.id])).rows.map(r => r.kind);
  assert.deepEqual(kinds, ['register', 'rejected']);
});

test('the offer expires at exactly 72 hours', async t => {
  const { db, now, sent, status } = await setup(t);
  const invoice = await sent();
  await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
  now.advance({ hours: 72, seconds: -1 });
  assert.equal(await expireOffers(db, { now, settings }), 0);
  now.advance({ seconds: 1 });
  assert.equal(await expireOffers(db, { now, settings }), 1);
  assert.equal(await status(invoice.id), 'oferta_vencida');
  assert.equal((await db.query('SELECT status FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0].status, 'expired');
  assert.equal(await expireOffers(db, { now, settings }), 0);
});

test('two concurrent acceptances leave a single offer', async t => {
  const { db, now, sent } = await setup(t);
  const invoice = await sent();
  const results = await Promise.allSettled([acceptInvoice(db, USERS.debtor, invoice.id, { now, settings }),
    acceptInvoice(db, USERS.debtor, invoice.id, { now, settings })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'invalid_transition');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0].n, 1);
});

async function forceCeded(db, invoiceId) {
  const offer = (await db.query('SELECT id FROM invoice_offers WHERE invoice_id=$1', [invoiceId])).rows[0].id;
  const take = randomUUID();
  const investor = (await db.query("SELECT id FROM factoring_parties WHERE user_id=$1 AND role='investor'", [USERS.investor])).rows[0].id;
  await db.query(`INSERT INTO invoice_takes(id,invoice_id,offer_id,investor_user_id,investor_party_id,investor_wallet,investor_cvu,issuer_cvu,
    fee_cvu,idempotency_key,taken_on,days,rate_bps,fee_bps,nominal_cents,discount_cents,advance_cents,fee_cents,investor_outlay_cents,
    investor_gain_cents,terms_hash,assignment_version,assignment_text,assignment_sha256,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-11-25',30,3500,250,1000000,27963,972037,699,972736,27264,$11,'v0','x',$12,'completed')`,
  [take, invoiceId, offer, USERS.investor, investor, WALLETS.investor, CVUS.investor, CVUS.issuer, CVUS.fee, randomUUID(), '0x' + 'c'.repeat(64), 'd'.repeat(64)]);
  await db.query("UPDATE invoice_offers SET status='closed' WHERE id=$1", [offer]);
  await db.query("UPDATE invoices SET status='cedida',ceded_at=now() WHERE id=$1", [invoiceId]);
  return take;
}

test('default starts the day after the due date and never with a live payment order', async t => {
  const { db, now, sent, status } = await setup(t);
  const a = await sent({ dueOn: '2026-12-25' }), b = await sent({ dueOn: '2026-12-25' });
  for (const invoice of [a, b]) await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
  await forceCeded(db, a.id);
  const takeB = await forceCeded(db, b.id);
  await db.query(`INSERT INTO factoring_orders(id,invoice_id,take_id,purpose,environment,payer_customer_id,destination_cvu,amount_cents,
    idempotency_key,requested_by,client_key,status) VALUES($1,$2,$3,'nominal_to_investor','simulated','cus_debtor',$4,1000000,$5,$6,$7,'processing')`,
  [randomUUID(), b.id, takeB, CVUS.investor, 'midatopay-factoring-x', USERS.debtor, randomUUID()]);
  now.set('2026-12-26T02:59:59Z'); // still 25/12 in Argentina: due day
  assert.equal(await markDefaults(db, { now, settings }), 0);
  now.set('2026-12-26T03:00:00Z');
  assert.equal(await markDefaults(db, { now, settings }), 1);
  assert.equal(await status(a.id), 'en_mora');
  assert.equal(await status(b.id), 'cedida');
  const last = (await db.query('SELECT kind FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq DESC LIMIT 1', [a.id])).rows[0];
  assert.equal(last.kind, 'defaulted');
});

test('other users get 404, never 403, and creation rules hold', async t => {
  const { db, parties, now, create, sent } = await setup(t);
  const invoice = await sent();
  await assert.rejects(() => sendInvoice(db, USERS.issuer2, invoice.id, { now, settings, issuerWallet: WALLETS.issuer }), code('invoice_not_found'));
  await assert.rejects(() => acceptInvoice(db, USERS.investor, invoice.id, { now, settings }), code('invoice_not_found'));
  await assert.rejects(() => rejectInvoice(db, USERS.issuer, invoice.id, { now, settings }), code('invoice_not_found'));
  await assert.rejects(() => getInvoice(db, USERS.issuer2, invoice.id, { settings }), code('invoice_not_found'));
  await assert.rejects(() => getInvoice(db, USERS.investor, invoice.id, { settings }), code('invoice_not_found'));
  assert.equal((await getInvoice(db, USERS.debtor, invoice.id, { settings })).view, 'debtor');
  assert.deepEqual((await listInvoices(db, USERS.issuer2, 'issued', { settings })), []);
  // The debtor does not see invoices that were never sent.
  const draft = (await create()).invoice;
  assert.ok(!(await listInvoices(db, USERS.debtor, 'owed', { settings })).some(i => i.id === draft.id));
  await assert.rejects(() => getInvoice(db, USERS.debtor, draft.id, { settings }), code('invoice_not_found'));

  // Idempotency: same key and body returns the same invoice; another body conflicts.
  const key = randomUUID(), body = formInvoice(parties.debtor, { cbteNro: 5000 });
  const first = await createInvoice(db, USERS.issuer, body, key, { now, settings });
  const again = await createInvoice(db, USERS.issuer, body, key, { now, settings });
  assert.equal(again.invoice.id, first.invoice.id); assert.equal(again.existing, true);
  await assert.rejects(() => createInvoice(db, USERS.issuer, { ...body, nominal: '1.00' }, key, { now, settings }), code('idempotency_conflict'));
  await assert.rejects(() => createInvoice(db, USERS.issuer, body, 'not-a-uuid', { now, settings }), code('invalid_idempotency_key'));
  await assert.rejects(() => createInvoice(db, USERS.issuer, body, randomUUID(), { now, settings }), code('invoice_duplicate'));
  await assert.rejects(() => create({ debtorId: parties.issuer }), code('debtor_not_listed'));
  await assert.rejects(() => createInvoice(db, USERS.issuer, formInvoice(parties.debtor, { cbteNro: 7000, nominal: '10000.01' }), randomUUID(),
    { now, settings: { ...settings, maxNominalCents: 1000000n } }), code('nominal_above_pilot_cap'));
  await assert.rejects(() => create({}, USERS.investor), code('factoring_role_required'));
  await assert.rejects(() => create({ nominal: '0' }), code('invalid_nominal'));

  // QR invoices: the QR issuer must be the registered issuer and the receiver a listed debtor.
  const qrBody = (fields) => ({ source: 'qr', qrText: fiscalQr({ cuit: Number(CUITS.issuer), nroDocRec: Number(CUITS.debtor), ...fields }), dueOn: '2026-12-25' });
  const qr = await createInvoice(db, USERS.issuer, qrBody({ nroCmp: 77 }), randomUUID(), { now, settings });
  assert.equal(qr.invoice.source, 'qr'); assert.equal(qr.invoice.simulated, false);
  await assert.rejects(() => createInvoice(db, USERS.issuer, qrBody({ nroCmp: 78, cuit: Number(CUITS.issuer2) }), randomUUID(), { now, settings }), code('issuer_cuit_mismatch'));
  await assert.rejects(() => createInvoice(db, USERS.issuer, qrBody({ nroCmp: 79, nroDocRec: Number(CUITS.investor) }), randomUUID(), { now, settings }), code('debtor_not_listed'));

  const debtors = await listDebtors(db, USERS.issuer);
  assert.equal(debtors.length, 1);
  assert.ok(!JSON.stringify(debtors).includes(CUITS.debtor));
  assert.equal(debtors[0].cuitHint, `${CUITS.debtor.slice(0, 2)}-…-${CUITS.debtor[10]}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, CVUS, CUITS, WALLETS } from './factoring-fixtures.js';
import { fakeGetUser } from './factoring-http.js';
import { fakeProvider } from './factoring-provider.js';
import { factoringSettings } from '../netlify/functions/lib/factoringConfig.js';
import { createInvoice, sendInvoice, acceptInvoice, expireOffers } from '../netlify/functions/lib/factoringService.js';
import { createTake, processTake, quoteOffer, listOffers, TermsChangedError } from '../netlify/functions/lib/factoringTakes.js';
// processTake, createTake and friends receive the injected clock and fake provider.
import { ASSIGNMENT_TEMPLATE } from '../netlify/functions/lib/factoringDocuments.js';

const settings = factoringSettings(pilotEnv());
const code = expected => error => { assert.equal(error.code, expected); return true; };

async function setup(t, options = {}) {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db, options);
  const now = fakeClock();
  let n = 0;
  const publish = async (extra = {}) => {
    const { invoice } = await createInvoice(db, USERS.issuer, formInvoice(parties.debtor, { cbteNro: ++n, ...extra }), randomUUID(), { now, settings });
    await sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
    await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
    const offer = (await db.query('SELECT id,expires_at FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0];
    return { invoiceId: invoice.id, offerId: offer.id, expiresAt: offer.expires_at };
  };
  const quote = (offerId, user = USERS.investor) => quoteOffer(db, user, offerId, { now, settings });
  const take = async (offerId, { user = USERS.investor, provider, key = randomUUID(), outlay } = {}) => {
    const expectedOutlay = outlay || (await quote(offerId, user)).quote.outlay;
    return createTake(db, user, offerId, { expectedOutlay }, key, { now, settings, client: provider, getUser: fakeGetUser });
  };
  const state = async invoiceId => ({
    invoice: (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0].status,
    offer: (await db.query('SELECT status,expires_at FROM invoice_offers WHERE invoice_id=$1 ORDER BY opened_at DESC LIMIT 1', [invoiceId])).rows[0],
    takes: (await db.query('SELECT id,status FROM invoice_takes WHERE invoice_id=$1 ORDER BY created_at', [invoiceId])).rows,
    orders: (await db.query("SELECT purpose,status,idempotency_key,provider_error FROM factoring_orders WHERE invoice_id=$1 ORDER BY created_at,purpose", [invoiceId])).rows,
    reviews: (await db.query('SELECT reason FROM factoring_reviews WHERE invoice_id=$1 AND resolved_at IS NULL', [invoiceId])).rows.map(r => r.reason),
    chain: (await db.query('SELECT kind FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [invoiceId])).rows.map(r => r.kind),
  });
  return { db, parties, now, publish, quote, take, state };
}

test('a take runs net then fee and leaves the invoice ceded with the NFT transfer queued', async t => {
  const { db, now, publish, quote, take, state } = await setup(t);
  const { invoiceId, offerId } = await publish();
  const shown = await quote(offerId);
  // ARS 10.000 from 25/11 to 25/12: 30 days (plan 6.3).
  assert.deepEqual([shown.quote.days, shown.quote.advance, shown.quote.fee, shown.quote.outlay, shown.quote.gain],
    [30, '9720.37', '6.99', '9727.36', '272.64']);
  assert.equal(shown.quote.takeable, true);
  assert.deepEqual(shown.debit, { issuerCvu: CVUS.issuer, feeCvu: CVUS.fee });
  const provider = fakeProvider();
  const { take: created, existing } = await take(offerId, { provider });
  assert.equal(existing, false); assert.equal(created.status, 'paying'); assert.equal(created.outlay, '9727.36');
  assert.equal(provider.withdrawals().length, 0, 'no money moves inside the request');
  let s = await state(invoiceId);
  assert.equal(s.invoice, 'tomada'); assert.equal(s.offer.status, 'taken');
  assert.deepEqual(s.orders.map(o => `${o.purpose}:${o.status}`), ['fee_to_midatopay:pending', 'net_to_issuer:pending']);
  for (const order of s.orders) assert.match(order.idempotency_key, /^midatopay-factoring-[0-9a-f-]{36}$/);
  assert.equal(await processTake(db, created.id, { now, settings, client: provider }), 2);
  assert.deepEqual(provider.withdrawals().map(c => `${c.purpose}:${c.amountCents}`), ['net:972037', 'fee:699']);
  assert.ok(provider.withdrawals().every(c => c.customerId === 'cus_investor'));
  s = await state(invoiceId);
  assert.equal(s.invoice, 'cedida'); assert.equal(s.offer.status, 'closed'); assert.equal(s.takes[0].status, 'completed');
  assert.deepEqual(s.orders.map(o => o.status), ['completed', 'completed']);
  assert.deepEqual(s.chain, ['register', 'accepted', 'published', 'taken', 'cede']);
  const audit = (await db.query('SELECT to_status FROM factoring_audit WHERE invoice_id=$1 ORDER BY id', [invoiceId])).rows.map(r => r.to_status);
  assert.deepEqual(audit.slice(-3), ['tomada', 'pagos_en_curso', 'cedida']);
  const row = (await db.query('SELECT assignment_text,assignment_sha256,investor_wallet FROM invoice_takes WHERE id=$1', [created.id])).rows[0];
  assert.match(row.assignment_text, /^BORRADOR, SIN VALOR LEGAL/);
  assert.equal(row.investor_wallet, WALLETS.investor);
  const cede = (await db.query("SELECT args FROM factoring_chain_events WHERE invoice_id=$1 AND kind='cede'", [invoiceId])).rows[0].args;
  assert.equal(cede.investor, WALLETS.investor);
  assert.equal(await processTake(db, created.id, { now, settings, client: provider }), 0);
});

test('two investors at once: one wins and the other gets offer_taken; the same key never duplicates', async t => {
  const { db, publish, take, state } = await setup(t);
  const { invoiceId, offerId } = await publish();
  const provider = fakeProvider();
  const results = await Promise.allSettled([take(offerId, { provider }), take(offerId, { provider, user: USERS.investor2 })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'offer_taken');
  const other = await publish();
  const key = randomUUID();
  const [a, b] = await Promise.all([take(other.offerId, { provider, key }), take(other.offerId, { provider, key })]);
  assert.equal(a.take.id, b.take.id);
  assert.equal([a.existing, b.existing].filter(Boolean).length, 1);
  const s = await state(other.invoiceId);
  assert.equal(s.takes.length, 1); assert.equal(s.orders.length, 2);
  assert.equal((await state(invoiceId)).takes.length, 1);
  const third = await publish();
  await assert.rejects(() => take(third.offerId, { provider, key }), code('idempotency_conflict'));
});

test('a net rejection reopens the offer with the same expiry and never sends the fee', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const { invoiceId, offerId, expiresAt } = await publish();
  const provider = fakeProvider({ script: { net: () => ({ outcome: 'rejected', code: 'INSUFFICIENT_FUNDS', httpStatus: 422 }) } });
  const { take: created } = await take(offerId, { provider });
  await processTake(db, created.id, { now, settings, client: provider });
  const s = await state(invoiceId);
  assert.equal(s.invoice, 'publicada'); assert.equal(s.offer.status, 'open');
  assert.equal(new Date(s.offer.expires_at).getTime(), new Date(expiresAt).getTime());
  assert.equal(s.takes[0].status, 'failed_net');
  assert.deepEqual(s.orders.map(o => `${o.purpose}:${o.status}`), ['fee_to_midatopay:cancelled', 'net_to_issuer:failed']);
  assert.equal(provider.withdrawals('fee').length, 0);
  assert.equal(s.chain.at(-1), 'published');
  // The reopened offer can be taken again.
  const retry = await take(offerId, { provider: fakeProvider() });
  assert.equal(retry.take.status, 'paying');
});

test('a PROCESSING net is looked up, not resent, and its later failure reopens the offer; the fee never leaves before the net completes', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const { invoiceId, offerId } = await publish();
  let lookups = 0;
  const provider = fakeProvider({ script: {
    net: input => provider.ok(input, 'PROCESSING'),
    netLookup: input => (++lookups < 2 ? provider.ok(input, 'PROCESSING', input.id) : provider.ok(input, 'FAILED', input.id)),
  } });
  const { take: created } = await take(offerId, { provider });
  await processTake(db, created.id, { now, settings, client: provider });
  assert.equal((await state(invoiceId)).invoice, 'pagos_en_curso');
  assert.equal(await processTake(db, created.id, { now, settings, client: provider }), 0, 'not due yet');
  now.advance({ seconds: 30 });
  await processTake(db, created.id, { now, settings, client: provider });
  now.advance({ seconds: 30 });
  await processTake(db, created.id, { now, settings, client: provider });
  assert.equal(provider.withdrawals('net').length, 1);
  assert.equal(provider.calls.filter(c => c.op === 'order').length, 2);
  assert.equal(provider.withdrawals('fee').length, 0);
  assert.equal((await state(invoiceId)).invoice, 'publicada');
});

test('an offer that expires while the net is paying goes back to published and the next run expires it', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const { invoiceId, offerId } = await publish();
  now.advance({ hours: 71 });
  const provider = fakeProvider({ script: { net: input => provider.ok(input, 'PROCESSING'), netLookup: input => provider.ok(input, 'FAILED', input.id) } });
  const { take: created } = await take(offerId, { provider });
  await processTake(db, created.id, { now, settings, client: provider });
  now.advance({ hours: 2 });
  await processTake(db, created.id, { now, settings, client: provider });
  assert.equal((await state(invoiceId)).invoice, 'publicada');
  assert.equal(await expireOffers(db, { now, settings }), 1);
  assert.equal((await state(invoiceId)).invoice, 'oferta_vencida');
});

test('a fee rejection goes to manual review with the net completed; a 503 on the fee is retried with the same key', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const failing = await publish();
  const provider = fakeProvider({ script: { fee: () => ({ outcome: 'failed', code: 'EXECUTION_REJECTED', httpStatus: 502 }) } });
  const { take: created } = await take(failing.offerId, { provider });
  await processTake(db, created.id, { now, settings, client: provider });
  let s = await state(failing.invoiceId);
  assert.equal(s.invoice, 'revision_manual'); assert.equal(s.takes[0].status, 'manual_review');
  assert.deepEqual(s.orders.map(o => `${o.purpose}:${o.status}`), ['fee_to_midatopay:failed', 'net_to_issuer:completed']);
  assert.deepEqual(s.reviews, ['fee_failed']);

  const retried = await publish();
  const flaky = fakeProvider({ script: { fee: (input, attempt) => (attempt === 1 ? { outcome: 'retry', code: 'PROVIDER_UNAVAILABLE', httpStatus: 503, retryAfterSeconds: 180 } : flaky.ok(input)) } });
  const second = await take(retried.offerId, { provider: flaky });
  await processTake(db, second.take.id, { now, settings, client: flaky });
  assert.equal((await state(retried.invoiceId)).invoice, 'pagos_en_curso');
  now.advance({ minutes: 3 });
  await processTake(db, second.take.id, { now, settings, client: flaky });
  s = await state(retried.invoiceId);
  assert.equal(s.invoice, 'cedida');
  const keys = flaky.withdrawals('fee').map(c => c.key);
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test('a net timeout is retried with the same key; a wrong destination or a sustained uncertainty goes to review', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const first = await publish();
  const timeouts = fakeProvider({ script: { net: (input, attempt) => (attempt === 1 ? { outcome: 'uncertain', code: 'network_or_timeout', httpStatus: null } : timeouts.ok(input)) } });
  const a = await take(first.offerId, { provider: timeouts });
  await processTake(db, a.take.id, { now, settings, client: timeouts });
  now.advance({ minutes: 1 });
  await processTake(db, a.take.id, { now, settings, client: timeouts });
  assert.equal((await state(first.invoiceId)).invoice, 'cedida');
  const netKeys = timeouts.withdrawals('net').map(c => c.key);
  assert.equal(netKeys.length, 2); assert.equal(netKeys[0], netKeys[1]);

  const second = await publish();
  const wrong = fakeProvider({ script: { net: () => ({ outcome: 'mismatch', order: { id: 'ord_x' }, httpStatus: 201 }) } });
  const b = await take(second.offerId, { provider: wrong });
  await processTake(db, b.take.id, { now, settings, client: wrong });
  let s = await state(second.invoiceId);
  assert.equal(s.invoice, 'revision_manual'); assert.deepEqual(s.reviews, ['net_mismatch']);
  assert.equal(wrong.withdrawals('fee').length, 0);

  const third = await publish();
  const silent = fakeProvider({ script: { net: () => ({ outcome: 'uncertain', code: 'INTERNAL', httpStatus: 500 }) } });
  const c = await take(third.offerId, { provider: silent });
  for (let i = 0; i < 12; i += 1) { await processTake(db, c.take.id, { now, settings, client: silent }); now.advance({ minutes: 5 }); }
  s = await state(third.invoiceId);
  assert.equal(s.invoice, 'revision_manual'); assert.deepEqual(s.reviews, ['net_uncertain']);
  assert.equal(new Set(silent.withdrawals('net').map(x => x.key)).size, 1);
});

test('terms change with the day, and FCE, zero days, KYC, self-take and provider limits block the take', async t => {
  const { db, parties, now, publish, quote, take } = await setup(t, { investorType: 'persona_juridica' });
  const { offerId } = await publish();
  const before = (await quote(offerId)).quote.outlay;
  now.advance({ days: 1 });
  await assert.rejects(() => take(offerId, { provider: fakeProvider(), outlay: before }), error => {
    assert.ok(error instanceof TermsChangedError); assert.equal(error.quote.days, 29); assert.notEqual(error.quote.outlay, before);
    return true;
  });
  // FCE: a persona_juridica investor is not admitted (art. 13), and the last 3 bank business days are closed (art. 18).
  const fce = await publish({ cbteTipo: 201, dueOn: '2027-01-15' });
  await assert.rejects(() => take(fce.offerId, { provider: fakeProvider() }), code('fce_investor_not_allowed'));
  await db.query("UPDATE factoring_parties SET investor_type='entidad_financiera' WHERE user_id=$1 AND role='investor'", [USERS.investor]);
  const late = await publish({ cbteTipo: 201, dueOn: '2026-12-02' });
  now.set('2026-11-27T15:00:00Z'); // Fri 27/11: the window before Wed 2/12 is 27/11, 30/11 and 1/12
  await assert.rejects(() => take(late.offerId, { provider: fakeProvider() }), code('fce_transfer_window_closed'));
  assert.equal((await quote(late.offerId)).quote.blockedReason, 'fce_transfer_window_closed');
  now.set('2026-11-26T15:00:00Z');
  assert.equal((await take(late.offerId, { provider: fakeProvider() })).take.status, 'paying');

  const due = await publish({ dueOn: '2026-11-28' });
  now.set('2026-11-28T15:00:00Z');
  const zero = await quote(due.offerId);
  assert.equal(zero.quote.takeable, false); assert.equal(zero.quote.blockedReason, 'invoice_due_too_soon');
  await assert.rejects(() => take(due.offerId, { provider: fakeProvider(), outlay: '1.00' }), code('invoice_due_too_soon'));
  now.set('2026-11-26T15:00:00Z');

  const open = await publish();
  await assert.rejects(() => take(open.offerId, { provider: fakeProvider({ balance: 100n }) }), code('investor_insufficient_funds'));
  await assert.rejects(() => take(open.offerId, { provider: fakeProvider({ limits: { minCents: 1000n, maxCents: 10n ** 9n, availableCents: 10n ** 9n } }) }), code('amount_below_provider_minimum'));
  await assert.rejects(() => take(open.offerId, { provider: fakeProvider({ limits: { minCents: 1n, maxCents: 10n ** 9n, availableCents: 900000n } }) }), code('daily_limit_exceeded'));
  await assert.rejects(() => createTake(db, USERS.investor, open.offerId, { expectedOutlay: '1.00', extra: 1 }, randomUUID(), { now, settings }), code('invalid_body'));
  await assert.rejects(() => createTake(db, USERS.investor, open.offerId, { expectedOutlay: '1.00' }, randomUUID(),
    { now, settings: factoringSettings({ ...pilotEnv(), FACTORING_PAYMENTS_MODE: 'disabled' }) }), code('factoring_payments_disabled'));
  await db.query("UPDATE factoring_parties SET kyc_status='pending' WHERE user_id=$1 AND role='investor'", [USERS.investor2]);
  await assert.rejects(() => take(open.offerId, { provider: fakeProvider(), user: USERS.investor2, outlay: '1.00' }), code('investor_kyc_required'));
  // D-07: the issuer cannot take its own invoice even with an investor role.
  await db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,investor_type,kyc_status,tw_customer_id,cvu,terms_accepted_at)
    VALUES($1,'investor','20111111112','Emisora como inversora','persona_juridica','approved','cus_self',$2,now())`, [USERS.issuer, CVUS.issuer]);
  await assert.rejects(() => createTake(db, USERS.issuer, open.offerId, { expectedOutlay: '1.00' }, randomUUID(), { now, settings, client: fakeProvider(), getUser: fakeGetUser }),
    code('self_take_not_allowed'));
  assert.ok(!(await listOffers(db, USERS.issuer, { now, settings })).offers.some(o => o.offerId === open.offerId));
  assert.ok(parties.issuer);
});

test('a zero fee creates no fee order and the take completes with the net alone', async t => {
  const { db, now, publish, take, state } = await setup(t);
  const { invoiceId, offerId } = await publish({ nominal: '100.00', dueOn: '2026-11-26' });
  const provider = fakeProvider();
  const { take: created } = await take(offerId, { provider });
  assert.equal(created.fee, '0.00');
  await processTake(db, created.id, { now, settings, client: provider });
  const s = await state(invoiceId);
  assert.equal(s.invoice, 'cedida');
  assert.deepEqual(s.orders.map(o => o.purpose), ['net_to_issuer']);
  assert.ok(ASSIGNMENT_TEMPLATE.text.includes('BORRADOR'));
});

test('the investor endpoint authenticates first, answers 202 with the take and returns the new quote on terms_changed', async t => {
  const { createInvoiceOffersHandler } = await import('../netlify/functions/invoice-offers.js');
  const { caller, fakeAuthenticate } = await import('./factoring-http.js');
  const forbidden = { query: () => assert.fail('no database'), connect: () => assert.fail('no database') };
  const unauth = caller(createInvoiceOffersHandler({ db: forbidden, authenticate: fakeAuthenticate, env: pilotEnv() }), 'invoice-offers');
  assert.equal((await unauth(null, 'GET', '')).status, 401);
  assert.equal((await unauth(USERS.outsider, 'GET', '')).body.error, 'factoring_disabled');
  const { db, now, publish } = await setup(t);
  const { offerId } = await publish();
  let kicked = 0;
  const call = caller(createInvoiceOffersHandler({ db, now, authenticate: fakeAuthenticate, env: pilotEnv(), getUser: fakeGetUser,
    client: fakeProvider(), kick: async () => { kicked += 1; } }), 'invoice-offers');
  assert.equal((await call(USERS.debtor, 'GET', '')).body.error, 'factoring_role_required');
  const list = await call(USERS.investor, 'GET', '');
  assert.equal(list.status, 200);
  assert.equal(list.body.offers[0].offerId, offerId);
  assert.equal(list.body.offers[0].invoice.debtor.legalName, 'Deudora Grande SA');
  for (const cuit of Object.values(CUITS)) assert.ok(!JSON.stringify(list.body).includes(cuit), 'no CUIT for investors');
  assert.equal((await call(USERS.investor, 'POST', `/${offerId}`)).status, 405);
  assert.equal((await call(USERS.investor, 'GET', `/${randomUUID()}`)).body.error, 'offer_not_found');
  const changed = await call(USERS.investor, 'POST', `/${offerId}/take`, { body: { expectedOutlay: '1.00' }, key: true });
  assert.equal(changed.status, 409); assert.equal(changed.body.error, 'terms_changed'); assert.equal(changed.body.quote.outlay, '9727.36');
  const key = randomUUID();
  const taken = await call(USERS.investor, 'POST', `/${offerId}/take`, { body: { expectedOutlay: '9727.36' }, key });
  assert.equal(taken.status, 202); assert.equal(taken.body.take.status, 'paying'); assert.equal(kicked, 1);
  assert.equal((await call(USERS.investor, 'POST', `/${offerId}/take`, { body: { expectedOutlay: '9727.36' }, key })).status, 200);
  const followed = await call(USERS.investor, 'GET', `/takes/${taken.body.take.id}`);
  assert.equal(followed.body.take.invoiceStatus, 'tomada');
  assert.equal((await call(USERS.investor2, 'GET', `/takes/${taken.body.take.id}`)).body.error, 'take_not_found');
  assert.equal((await call(USERS.investor2, 'POST', `/${offerId}/take`, { body: { expectedOutlay: '9727.36' }, key: true })).body.error, 'offer_taken');
});

// End-to-end cycle of the invoice cession pilot through the real HTTP handlers
// and the scheduled worker, with an injected clock and the 21 Millions simulator
// (no real money, FACTORING_NFT_ENABLED=false, PGlite only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, CVUS } from './factoring-fixtures.js';
import { fakeAuthenticate, fakeGetUser, caller } from './factoring-http.js';
import { createInvoicesHandler } from '../netlify/functions/invoices.js';
import { createInvoiceOffersHandler } from '../netlify/functions/invoice-offers.js';
import { runFactoringWorker } from '../netlify/functions/lib/factoringWorker.js';
import { createSimulatedTwentyOne } from '../netlify/functions/lib/twentyOneMillions.js';

async function pilot(t) {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock('2026-11-25T15:00:00Z');
  const env = pilotEnv();
  const client = createSimulatedTwentyOne();
  let kicks = 0;
  const common = { db, now, env, authenticate: fakeAuthenticate, getUser: fakeGetUser, client, kick: async () => { kicks += 1; } };
  const invoices = caller(createInvoicesHandler(common), 'invoices');
  const offers = caller(createInvoiceOffersHandler(common), 'invoice-offers');
  const worker = () => runFactoringWorker({ db, now, env, client, log: () => {} });
  const chain = async id => (await db.query('SELECT seq,kind,status FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [id])).rows;
  const audit = async id => (await db.query('SELECT to_status FROM factoring_audit WHERE invoice_id=$1 ORDER BY id', [id])).rows.map(r => r.to_status);
  let n = 0;
  const issue = async (extra = {}) => {
    const created = await invoices(USERS.issuer, 'POST', '', { body: formInvoice(parties.debtor, { cbteNro: ++n, ...extra }), key: true });
    assert.equal(created.status, 201);
    const sent = await invoices(USERS.issuer, 'POST', `/${created.body.invoice.id}/send`, { body: {} });
    assert.equal(sent.body.invoice.status, 'enviada');
    return created.body.invoice.id;
  };
  const takeOpenOffer = async invoiceId => {
    const listed = await offers(USERS.investor, 'GET', '');
    const offer = listed.body.offers.find(o => o.invoice.id === invoiceId);
    const detail = await offers(USERS.investor, 'GET', `/${offer.offerId}`);
    const taken = await offers(USERS.investor, 'POST', `/${offer.offerId}/take`, { body: { expectedOutlay: detail.body.quote.outlay }, key: true });
    assert.equal(taken.status, 202);
    return { quote: detail.body.quote, take: taken.body.take };
  };
  return { db, now, invoices, offers, worker, chain, audit, issue, takeOpenOffer, kicks: () => kicks };
}

test('full cycle: issue, express acceptance, take, cession and collection at the due date', async t => {
  const { now, invoices, offers, worker, chain, audit, issue, takeOpenOffer, kicks } = await pilot(t);
  const id = await issue();
  const accepted = await invoices(USERS.debtor, 'POST', `/${id}/accept`, { body: {} });
  assert.equal(accepted.body.invoice.status, 'publicada');
  const { quote, take } = await takeOpenOffer(id);
  assert.deepEqual([quote.days, quote.advance, quote.fee, quote.outlay, quote.gain, quote.investorTnaBps], [30, '9720.37', '6.99', '9727.36', '272.64', 3410]);
  assert.equal(kicks(), 1);
  assert.equal((await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice.status, 'tomada');
  const run = await worker();
  assert.equal(run.providerCalls, 2);
  const followed = await offers(USERS.investor, 'GET', `/takes/${take.id}`);
  assert.deepEqual([followed.body.take.status, followed.body.take.invoiceStatus, followed.body.take.net.status, followed.body.take.feeOrder.status],
    ['completed', 'cedida', 'completed', 'completed']);
  const issuerView = (await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice;
  assert.deepEqual(issuerView.take, { advance: '9720.37', discount: '279.63', days: 30, status: 'completed' });
  const owed = (await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice;
  assert.deepEqual(owed.payTo, { legalName: 'Inversora Uno SA', cvu: CVUS.investor });
  assert.equal(owed.canPayFrom, '2026-12-25');
  assert.equal((await invoices(USERS.debtor, 'POST', `/${id}/pay`, { body: {}, key: true })).body.error, 'payment_not_yet_due');
  now.set('2026-12-25T13:00:00Z');
  const paid = await invoices(USERS.debtor, 'POST', `/${id}/pay`, { body: {}, key: true });
  assert.equal(paid.status, 202); assert.equal(paid.body.payment.status, 'pending');
  await worker();
  assert.equal((await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice.status, 'cobrada');
  const holdings = (await offers(USERS.investor, 'GET', '')).body.holdings;
  assert.equal(holdings[0].invoice.status, 'cobrada');
  assert.deepEqual(await audit(id), ['cargada', 'enviada', 'aceptada', 'publicada', 'tomada', 'pagos_en_curso', 'cedida', 'cobrada']);
  // The chain queue holds every event in order and nothing is signed while the NFT is off.
  assert.deepEqual((await chain(id)).map(e => `${e.seq}:${e.kind}:${e.status}`),
    ['1:register:pending', '2:accepted:pending', '3:published:pending', '4:taken:pending', '5:cede:pending', '6:collected:pending']);
  assert.equal(owed.nft.status, 'disabled');
  await worker();
  assert.equal((await audit(id)).length, 8, 'a second run changes nothing');
});

test('tacit acceptance on day 21, then default the day after the due date and late collection', async t => {
  const { now, invoices, worker, chain, audit, issue, takeOpenOffer } = await pilot(t);
  const id = await issue({ dueOn: '2027-01-20' });
  now.set('2026-12-10T15:00:00Z');
  await worker();
  assert.equal((await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice.status, 'enviada');
  now.set('2026-12-11T15:00:00Z');
  await worker();
  const published = (await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice;
  assert.equal(published.status, 'publicada');
  assert.equal((await invoices(USERS.debtor, 'POST', `/${id}/reject`, { body: {} })).body.error, 'invalid_transition');
  await takeOpenOffer(id);
  await worker();
  assert.equal((await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice.status, 'cedida');
  now.set('2027-01-20T15:00:00Z');
  await worker();
  assert.equal((await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice.status, 'cedida', 'not in default on the due date');
  now.set('2027-01-21T15:00:00Z');
  await worker();
  assert.equal((await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice.status, 'en_mora');
  const late = await invoices(USERS.debtor, 'POST', `/${id}/pay`, { body: {}, key: true });
  assert.equal(late.status, 202);
  await worker();
  assert.equal((await invoices(USERS.debtor, 'GET', `/${id}`)).body.invoice.status, 'cobrada');
  assert.deepEqual(await audit(id), ['cargada', 'enviada', 'aceptada', 'publicada', 'tomada', 'pagos_en_curso', 'cedida', 'en_mora', 'cobrada']);
  assert.deepEqual((await chain(id)).map(e => e.kind), ['register', 'accepted', 'published', 'taken', 'cede', 'defaulted', 'collected']);
});

test('an offer nobody takes expires after 72 hours and a rejected invoice stays final', async t => {
  const { now, invoices, offers, worker, issue } = await pilot(t);
  const id = await issue();
  await invoices(USERS.debtor, 'POST', `/${id}/accept`, { body: {} });
  now.advance({ hours: 71, minutes: 59 });
  await worker();
  assert.equal((await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice.status, 'publicada');
  now.advance({ minutes: 1 });
  await worker();
  assert.equal((await invoices(USERS.issuer, 'GET', `/${id}`)).body.invoice.status, 'oferta_vencida');
  assert.deepEqual((await offers(USERS.investor, 'GET', '')).body.offers, []);
  const rejected = await issue();
  await invoices(USERS.debtor, 'POST', `/${rejected}/reject`, { body: {} });
  now.advance({ days: 30 });
  await worker();
  assert.equal((await invoices(USERS.issuer, 'GET', `/${rejected}`)).body.invoice.status, 'rechazada');
});

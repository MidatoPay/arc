import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, WALLETS, CUITS } from './factoring-fixtures.js';
import { fakeAuthenticate, fakeGetUser, caller } from './factoring-http.js';
import { fakeProvider } from './factoring-provider.js';
import { factoringSettings } from '../netlify/functions/lib/factoringConfig.js';
import { createInvoice, sendInvoice, acceptInvoice } from '../netlify/functions/lib/factoringService.js';
import { createTake, processTake, quoteOffer } from '../netlify/functions/lib/factoringTakes.js';
import { runFactoringWorker } from '../netlify/functions/lib/factoringWorker.js';
import { createFactoringAdminHandler } from '../netlify/functions/factoring-admin.js';

const env = pilotEnv();
const settings = factoringSettings(env);

async function setup(t) {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock();
  const admin = caller(createFactoringAdminHandler({ db, now, env, authenticate: fakeAuthenticate }), 'factoring-admin');
  let n = 0;
  const takenWith = async provider => {
    const { invoice } = await createInvoice(db, USERS.issuer, formInvoice(parties.debtor, { cbteNro: ++n }), randomUUID(), { now, settings });
    await sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
    await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
    const offerId = (await db.query('SELECT id FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0].id;
    const expectedOutlay = (await quoteOffer(db, USERS.investor, offerId, { now, settings })).quote.outlay;
    const { take } = await createTake(db, USERS.investor, offerId, { expectedOutlay }, randomUUID(), { now, settings, client: provider, getUser: fakeGetUser });
    await processTake(db, take.id, { now, settings, client: provider });
    return { invoiceId: invoice.id, takeId: take.id };
  };
  const status = async id => (await db.query('SELECT status FROM invoices WHERE id=$1', [id])).rows[0].status;
  return { db, now, admin, takenWith, status };
}

const feeFails = () => fakeProvider({ script: { fee: () => ({ outcome: 'failed', code: 'EXECUTION_REJECTED', httpStatus: 502 }) } });

test('only factoring admins reach the API, separate from payment admins', async t => {
  const { admin } = await setup(t);
  assert.equal((await admin(null, 'GET', '/reviews')).status, 401);
  assert.equal((await admin(USERS.issuer, 'GET', '/reviews')).body.error, 'factoring_admin_required');
  const payments = caller(createFactoringAdminHandler({ db: { query: () => assert.fail('no db') }, env: { PAYMENTS_ADMIN_USER_IDS: USERS.admin },
    authenticate: fakeAuthenticate }), 'factoring-admin');
  assert.equal((await payments(USERS.admin, 'GET', '/reviews')).status, 403);
  assert.equal((await admin(USERS.admin, 'POST', '/reviews')).status, 405);
  assert.equal((await admin(USERS.admin, 'GET', '/whatever')).status, 404);
});

test('retrying a failed fee creates a new order with a new key and the worker cedes the invoice', async t => {
  const { db, now, admin, takenWith, status } = await setup(t);
  const { invoiceId, takeId } = await takenWith(feeFails());
  assert.equal(await status(invoiceId), 'revision_manual');
  const listed = await admin(USERS.admin, 'GET', '/reviews');
  assert.equal(listed.body.reviews.length, 1);
  const [review] = listed.body.reviews;
  assert.equal(review.reason, 'fee_failed'); assert.equal(review.order.purpose, 'fee_to_midatopay'); assert.equal(review.order.status, 'failed');
  const oldKey = (await db.query("SELECT idempotency_key FROM factoring_orders WHERE take_id=$1 AND purpose='fee_to_midatopay'", [takeId])).rows[0].idempotency_key;
  const retried = await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'retry' } });
  assert.equal(retried.status, 200); assert.equal(retried.body.review.resolution, 'retried');
  const fees = (await db.query("SELECT idempotency_key,status FROM factoring_orders WHERE take_id=$1 AND purpose='fee_to_midatopay' ORDER BY created_at", [takeId])).rows;
  assert.equal(fees.length, 2); assert.notEqual(fees[1].idempotency_key, oldKey); assert.equal(fees[1].status, 'pending');
  const provider = fakeProvider();
  await runFactoringWorker({ db, now, settings, env, client: provider, log: () => {} });
  assert.equal(await status(invoiceId), 'cedida');
  assert.deepEqual(provider.withdrawals().map(c => c.purpose), ['fee']);
  assert.equal((await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'retry' } })).body.error, 'review_already_resolved');
  const audit = (await db.query("SELECT actor,reason FROM factoring_audit WHERE invoice_id=$1 AND actor='admin'", [invoiceId])).rows;
  assert.deepEqual(audit.map(a => a.reason), ['review_retry:fee_failed']);
});

test('resolving a fee needs a note, cedes the invoice and queues the NFT transfer', async t => {
  const { db, admin, takenWith, status } = await setup(t);
  const { invoiceId } = await takenWith(feeFails());
  const [review] = (await admin(USERS.admin, 'GET', '/reviews')).body.reviews;
  assert.equal((await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'resolve' } })).body.error, 'invalid_note');
  assert.equal((await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'resolve', note: 'corta' } })).body.error, 'invalid_note');
  assert.equal((await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'skip', note: 'x'.repeat(20) } })).body.error, 'invalid_body');
  const resolved = await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'resolve', note: 'Comisión cobrada por transferencia aparte' } });
  assert.equal(resolved.status, 200);
  assert.deepEqual(resolved.body.invoice, { id: invoiceId, status: 'cedida' });
  assert.equal(await status(invoiceId), 'cedida');
  const kinds = (await db.query('SELECT kind FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [invoiceId])).rows.map(r => r.kind);
  assert.equal(kinds.at(-1), 'cede');
  const last = (await db.query("SELECT actor,actor_user_id,to_status FROM factoring_audit WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1", [invoiceId])).rows[0];
  assert.deepEqual(last, { actor: 'admin', actor_user_id: USERS.admin, to_status: 'cedida' });
});

test('an uncertain net is re-checked with the same key, or resolved back to published with evidence', async t => {
  const { db, now, admin, takenWith, status } = await setup(t);
  const silent = fakeProvider({ script: { net: () => ({ outcome: 'uncertain', code: 'INTERNAL', httpStatus: 500 }) } });
  const first = await takenWith(silent);
  for (let i = 0; i < 8; i += 1) { now.advance({ minutes: 5 }); await processTake(db, first.takeId, { now, settings, client: silent }); }
  assert.equal(await status(first.invoiceId), 'revision_manual');
  let [review] = (await admin(USERS.admin, 'GET', '/reviews')).body.reviews;
  assert.equal(review.reason, 'net_uncertain');
  await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'retry' } });
  const healthy = fakeProvider();
  await runFactoringWorker({ db, now, settings, env, client: healthy, log: () => {} });
  assert.equal(await status(first.invoiceId), 'cedida');
  assert.equal(healthy.withdrawals('net')[0].key, silent.withdrawals('net')[0].key, 'same Idempotency-Key');

  const second = await takenWith(silent);
  for (let i = 0; i < 8; i += 1) { now.advance({ minutes: 5 }); await processTake(db, second.takeId, { now, settings, client: silent }); }
  [review] = (await admin(USERS.admin, 'GET', '/reviews')).body.reviews;
  const resolved = await admin(USERS.admin, 'POST', `/reviews/${review.id}/resolve`, { body: { action: 'resolve', note: '21 Millions confirmó que la orden no existe' } });
  assert.deepEqual(resolved.body.invoice, { id: second.invoiceId, status: 'publicada' });
  assert.equal((await db.query("SELECT status FROM invoice_offers WHERE invoice_id=$1 ORDER BY opened_at DESC LIMIT 1", [second.invoiceId])).rows[0].status, 'open');

  const invoices = await admin(USERS.admin, 'GET', '/invoices', { query: { status: 'cedida' } });
  assert.equal(invoices.body.invoices.length, 1);
  assert.equal(invoices.body.invoices[0].issuerCuit, CUITS.issuer);
  assert.equal((await admin(USERS.admin, 'GET', '/invoices', { query: { status: 'nope' } })).body.error, 'invalid_status');
});

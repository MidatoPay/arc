import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, CVUS, WALLETS } from './factoring-fixtures.js';
import { fakeGetUser } from './factoring-http.js';
import { fakeProvider } from './factoring-provider.js';
import { factoringSettings } from '../netlify/functions/lib/factoringConfig.js';
import { createInvoice, sendInvoice, acceptInvoice, markDefaults } from '../netlify/functions/lib/factoringService.js';
import { createTake, processTake, quoteOffer } from '../netlify/functions/lib/factoringTakes.js';
import { createDebtorPayment, processPayment } from '../netlify/functions/lib/factoringPayments.js';

const settings = factoringSettings(pilotEnv());
const code = expected => error => { assert.equal(error.code, expected); return true; };

async function cededInvoice(t, dueOn = '2026-12-25') {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock();
  const { invoice } = await createInvoice(db, USERS.issuer, formInvoice(parties.debtor, { dueOn }), randomUUID(), { now, settings });
  await sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
  await acceptInvoice(db, USERS.debtor, invoice.id, { now, settings });
  const offerId = (await db.query('SELECT id FROM invoice_offers WHERE invoice_id=$1', [invoice.id])).rows[0].id;
  const provider = fakeProvider();
  const expectedOutlay = (await quoteOffer(db, USERS.investor, offerId, { now, settings })).quote.outlay;
  const { take } = await createTake(db, USERS.investor, offerId, { expectedOutlay }, randomUUID(), { now, settings, client: provider, getUser: fakeGetUser });
  await processTake(db, take.id, { now, settings, client: provider });
  const status = async () => (await db.query('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0].status;
  assert.equal(await status(), 'cedida');
  const pay = (key = randomUUID(), client = fakeProvider(), user = USERS.debtor) => createDebtorPayment(db, user, invoice.id, key, { now, settings, client });
  const payments = async () => (await db.query(`SELECT id,status,amount_cents::text AS amount,destination_cvu,payer_customer_id,provider_error
    FROM factoring_orders WHERE invoice_id=$1 AND purpose='nominal_to_investor' ORDER BY created_at,id`, [invoice.id])).rows;
  return { db, now, invoiceId: invoice.id, pay, status, payments };
}

test('the debtor pays the full nominal to the investor CVU from the due date', async t => {
  const { db, now, invoiceId, pay, status, payments } = await cededInvoice(t);
  now.set('2026-12-24T15:00:00Z');
  await assert.rejects(() => pay(), code('payment_not_yet_due'));
  now.set('2026-12-25T03:00:00Z'); // 00:00 of the due date in Argentina
  const provider = fakeProvider();
  const key = randomUUID();
  const [first, second] = await Promise.all([pay(key, provider), pay(key, provider)]);
  assert.equal([first.existing, second.existing].filter(Boolean).length, 1);
  assert.equal(first.invoice.payTo.cvu, CVUS.investor);
  assert.equal(first.invoice.payTo.legalName, 'Inversora Uno SA');
  assert.equal(first.invoice.canPayFrom, '2026-12-25');
  let rows = await payments();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].amount, rows[0].destination_cvu, rows[0].payer_customer_id], ['1000000', CVUS.investor, 'cus_debtor']);
  await assert.rejects(() => pay(randomUUID(), provider), code('payment_in_progress'));
  await assert.rejects(() => pay(key, provider, USERS.investor), code('invoice_not_found'));
  assert.equal(await processPayment(db, rows[0].id, { now, settings, client: provider }), 1);
  assert.equal(await status(), 'cobrada');
  assert.deepEqual(provider.withdrawals().map(c => `${c.purpose}:${c.amountCents}`), ['nominal:1000000']);
  rows = await payments();
  assert.equal(rows[0].status, 'completed');
  const chain = (await db.query('SELECT kind FROM factoring_chain_events WHERE invoice_id=$1 ORDER BY seq', [invoiceId])).rows.map(r => r.kind);
  assert.equal(chain.at(-1), 'collected');
  await assert.rejects(() => pay(randomUUID(), provider), code('invalid_transition'));
});

test('a failed payment leaves the invoice as it was and the debtor can retry with a new key; late payment from default collects', async t => {
  const { db, now, pay, status, payments } = await cededInvoice(t);
  now.set('2026-12-25T15:00:00Z');
  await assert.rejects(() => pay(randomUUID(), fakeProvider({ balance: 999999n })), code('debtor_insufficient_funds'));
  assert.equal(await status(), 'cedida');
  assert.equal((await payments()).length, 0);
  const rejecting = fakeProvider({ script: { nominal: () => ({ outcome: 'rejected', code: 'DAILY_LIMIT_EXCEEDED', httpStatus: 422 }) } });
  await pay(randomUUID(), rejecting);
  await processPayment(db, (await payments())[0].id, { now, settings, client: rejecting });
  assert.equal(await status(), 'cedida');
  assert.deepEqual((await payments()).map(p => `${p.status}:${p.provider_error}`), ['failed:DAILY_LIMIT_EXCEEDED']);
  // No payment the next day: default; then the debtor pays late (D-05).
  now.set('2026-12-26T15:00:00Z');
  assert.equal(await markDefaults(db, { now, settings }), 1);
  assert.equal(await status(), 'en_mora');
  const provider = fakeProvider();
  const late = await pay(randomUUID(), provider);
  assert.equal(late.payment.status, 'pending');
  const order = (await payments()).at(-1);
  await processPayment(db, order.id, { now, settings, client: provider });
  assert.equal(await status(), 'cobrada');
});

test('an uncertain payment is retried with the same key and goes to review after 30 minutes', async t => {
  const { db, now, pay, status, payments } = await cededInvoice(t);
  now.set('2026-12-25T15:00:00Z');
  const silent = fakeProvider({ script: { nominal: () => ({ outcome: 'uncertain', code: 'INTERNAL', httpStatus: 500 }) } });
  await pay(randomUUID(), silent);
  const order = (await payments())[0];
  for (let i = 0; i < 8; i += 1) { await processPayment(db, order.id, { now, settings, client: silent }); now.advance({ minutes: 5 }); }
  assert.equal((await payments())[0].status, 'manual_review');
  assert.equal(new Set(silent.withdrawals().map(c => c.key)).size, 1);
  assert.equal(await status(), 'cedida');
  const reviews = (await db.query('SELECT reason FROM factoring_reviews WHERE order_id=$1', [order.id])).rows.map(r => r.reason);
  assert.deepEqual(reviews, ['payment_uncertain']);
  // A live order under review blocks the default.
  now.set('2026-12-27T15:00:00Z');
  assert.equal(await markDefaults(db, { now, settings }), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, WALLETS } from './factoring-fixtures.js';
import { fakeGetUser } from './factoring-http.js';
import { fakeProvider } from './factoring-provider.js';
import { factoringSettings } from '../netlify/functions/lib/factoringConfig.js';
import { createInvoice, sendInvoice, acceptInvoice } from '../netlify/functions/lib/factoringService.js';
import { createTake, quoteOffer } from '../netlify/functions/lib/factoringTakes.js';
import { runFactoringWorker, factoringActive } from '../netlify/functions/lib/factoringWorker.js';
import { createFactoringDispatch } from '../netlify/functions/factoring-dispatch.js';
import { handler as workerHandler } from '../netlify/functions/factoring-worker-background.js';

const env = pilotEnv();
const settings = factoringSettings(env);

async function setup(t) {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock();
  let n = 0;
  const sent = async (extra = {}) => {
    const { invoice } = await createInvoice(db, USERS.issuer, formInvoice(parties.debtor, { cbteNro: ++n, ...extra }), randomUUID(), { now, settings });
    await sendInvoice(db, USERS.issuer, invoice.id, { now, settings, issuerWallet: WALLETS.issuer });
    return invoice.id;
  };
  const status = async id => (await db.query('SELECT status FROM invoices WHERE id=$1', [id])).rows[0].status;
  const auditCount = async id => (await db.query('SELECT count(*)::int AS n FROM factoring_audit WHERE invoice_id=$1', [id])).rows[0].n;
  const work = (client = fakeProvider()) => runFactoringWorker({ db, now, settings, env, client, log: () => {} });
  const takeOffer = async (invoiceId, provider) => {
    const offerId = (await db.query("SELECT id FROM invoice_offers WHERE invoice_id=$1 AND status='open'", [invoiceId])).rows[0].id;
    const expectedOutlay = (await quoteOffer(db, USERS.investor, offerId, { now, settings })).quote.outlay;
    return (await createTake(db, USERS.investor, offerId, { expectedOutlay }, randomUUID(), { now, settings, client: provider, getUser: fakeGetUser })).take;
  };
  return { db, now, sent, status, auditCount, work, takeOffer };
}

test('advancing the clock publishes at day 21, expires at 72 hours and defaults the day after the due date, once each', async t => {
  const { now, sent, status, auditCount, work, takeOffer } = await setup(t);
  const tacit = await sent(), ceded = await sent({ dueOn: '2026-12-20' });
  now.set('2026-12-10T15:00:00Z');
  assert.equal((await work()).tacit, 0);
  now.set('2026-12-11T15:00:00Z');
  const first = await work();
  assert.equal(first.tacit, 2);
  assert.equal(await status(tacit), 'publicada');
  const before = await auditCount(tacit);
  assert.equal((await work()).tacit, 0);
  assert.equal(await auditCount(tacit), before, 'no duplicated transitions');
  const provider = fakeProvider();
  await takeOffer(ceded, provider);
  assert.equal((await work(provider)).takes, 1);
  assert.equal(await status(ceded), 'cedida');
  now.advance({ hours: 72 });
  assert.equal((await work()).expired, 1);
  assert.equal(await status(tacit), 'oferta_vencida');
  now.set('2026-12-20T15:00:00Z');
  assert.equal((await work()).defaulted, 0);
  now.set('2026-12-21T03:00:00Z');
  assert.equal((await work()).defaulted, 1);
  assert.equal(await status(ceded), 'en_mora');
  const settled = await auditCount(ceded);
  await work();
  assert.equal(await auditCount(ceded), settled);
});

test('one failing take does not stop the next one', async t => {
  const { db, now, sent, status, work, takeOffer } = await setup(t);
  const a = await sent(), b = await sent();
  for (const id of [a, b]) await acceptInvoice(db, USERS.debtor, id, { now, settings });
  let explode = true;
  const provider = fakeProvider({ script: { net: input => { if (explode) { explode = false; throw new Error('boom'); } return provider.ok(input); } } });
  await takeOffer(a, provider);
  await takeOffer(b, provider);
  const summary = await runFactoringWorker({ db, now, settings, env, client: provider, log: () => {} });
  assert.equal(summary.errors, 1);
  assert.deepEqual([await status(a), await status(b)].sort(), ['cedida', 'pagos_en_curso']);
});

test('a second run that cannot get the worker lock exits without touching anything', async () => {
  const queries = [];
  const busy = { connect: async () => ({ query: async (sql) => { queries.push(sql); if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: false }] };
    throw new Error('must not query'); }, release() {} }), query: () => assert.fail('must not query') };
  assert.deepEqual(await runFactoringWorker({ db: busy, settings, env, log: () => {} }), { skipped: 'locked' });
  assert.equal(queries.length, 1);
});

test('the dispatcher and the worker skip while the pilot is off; the background worker requires the internal secret', async () => {
  assert.equal(factoringActive({}), false);
  assert.equal(factoringActive({ FACTORING_ALLOWED_USER_IDS: ' , ' }), false);
  assert.equal(factoringActive({ FACTORING_ALLOWED_USER_IDS: 'did:privy:x' }), true);
  assert.equal(factoringActive({ FACTORING_ENABLED: 'true' }), true);
  const off = await createFactoringDispatch({ env: {}, kick: () => assert.fail('must not wake the worker') })();
  assert.deepEqual([off.statusCode, JSON.parse(off.body)], [200, { skipped: true }]);
  let kicked;
  const on = await createFactoringDispatch({ env: { FACTORING_ENABLED: 'true' }, kick: async args => { kicked = args; return { accepted: true }; } })();
  assert.equal(on.statusCode, 200); assert.deepEqual(kicked, { functionName: 'factoring-worker-background' });
  const failed = await createFactoringDispatch({ env: { FACTORING_ENABLED: 'true' }, kick: async () => ({ accepted: false, code: 'x' }) })();
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(await runFactoringWorker({ db: { connect: () => assert.fail('no db') }, env: {}, log: () => {} }), { skipped: 'factoring_disabled' });
  assert.equal((await workerHandler({ httpMethod: 'POST', headers: {} })).statusCode, 401);
  assert.equal((await workerHandler({ httpMethod: 'GET', headers: { 'x-worker-secret': 'x'.repeat(40) } })).statusCode, 401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvoicesHandler } from '../netlify/functions/invoices.js';
import { PaymentError } from '../netlify/functions/lib/paymentCore.js';
import { createFactoringDb } from './factoring-db.js';
import { seedParties, fakeClock, pilotEnv, formInvoice, USERS, CUITS } from './factoring-fixtures.js';
import { fakeAuthenticate, fakeGetUser, caller } from './factoring-http.js';

test('the endpoint authenticates before touching the database, Privy or configuration', async () => {
  const forbidden = { query: () => assert.fail('no database'), connect: () => assert.fail('no database') };
  const handler = createInvoicesHandler({ authenticate: async () => { throw new PaymentError('unauthorized', 401); }, db: forbidden,
    getUser: () => assert.fail('no Privy'), env: { get FACTORING_ENABLED() { return assert.fail('no configuration'); } } });
  for (const [method, path] of [['GET', '/invoices'], ['POST', '/invoices'], ['GET', '/invoices/access'], ['POST', `/invoices/${randomUUID()}/send`]])
    assert.equal((await handler({ httpMethod: method, path, headers: {} })).statusCode, 401);
});

test('users outside the pilot see it disabled without any database access', async () => {
  const forbidden = { query: () => assert.fail('no database'), connect: () => assert.fail('no database') };
  const call = caller(createInvoicesHandler({ authenticate: fakeAuthenticate, db: forbidden, env: pilotEnv() }), 'invoices');
  const access = await call(USERS.outsider, 'GET', '/access');
  assert.deepEqual(access, { status: 200, body: { enabled: false, roles: { issuer: false, debtor: false, investor: false, admin: false },
    paymentsMode: null, nftEnabled: false } });
  assert.equal((await call(USERS.outsider, 'POST', '', { body: {}, key: true })).body.error, 'factoring_disabled');
  assert.equal((await call(USERS.outsider, 'GET', '')).status, 503);
  assert.equal((await call(USERS.outsider, 'POST', `/${randomUUID()}/accept`, { body: {} })).status, 503);
});

test('issuer and debtor drive an invoice to published through the API, isolated from other users', async t => {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const parties = await seedParties(db);
  const now = fakeClock();
  const call = caller(createInvoicesHandler({ authenticate: fakeAuthenticate, db, now, env: pilotEnv(), getUser: fakeGetUser }), 'invoices');

  const access = await call(USERS.issuer, 'GET', '/access');
  assert.deepEqual(access.body, { enabled: true, roles: { issuer: true, debtor: false, investor: false, admin: false }, paymentsMode: 'simulated', nftEnabled: false });
  assert.equal((await call(USERS.issuer, 'POST', '/access')).status, 405);
  assert.equal((await call(USERS.issuer, 'PUT', '')).status, 405);
  assert.equal((await call(USERS.issuer, 'GET', `/${randomUUID()}/send`)).status, 405);
  assert.equal((await call(USERS.issuer, 'GET', '/nope')).status, 404);

  const debtors = await call(USERS.issuer, 'GET', '/debtors');
  assert.equal(debtors.status, 200);
  assert.equal(debtors.body.debtors[0].id, parties.debtor);
  assert.ok(!JSON.stringify(debtors.body).includes(CUITS.debtor));
  assert.equal((await call(USERS.debtor, 'GET', '/debtors')).body.error, 'factoring_role_required');

  assert.equal((await call(USERS.issuer, 'POST', '', { body: '{bad', key: true })).body.error, 'invalid_json');
  assert.equal((await call(USERS.issuer, 'POST', '', { body: { ...formInvoice(parties.debtor), extra: 1 }, key: true })).body.error, 'invalid_body');
  assert.equal((await call(USERS.issuer, 'POST', '', { body: formInvoice(parties.debtor) })).body.error, 'invalid_idempotency_key');

  const key = randomUUID();
  const created = await call(USERS.issuer, 'POST', '', { body: formInvoice(parties.debtor), key });
  assert.equal(created.status, 201);
  const invoice = created.body.invoice;
  assert.equal(invoice.status, 'cargada'); assert.equal(invoice.nominal, '10000.00'); assert.equal(invoice.simulated, true);
  assert.equal(invoice.debtor.legalName, 'Deudora Grande SA'); assert.equal(invoice.tacitAcceptanceOn, '2026-12-11');
  assert.equal(invoice.nft.status, 'disabled');
  for (const hidden of ['invoice_salt', 'invoiceSalt', 'invoice_hash', 'issuer_cuit']) assert.ok(!(hidden in invoice));
  const repeated = await call(USERS.issuer, 'POST', '', { body: formInvoice(parties.debtor), key });
  assert.equal(repeated.status, 200); assert.equal(repeated.body.invoice.id, invoice.id);

  assert.equal((await call(USERS.issuer, 'POST', `/${invoice.id}/send`, { body: { wallet: '0x' } })).body.error, 'invalid_body');
  assert.equal((await call(USERS.issuer2, 'POST', `/${invoice.id}/send`, { body: {} })).body.error, 'invoice_not_found');
  assert.equal((await call(USERS.debtor, 'GET', `/${invoice.id}`)).status, 404);
  const sent = await call(USERS.issuer, 'POST', `/${invoice.id}/send`, { body: {} });
  assert.equal(sent.status, 200); assert.equal(sent.body.invoice.status, 'enviada');
  assert.match(sent.body.invoice.nft.tokenId, /^0x[0-9a-f]{64}$/);

  const owed = await call(USERS.debtor, 'GET', '', { query: { view: 'owed' } });
  assert.deepEqual(owed.body.invoices.map(i => i.id), [invoice.id]);
  assert.equal(owed.body.invoices[0].issuer.legalName, 'Emisora Piloto SA');
  assert.ok(!('debtor' in owed.body.invoices[0]));
  assert.equal((await call(USERS.debtor, 'GET', '', { query: { view: 'issued' } })).body.error, 'factoring_role_required');
  assert.deepEqual((await call(USERS.issuer2, 'GET', '')).body.invoices, []);
  assert.equal((await call(USERS.issuer2, 'GET', `/${invoice.id}`)).status, 404);
  assert.equal((await call(USERS.issuer, 'POST', `/${invoice.id}/accept`, { body: {} })).body.error, 'factoring_role_required');

  const accepted = await call(USERS.debtor, 'POST', `/${invoice.id}/accept`, { body: {} });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.invoice.status, 'publicada');
  assert.equal(accepted.body.invoice.offer.expiresAt, new Date(now() + 72 * 3_600_000).toISOString());
  assert.equal((await call(USERS.debtor, 'POST', `/${invoice.id}/reject`, { body: {} })).body.error, 'invalid_transition');
  const detail = await call(USERS.issuer, 'GET', `/${invoice.id}`);
  assert.deepEqual(detail.body.timeline.map(e => e.status), ['cargada', 'enviada', 'aceptada', 'publicada']);

  const other = (await call(USERS.issuer, 'POST', '', { body: formInvoice(parties.debtor, { cbteNro: 2 }), key: true })).body.invoice;
  await call(USERS.issuer, 'POST', `/${other.id}/send`, { body: {} });
  const rejected = await call(USERS.debtor, 'POST', `/${other.id}/reject`, { body: {} });
  assert.equal(rejected.body.invoice.status, 'rechazada');
  // A rejected invoice cannot be paid; an issuer has no debtor role.
  assert.equal((await call(USERS.debtor, 'POST', `/${other.id}/pay`, { body: {}, key: true })).body.error, 'invalid_transition');
  assert.equal((await call(USERS.issuer, 'POST', `/${other.id}/pay`, { body: {}, key: true })).body.error, 'factoring_role_required');
  assert.equal((await call(USERS.debtor, 'POST', `/${other.id}/pay`, { body: { amount: '1' }, key: true })).body.error, 'invalid_body');
});

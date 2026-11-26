import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTwentyOneClient, createSimulatedTwentyOne, normalizeOrder, verifyTwentyOneSignature, amountToCents, centsToAmount,
  clientForEnvironment } from '../netlify/functions/lib/twentyOneMillions.js';

const KEY = 'nx_test_key123_' + 'Z'.repeat(40);
const CVU = '0000003100000000000042';
const realFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error('network access is forbidden in tests'); }; });
test.after(() => { globalThis.fetch = realFetch; });

function harness(responder) {
  const calls = [], logs = [];
  const request = async (url, options) => { calls.push({ url, options }); return responder(url, options, calls.length); };
  const client = createTwentyOneClient({ environment: 'staging', key: KEY, request, log: (...args) => logs.push(args), timeoutMs: 50 });
  return { client, calls, logs };
}
const reply = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const order = (overrides = {}) => ({ id: 'ord_1', customer_id: 'cus_1', type: 'bank_withdrawal', status: 'COMPLETED', source_currency: 'ARS',
  target_currency: 'ARS', source_amount: '9933.32000000', destination: { type: 'bank', account_type: 'cvu', value: CVU },
  idempotency_key: 'midatopay-factoring-a', created_at: '2026-11-25T15:00:00Z', updated_at: '2026-11-25T15:00:00Z',
  proof: { type: 'bank', coelsa_id: 'C123', counterparty: { name: 'Persona Tercera', cuit: '20111111112' } }, ...overrides });
const withdrawal = { customerId: 'cus_1', idempotencyKey: 'midatopay-factoring-a', amountCents: 993332n, cvu: CVU, requestId: 'req-1' };
const errorBody = code => ({ error: { code, message: 'x', request_id: 'r-1' } });

test('amounts convert without floats', () => {
  assert.equal(amountToCents('1500.00000000'), 150000n);
  assert.equal(amountToCents('0.1'), 10n);
  assert.equal(amountToCents('9007199254740.99'), 900719925474099n);
  assert.throws(() => amountToCents('1500.00500000'), /twentyone_invalid_amount/);
  assert.throws(() => amountToCents('-1'), /twentyone_invalid_amount/);
  assert.throws(() => amountToCents('1e3'), /twentyone_invalid_amount/);
  assert.equal(centsToAmount(993332n), '9933.32');
  assert.equal(centsToAmount(5n), '0.05');
});

test('a withdrawal request has the exact contract shape and maps every documented response', async () => {
  const cases = [
    [() => reply(201, order()), 'completed'],
    [() => reply(201, order({ status: 'PROCESSING', proof: null })), 'processing'],
    [() => reply(201, order({ status: 'FAILED' })), 'failed'],
    [() => reply(201, order({ status: 'REVERSED_SOMEHOW' })), 'processing'],
    [() => reply(502, errorBody('EXECUTION_REJECTED')), 'failed'],
    [() => reply(503, errorBody('PROVIDER_UNAVAILABLE')), 'retry'],
    [() => reply(429, errorBody('RATE_LIMIT_EXCEEDED'), { 'retry-after': '17' }), 'retry'],
    [() => reply(409, errorBody('IDEMPOTENCY_KEY_CONFLICT')), 'mismatch'],
    [() => reply(409, errorBody('RAIL_NOT_READY')), 'rejected'],
    [() => reply(409, errorBody('PROVIDER_DISABLED')), 'rejected'],
    [() => reply(409, errorBody('SOMETHING_NEW')), 'uncertain'],
    [() => reply(422, errorBody('INSUFFICIENT_FUNDS')), 'rejected'],
    [() => reply(422, errorBody('AMOUNT_BELOW_MINIMUM')), 'rejected'],
    [() => reply(401, errorBody('PARTNER_AUTHENTICATION_FAILED')), 'configuration'],
    [() => reply(500, errorBody('INTERNAL')), 'uncertain'],
    [() => reply(201, 'not json'), 'uncertain'],
    [() => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }, 'uncertain'],
    [() => reply(201, order({ source_amount: '9933.33000000' })), 'mismatch'],
    [() => reply(201, order({ destination: { type: 'bank', account_type: 'cvu', value: '0'.repeat(22) } })), 'mismatch'],
    [() => reply(201, order({ customer_id: 'cus_2' })), 'mismatch'],
    [() => reply(201, order({ idempotency_key: 'other' })), 'mismatch'],
  ];
  const allLogs = [];
  for (const [responder, outcome] of cases) {
    const { client, calls, logs } = harness(responder);
    const result = await client.createBankWithdrawal(withdrawal);
    assert.equal(result.outcome, outcome, `${responder}`);
    const [{ url, options }] = calls;
    assert.equal(url, 'https://api.staging.21millions.com/v1/partner/customers/cus_1/withdrawals/bank');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-api-key'], KEY);
    assert.equal(options.headers['Idempotency-Key'], withdrawal.idempotencyKey);
    assert.equal(options.headers['X-Request-Id'], 'req-1');
    assert.deepEqual(JSON.parse(options.body), { amount: '9933.32', currency: 'ARS', destination: { type: 'cvu', value: CVU } });
    allLogs.push(...logs);
    if (outcome === 'retry' && result.httpStatus === 429) assert.equal(result.retryAfterSeconds, 17);
    if (outcome === 'completed') assert.equal(result.order.coelsaId, 'C123');
    assert.ok(!JSON.stringify(result).includes('Persona Tercera'));
  }
  const logText = JSON.stringify(allLogs);
  for (const secret of [KEY, CVU, 'Persona Tercera']) assert.ok(!logText.includes(secret), secret);
  for (const [, entry] of allLogs) for (const key of Object.keys(entry)) assert.ok(['op', 'httpStatus', 'code', 'requestId'].includes(key), key);
});

test('a retry after a timeout reuses the same Idempotency-Key and gets the same order', async () => {
  const { client, calls } = harness((url, options, n) => {
    if (n === 1) throw new Error('timeout');
    return reply(201, order());
  });
  assert.equal((await client.createBankWithdrawal(withdrawal)).outcome, 'uncertain');
  const second = await client.createBankWithdrawal(withdrawal);
  assert.equal(second.outcome, 'completed'); assert.equal(second.order.id, 'ord_1');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
});

test('reads: balance, limits and order lookup', async () => {
  const { client, calls } = harness(url => {
    if (url.endsWith('/balances')) return reply(200, { customer_id: 'cus_1', balances: [{ currency: 'USDC', balance: '3.00000000' }, { currency: 'ARS', balance: '15000.50000000' }] });
    if (url.endsWith('/limits')) return reply(200, { customer_id: 'cus_1', limits: [{ operation: 'crypto_withdrawal', currencies: ['USDC'], daily_limit: '1', used: '0', available: '1', min_amount: '1', max_amount: '1' },
      { operation: 'bank_withdrawal', currencies: ['ARS'], daily_limit: '500000.00000000', used: '0.00000000', available: '400000.00000000', min_amount: '1.00000000', max_amount: '300000.00000000' }] });
    return reply(200, order({ status: 'PROCESSING' }));
  });
  assert.equal(await client.getBalanceCents('cus_1'), 1500050n);
  assert.deepEqual(await client.getBankWithdrawalLimit('cus_1'), { minCents: 100n, maxCents: 30000000n, availableCents: 40000000n });
  const found = await client.getOrder('cus_1', 'ord_1', { amountCents: 993332n, cvu: CVU, idempotencyKey: withdrawal.idempotencyKey });
  assert.equal(found.outcome, 'processing');
  assert.equal(calls.at(-1).url, 'https://api.staging.21millions.com/v1/partner/customers/cus_1/orders/ord_1');
  assert.equal(calls.at(-1).options.method, 'GET');
  const failing = harness(() => reply(503, errorBody('PROVIDER_UNAVAILABLE'))).client;
  await assert.rejects(() => failing.getBalanceCents('cus_1'), /twentyone_unavailable/);
  const unauthorized = harness(() => reply(401, errorBody('PARTNER_AUTHENTICATION_FAILED'))).client;
  await assert.rejects(() => unauthorized.getBankWithdrawalLimit('cus_1'), error => error.code === 'twentyone_not_configured' && !error.message.includes(KEY));
});

test('the client refuses keys of another environment and never reveals them', () => {
  for (const [environment, key] of [['staging', 'nx_live_abc'], ['production', KEY], ['staging', ''], ['mainnet', KEY]])
    assert.throws(() => createTwentyOneClient({ environment, key }), error => error.code === 'twentyone_not_configured' && !error.message.includes(KEY));
  assert.equal(clientForEnvironment('staging', { FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'staging', TWENTYONE_SECRET_KEY: KEY }).environment, 'staging');
  assert.equal(clientForEnvironment('production', { FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'staging', TWENTYONE_SECRET_KEY: KEY }), null);
  assert.equal(clientForEnvironment('staging', { FACTORING_PAYMENTS_MODE: 'disabled' }), null);
  assert.equal(clientForEnvironment('simulated', {}).environment, 'simulated');
});

test('the simulator completes at once, deterministically and without money', async () => {
  const sim = createSimulatedTwentyOne();
  const first = await sim.createBankWithdrawal(withdrawal), again = await sim.createBankWithdrawal(withdrawal);
  assert.equal(first.outcome, 'completed'); assert.equal(first.order.id, again.order.id); assert.match(first.order.id, /^sim_[0-9a-f]{32}$/);
  assert.notEqual((await sim.createBankWithdrawal({ ...withdrawal, idempotencyKey: 'other' })).order.id, first.order.id);
  assert.equal((await sim.getOrder('cus_1', first.order.id, withdrawal)).outcome, 'completed');
  assert.ok(await sim.getBalanceCents('cus_1') > 0n);
  assert.equal(normalizeOrder(order(), { customerId: 'cus_1', amountCents: 993332n, cvu: CVU, idempotencyKey: 'midatopay-factoring-a', orderId: 'ord_2' }).outcome, 'mismatch');
});

test('webhook signatures: valid, expired, during a rotation and tampered', () => {
  const secret = 'whsec_' + 'k'.repeat(43), other = 'whsec_' + 'o'.repeat(43);
  const body = '{"id":"evt_1","type":"order.completed","data":{"order_id":"ord_1"}}';
  const sign = (s, t, b = body) => createHmac('sha256', s).update(`${t}.${b}`).digest('hex');
  const now = 1_790_000_000;
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: `t=${now},v1=${sign(secret, now)}`, secret, nowSeconds: now }), true);
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: `t=${now - 301},v1=${sign(secret, now - 301)}`, secret, nowSeconds: now }), false);
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: `t=${now},v1=${sign(other, now)},v1=${sign(secret, now)}`, secret, nowSeconds: now }), true);
  assert.equal(verifyTwentyOneSignature({ rawBody: body + ' ', header: `t=${now},v1=${sign(secret, now)}`, secret, nowSeconds: now }), false);
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: `t=${now},v1=${sign(secret, now).replace(/^./, c => (c === 'a' ? 'b' : 'a'))}`, secret, nowSeconds: now }), false);
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: '', secret, nowSeconds: now }), false);
  assert.equal(verifyTwentyOneSignature({ rawBody: body, header: `t=${now},v1=${sign(secret, now)}`, secret: 'k'.repeat(43), nowSeconds: now }), false);
});

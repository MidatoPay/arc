import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadQuery, queryCatalog } from './query-catalog.js';

const window = { from: '2026-11-01T00:00:00Z', to: '2026-11-04T00:00:00Z' };
test('read catalog uses documented paths, order types and query parameters', () => {
  const cases = [
    ['depositAccounts', '/customers/customer_a/deposit-accounts', {}],
    ['deposits', '/deposits?from=2026-11-01T00%3A00%3A00Z&to=2026-11-04T00%3A00%3A00Z&limit=25&offset=50', { ...window, limit: 25, offset: 50 }],
    ['customerBalances', '/customers/customer_a/balances', {}],
    ['portfolioBalances', '/balances', {}],
    ['customerMovements', '/customers/customer_a/movements?kind=swap', { kind: 'swap' }],
    ['portfolioMovements', '/movements?from=2026-11-01T00%3A00%3A00Z&to=2026-11-04T00%3A00%3A00Z&kind=cash_in', { ...window, kind: 'cash_in' }],
    ['swaps', '/customers/customer_a/orders?status=COMPLETED&type=swap', { status: 'COMPLETED' }],
    ['bankWithdrawals', '/customers/customer_a/orders?type=bank_withdrawal', {}],
    ['cryptoWithdrawals', '/customers/customer_a/orders?type=crypto_withdrawal', {}],
    ['order', '/customers/customer_a/orders/order_a', {}],
  ];
  assert.equal(cases.length, Object.keys(queryCatalog).length);
  for (const [queryName, path, filters] of cases) {
    assert.deepEqual(buildReadQuery({ queryName, customerId: 'customer_a', orderId: 'order_a', filters }), { method: 'GET', path });
  }
});

test('global reads work without a customer; customer and order reads require safe identifiers', () => {
  assert.equal(buildReadQuery({ queryName: 'portfolioBalances' }).path, '/balances');
  assert.ok(buildReadQuery({ queryName: 'deposits', filters: window }).path.startsWith('/deposits?'));
  for (const customerId of [undefined, '', '../balances', 'a/b', 'a?x=1', {}, 'a'.repeat(129)]) {
    assert.throws(() => buildReadQuery({ queryName: 'depositAccounts', customerId }), { status: 400 });
  }
  assert.throws(() => buildReadQuery({ queryName: 'order', customerId: 'customer_a', orderId: '../x' }), { status: 400 });
});

test('filters reject arbitrary routes, unsupported fields, types and pagination', () => {
  for (const queryName of ['https://example.com', '/withdrawals', 'constructor', '__proto__', 'toString', undefined]) {
    assert.throws(() => buildReadQuery({ queryName }), { status: 400 });
  }
  for (const filters of [[], null, 'limit=10', { limit: 0 }, { limit: 101 }, { limit: true }, { limit: '1e2' }, { limit: 1.5 }, { offset: -1 }, { offset: '9007199254740993' }, { type: 'crypto_withdrawal' }, { status: 'PENDING' }, { url: 'https://example.com' }]) {
    assert.throws(() => buildReadQuery({ queryName: 'swaps', customerId: 'customer_a', filters }), { status: 400 });
  }
  assert.throws(() => buildReadQuery({ queryName: 'deposits', filters: { ...window, customer_id: 'customer_a' } }), { status: 400 });
  assert.throws(() => buildReadQuery({ queryName: 'customerMovements', customerId: 'customer_a', filters: { kind: 'unknown' } }), { status: 400 });
});

test('date windows enforce UTC, calendar dates, paired bounds and the 400-day maximum', () => {
  for (const filters of [
    {}, { from: window.from }, { from: window.from, to: window.from }, { from: window.to, to: window.from },
    { from: '2024-01-01T00:00:00Z', to: window.to },
    { from: '2026-02-30T00:00:00Z', to: window.to },
    { from: '2026-11-01T00:00:00-03:00', to: window.to },
    { from: 'invalid', to: window.to },
  ]) assert.throws(() => buildReadQuery({ queryName: 'deposits', filters }), { status: 400 });
  const from = '2025-01-01T00:00:00.000Z';
  const to = new Date(Date.parse(from) + 400 * 86400000).toISOString();
  assert.ok(buildReadQuery({ queryName: 'deposits', filters: { from, to } }));
  assert.ok(buildReadQuery({ queryName: 'customerMovements', customerId: 'customer_a' }));
  assert.throws(() => buildReadQuery({ queryName: 'customerMovements', customerId: 'customer_a', filters: { from } }), { status: 400 });
});

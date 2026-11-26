// Scriptable fake of the 21 Millions client for the factoring tests (not a test file).
// By default every withdrawal completes at once, like the simulator; `script`
// overrides the answer per purpose and attempt.
import { createHash } from 'node:crypto';
import { CVUS } from './factoring-fixtures.js';

export function purposeOf(cvu) {
  if (cvu === CVUS.fee) return 'fee';
  if (cvu === CVUS.issuer || cvu === CVUS.issuer2) return 'net';
  return 'nominal';
}

export function fakeProvider({ balance = 10n ** 12n, limits = { minCents: 1n, maxCents: 10n ** 12n, availableCents: 10n ** 12n }, script = {} } = {}) {
  const calls = [];
  const attempts = {};
  const orderId = key => 'ord_' + createHash('sha256').update(key).digest('hex').slice(0, 16);
  const ok = (input, status = 'COMPLETED', id = orderId(input.idempotencyKey)) => ({ outcome: status === 'COMPLETED' ? 'completed' : status === 'FAILED' ? 'failed' : 'processing',
    order: { id, status, coelsaId: status === 'COMPLETED' ? 'C-' + id : null }, httpStatus: 201 });
  const provider = {
    environment: 'simulated', calls, ok,
    async getBalanceCents(customerId) { calls.push({ op: 'balance', customerId }); return typeof balance === 'function' ? balance(customerId) : balance; },
    async getBankWithdrawalLimit(customerId) { calls.push({ op: 'limits', customerId }); return limits; },
    async createBankWithdrawal(input) {
      const purpose = purposeOf(input.cvu);
      attempts[purpose] = (attempts[purpose] || 0) + 1;
      calls.push({ op: 'withdrawal', purpose, key: input.idempotencyKey, amountCents: input.amountCents, cvu: input.cvu, customerId: input.customerId });
      const handler = script[purpose];
      return handler ? handler(input, attempts[purpose], provider) : ok(input);
    },
    async getOrder(customerId, id, expected) {
      const purpose = purposeOf(expected.cvu);
      calls.push({ op: 'order', purpose, id, key: expected.idempotencyKey });
      const handler = script[`${purpose}Lookup`];
      return handler ? handler({ customerId, id, ...expected }, provider) : ok({ idempotencyKey: expected.idempotencyKey }, 'COMPLETED', id);
    },
    withdrawals(purpose) { return calls.filter(c => c.op === 'withdrawal' && (!purpose || c.purpose === purpose)); },
  };
  return provider;
}

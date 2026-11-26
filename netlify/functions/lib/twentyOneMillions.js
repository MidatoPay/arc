import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentError } from './paymentCore.js';
import { TWENTYONE_ENVIRONMENTS, twentyOneEnvironment } from './factoringConfig.js';
// Server-side client of the 21 Millions Partner API (contract read 2026-11-26,
// v2.0.0) and an explicit simulator with the same interface (plan 7.6).
// Logs carry only {op, httpStatus, code, requestId}: never the key, headers,
// bodies, CVUs or the bank `proof` (it holds third-party personal data).

/** 123456n → '1234.56'. */
export function centsToAmount(cents) {
  const n = BigInt(cents);
  if (n < 0n) throw new PaymentError('invalid_amount', 400);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}

/** '1234.56000000' → 123456n. Rejects any non-zero digit after the second decimal. */
export function amountToCents(text) {
  const match = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(String(text ?? ''));
  if (!match) throw new PaymentError('twentyone_invalid_amount', 502);
  const fraction = match[2] || '';
  if (/[1-9]/.test(fraction.slice(2))) throw new PaymentError('twentyone_invalid_amount', 502);
  return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
}

const STATUS_OUTCOME = { COMPLETED: 'completed', PROCESSING: 'processing', FAILED: 'failed' };
const REJECTED_409 = new Set(['RAIL_NOT_READY', 'PROVIDER_DISABLED']);

/**
 * Checks that a provider order is exactly the withdrawal we asked for.
 * → { outcome: completed|processing|failed|mismatch, order }
 */
export function normalizeOrder(raw, expected, log = () => {}) {
  const destination = raw?.destination;
  let amount;
  try { amount = amountToCents(raw?.source_amount); } catch { amount = null; }
  const order = { id: typeof raw?.id === 'string' ? raw.id : null, status: raw?.status || null,
    coelsaId: typeof raw?.proof?.coelsa_id === 'string' ? raw.proof.coelsa_id : null };
  const matches = order.id && raw.customer_id === expected.customerId && raw.type === 'bank_withdrawal' && raw.source_currency === 'ARS' &&
    amount === BigInt(expected.amountCents) && destination?.type === 'bank' && destination?.account_type === 'cvu' &&
    destination?.value === expected.cvu && (raw.idempotency_key === undefined || raw.idempotency_key === expected.idempotencyKey) &&
    (!expected.orderId || order.id === expected.orderId);
  if (!matches) return { outcome: 'mismatch', order };
  const outcome = STATUS_OUTCOME[raw.status];
  if (!outcome) {
    // New statuses may appear within a major version: never treat them as success.
    log('twentyone_unknown_status', { op: 'order' });
    return { outcome: 'processing', order };
  }
  return { outcome, order };
}

function retryAfterSeconds(headers) {
  const value = headers?.get?.('retry-after');
  const seconds = Number.parseInt(value || '', 10);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : 60;
}

export function createTwentyOneClient({ environment, key, request = fetch, log = console.error, timeoutMs = 15000 } = {}) {
  const config = TWENTYONE_ENVIRONMENTS[environment];
  if (!config || typeof key !== 'string' || !key.startsWith(config.prefix) || key.length <= config.prefix.length)
    throw new PaymentError('twentyone_not_configured', 503);
  async function call(op, method, path, { body, idempotencyKey, requestId } = {}) {
    const headers = { 'x-api-key': key, accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (requestId) headers['X-Request-Id'] = requestId;
    let response;
    try {
      response = await request(`${config.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      log('twentyone_request_failed', { op, httpStatus: null, code: 'network_or_timeout', requestId: requestId || null });
      return { httpStatus: null, json: null };
    }
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    const code = typeof json?.error?.code === 'string' ? json.error.code : null;
    if (!response.ok) log('twentyone_request_failed', { op, httpStatus: response.status, code,
      requestId: json?.error?.request_id || response.headers?.get?.('x-request-id') || requestId || null });
    return { httpStatus: response.status, json, code, retryAfter: retryAfterSeconds(response.headers) };
  }
  const readFailure = result => {
    if ([401, 403].includes(result.httpStatus)) return new PaymentError('twentyone_not_configured', 503);
    if (result.httpStatus === 404) return new PaymentError('twentyone_customer_not_found', 503);
    return new PaymentError('twentyone_unavailable', 503);
  };
  const customerPath = id => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) throw new PaymentError('twentyone_invalid_customer', 503);
    return `/customers/${encodeURIComponent(id)}`;
  };
  return {
    environment,
    async getBalanceCents(customerId) {
      const result = await call('balances', 'GET', `${customerPath(customerId)}/balances`);
      if (result.httpStatus !== 200 || !Array.isArray(result.json?.balances)) throw readFailure(result);
      const ars = result.json.balances.find(b => b.currency === 'ARS');
      return ars ? amountToCents(ars.balance) : 0n;
    },
    async getBankWithdrawalLimit(customerId) {
      const result = await call('limits', 'GET', `${customerPath(customerId)}/limits`);
      if (result.httpStatus !== 200 || !Array.isArray(result.json?.limits)) throw readFailure(result);
      const limit = result.json.limits.find(l => l.operation === 'bank_withdrawal' && (!Array.isArray(l.currencies) || l.currencies.includes('ARS')));
      if (!limit) throw new PaymentError('twentyone_unavailable', 503);
      return { minCents: amountToCents(limit.min_amount), maxCents: amountToCents(limit.max_amount), availableCents: amountToCents(limit.available) };
    },
    async createBankWithdrawal({ customerId, idempotencyKey, amountCents, cvu, requestId }) {
      if (!/^\d{22}$/.test(cvu || '') || typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 255)
        throw new PaymentError('twentyone_invalid_withdrawal', 500);
      const expected = { customerId, amountCents, cvu, idempotencyKey };
      const result = await call('withdrawal', 'POST', `${customerPath(customerId)}/withdrawals/bank`, { idempotencyKey, requestId,
        body: { amount: centsToAmount(amountCents), currency: 'ARS', destination: { type: 'cvu', value: cvu } } });
      const { httpStatus, code } = result;
      if (httpStatus === 201 || httpStatus === 200) {
        if (!result.json) return { outcome: 'uncertain', httpStatus, code: 'unreadable_body' };
        return { ...normalizeOrder(result.json, expected, log), httpStatus };
      }
      if (httpStatus === 502) return { outcome: 'failed', httpStatus, code: code || 'EXECUTION_REJECTED' };
      if (httpStatus === 409 && code === 'IDEMPOTENCY_KEY_CONFLICT') return { outcome: 'mismatch', httpStatus, code };
      if (httpStatus === 409 && REJECTED_409.has(code)) return { outcome: 'rejected', httpStatus, code };
      if (httpStatus === 422) return { outcome: 'rejected', httpStatus, code: code || 'VALIDATION_ERROR' };
      if (httpStatus === 429) return { outcome: 'retry', httpStatus, code: code || 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: result.retryAfter };
      if (httpStatus === 503) return { outcome: 'retry', httpStatus, code: code || 'PROVIDER_UNAVAILABLE', retryAfterSeconds: 180 };
      if ([401, 403, 404].includes(httpStatus)) return { outcome: 'configuration', httpStatus, code };
      // 500, timeouts, network errors, unknown 409s and anything else: the order may exist.
      return { outcome: 'uncertain', httpStatus, code: code || (httpStatus ? null : 'network_or_timeout') };
    },
    async getOrder(customerId, orderId, expected) {
      const result = await call('order', 'GET', `${customerPath(customerId)}/orders/${encodeURIComponent(orderId)}`);
      if (result.httpStatus === 200 && result.json) return { ...normalizeOrder(result.json, { ...expected, customerId, orderId }, log), httpStatus: 200 };
      if ([401, 403].includes(result.httpStatus)) return { outcome: 'configuration', httpStatus: result.httpStatus, code: result.code };
      if (result.httpStatus === 429) return { outcome: 'retry', httpStatus: 429, code: result.code, retryAfterSeconds: result.retryAfter };
      return { outcome: 'uncertain', httpStatus: result.httpStatus, code: result.code };
    },
  };
}

/**
 * No money moves: every withdrawal completes at once with a deterministic id,
 * so retries with the same key return the same order. Stateless on purpose.
 */
export function createSimulatedTwentyOne() {
  const orderFor = ({ customerId, idempotencyKey, amountCents, cvu }) => ({
    id: 'sim_' + createHash('sha256').update(`${customerId}|${idempotencyKey}`).digest('hex').slice(0, 32),
    customer_id: customerId, type: 'bank_withdrawal', status: 'COMPLETED', source_currency: 'ARS', target_currency: 'ARS',
    source_amount: `${centsToAmount(amountCents)}000000`, destination: { type: 'bank', account_type: 'cvu', value: cvu },
    idempotency_key: idempotencyKey, proof: null });
  return {
    environment: 'simulated',
    async getBalanceCents() { return 10n ** 15n; },
    async getBankWithdrawalLimit() { return { minCents: 1n, maxCents: 10n ** 14n, availableCents: 10n ** 14n }; },
    async createBankWithdrawal(input) {
      const expected = { customerId: input.customerId, amountCents: input.amountCents, cvu: input.cvu, idempotencyKey: input.idempotencyKey };
      return { ...normalizeOrder(orderFor(input), expected), httpStatus: 201 };
    },
    async getOrder(customerId, orderId, expected) {
      const raw = orderFor({ ...expected, customerId });
      return { ...normalizeOrder(raw, { ...expected, customerId, orderId }), httpStatus: 200 };
    },
  };
}

/** Client for the environment an order was created in; null when that environment is not configured now. */
export function clientForEnvironment(environment, env = process.env, { request, log } = {}) {
  if (environment === 'simulated') return createSimulatedTwentyOne();
  if (!TWENTYONE_ENVIRONMENTS[environment]) return null;
  let current;
  try { current = twentyOneEnvironment(env); } catch { return null; }
  if (current.mode !== 'live' || current.environment !== environment || !current.ready) return null;
  return createTwentyOneClient({ environment, key: env.TWENTYONE_SECRET_KEY.trim(), ...(request ? { request } : {}), ...(log ? { log } : {}) });
}

/** Nexus-Signature: `t=<seconds>,v1=<hex>[,v1=<hex>]` over `t + '.' + rawBody`, HMAC-SHA256 with the whole whsec_ secret. */
export function verifyTwentyOneSignature({ rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300 }) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_') || typeof header !== 'string' || typeof rawBody !== 'string') return false;
  const parts = header.split(',').map(item => item.trim().split('=')).filter(pair => pair.length === 2);
  const t = parts.filter(([k]) => k === 't').map(([, v]) => v);
  const candidates = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/i.test(v)).map(([, v]) => v);
  if (t.length !== 1 || !/^\d{1,12}$/.test(t[0]) || !candidates.length) return false;
  if (Math.abs(nowSeconds - Number(t[0])) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t[0]}.${rawBody}`, 'utf8').digest();
  return candidates.some(candidate => timingSafeEqual(expected, Buffer.from(candidate, 'hex')));
}

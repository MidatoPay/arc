// Helpers to call the factoring handlers like Netlify does (not a test file).
import { randomUUID } from 'node:crypto';
import { PaymentError } from '../netlify/functions/lib/paymentCore.js';
import { WALLETS, USERS } from './factoring-fixtures.js';

/** Bearer token = Privy user ID in tests; no token → 401 like authenticatePayment. */
export const fakeAuthenticate = async event => {
  const token = (event.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new PaymentError('unauthorized', 401);
  return token;
};

/** Privy user with one embedded primary wallet (hdWalletIndex 0). */
export const fakeGetUser = async userId => {
  const address = userId === USERS.issuer ? WALLETS.issuer : userId === USERS.investor ? WALLETS.investor
    : userId === USERS.investor2 ? WALLETS.investor2 : null;
  return { id: userId, linkedAccounts: address ? [{ type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', hdWalletIndex: 0, address }] : [] };
};

export function caller(handler, base) {
  return async (user, method, path, { body, key, query } = {}) => {
    const headers = {};
    if (user) headers.authorization = `Bearer ${user}`;
    if (key !== undefined) headers['idempotency-key'] = key === true ? randomUUID() : key;
    const response = await handler({ httpMethod: method, path: `/.netlify/functions/${base}${path}`, headers,
      queryStringParameters: query || {}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body || '{}') };
  };
}

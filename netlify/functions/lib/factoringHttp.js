import { PaymentError } from './paymentCore.js';
// Request parsing shared by the factoring endpoints.
export function parseBody(event, { empty = false } = {}) {
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'); }
  catch { throw new PaymentError('invalid_json', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PaymentError('invalid_body', 400);
  if (empty && Object.keys(body).length) throw new PaymentError('invalid_body', 400);
  return body;
}

export const idempotencyHeader = event => event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'] || '';

export function normalizePath(event, name) {
  return (event.path || '').replace(new RegExp(`^/\\.netlify/functions/${name}`), `/${name}`);
}

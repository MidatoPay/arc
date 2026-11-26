import { getPaymentDb, json, errorResponse, kickWorker } from './lib/paymentRuntime.js';
import { PaymentError } from './lib/paymentCore.js';
import { verifyTwentyOneSignature } from './lib/twentyOneMillions.js';
import { TWENTYONE_ENVIRONMENTS } from './lib/factoringConfig.js';
// 21 Millions webhook (plan T15, optional). It only speeds up tracking: the
// signature is checked on the raw body before reading it, only the event id,
// type and order id are stored, and the worker still confirms each order with
// GET /orders/{id} (D-17). Personal data in `data` is never stored or logged.
const HANDLED = new Set(['order.completed', 'order.failed']);

export function createTwentyOneWebhookHandler(adapters = {}) {
  return async event => {
    try {
      if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
      const env = adapters.env || process.env;
      const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      const header = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'nexus-signature')?.[1] || '';
      const nowSeconds = Math.floor((adapters.now || Date.now)() / 1000);
      if (!verifyTwentyOneSignature({ rawBody, header, secret: env.TWENTYONE_WEBHOOK_SECRET?.trim(), nowSeconds }))
        throw new PaymentError('invalid_signature', 401);
      let body;
      try { body = JSON.parse(rawBody); } catch { throw new PaymentError('invalid_event', 400); }
      if (typeof body?.id !== 'string' || !body.id || body.id.length > 200 || typeof body.type !== 'string') throw new PaymentError('invalid_event', 400);
      if (!HANDLED.has(body.type)) return json(200, { received: true });
      const orderId = typeof body.data?.id === 'string' && body.data.id.length <= 200 ? body.data.id : null;
      if (!orderId) throw new PaymentError('invalid_event', 400);
      const environment = TWENTYONE_ENVIRONMENTS[env.TWENTYONE_ENVIRONMENT?.trim()] ? env.TWENTYONE_ENVIRONMENT.trim() : 'staging';
      const db = adapters.db || getPaymentDb();
      const stored = await db.query(`INSERT INTO factoring_provider_events(environment,event_id,event_type,provider_order_id)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [environment, body.id, body.type, orderId]);
      if (stored.rowCount) {
        // Look the order up now instead of waiting for its backoff.
        await db.query(`UPDATE factoring_orders SET next_attempt_at=LEAST(next_attempt_at,$3::timestamptz) WHERE environment=$1 AND provider_order_id=$2
          AND status IN ('submitting','processing')`, [environment, orderId, new Date(nowSeconds * 1000).toISOString()]);
        await (adapters.kick || (() => kickWorker({ functionName: 'factoring-worker-background' })))().catch(() => {});
      }
      return json(200, { received: true });
    } catch (error) { return errorResponse(error); }
  };
}
export const handler = createTwentyOneWebhookHandler();

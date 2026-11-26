import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { createTwentyOneWebhookHandler } from '../netlify/functions/twentyone-webhook.js';

const SECRET = 'whsec_' + 'w'.repeat(43);
const NOW = Date.parse('2026-11-25T15:00:00Z');
const env = { TWENTYONE_WEBHOOK_SECRET: SECRET, TWENTYONE_ENVIRONMENT: 'staging' };
const sign = (body, t = Math.floor(NOW / 1000), secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const event = (body, signature, extra = {}) => ({ httpMethod: 'POST', headers: { 'Nexus-Signature': signature }, body, ...extra });
const orderEvent = (type = 'order.completed', id = 'evt_' + randomUUID()) => JSON.stringify({ id, type, version: 1, sequence: 7,
  created_at: '2026-11-25T15:00:00Z', data: { id: 'ord_42', status: 'COMPLETED', customer_id: 'cus_1', proof: { counterparty: { name: 'Tercero' } } } });

test('invalid or old signatures are rejected before touching the database', async () => {
  const forbidden = { query: () => assert.fail('no database') };
  const handler = createTwentyOneWebhookHandler({ db: forbidden, env, now: () => NOW, kick: () => assert.fail('no kick') });
  const body = orderEvent();
  assert.equal((await handler(event(body, sign(body, undefined, 'whsec_' + 'x'.repeat(43))))).statusCode, 401);
  assert.equal((await handler(event(body, sign(body, Math.floor(NOW / 1000) - 400)))).statusCode, 401);
  assert.equal((await handler(event(body + ' ', sign(body)))).statusCode, 401);
  assert.equal((await handler(event(body, ''))).statusCode, 401);
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
  const unconfigured = createTwentyOneWebhookHandler({ db: forbidden, env: {}, now: () => NOW });
  assert.equal((await unconfigured(event(body, sign(body)))).statusCode, 401);
});

test('a valid event is stored once, speeds up its order and ignores unhandled types', async t => {
  const { db, close } = await createFactoringDb();
  t.after(close);
  let kicks = 0;
  const handler = createTwentyOneWebhookHandler({ db, env, now: () => NOW, kick: async () => { kicks += 1; } });
  const body = orderEvent('order.completed', 'evt_1');
  const first = await handler(event(Buffer.from(body).toString('base64'), sign(body), { isBase64Encoded: true }));
  assert.deepEqual([first.statusCode, JSON.parse(first.body)], [200, { received: true }]);
  assert.equal((await handler(event(body, sign(body)))).statusCode, 200);
  const rows = (await db.query('SELECT * FROM factoring_provider_events')).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].environment, rows[0].event_id, rows[0].event_type, rows[0].provider_order_id], ['staging', 'evt_1', 'order.completed', 'ord_42']);
  assert.ok(!JSON.stringify(rows).includes('Tercero'));
  assert.equal(kicks, 1);
  const other = JSON.stringify({ id: 'evt_2', type: 'deposit.credited', data: {} });
  assert.equal((await handler(event(other, sign(other)))).statusCode, 200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM factoring_provider_events')).rows[0].n, 1);
  const broken = '{"type":"order.completed"}';
  assert.equal((await handler(event(broken, sign(broken)))).statusCode, 400);
});

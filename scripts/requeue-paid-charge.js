import { getPaymentDb } from '../netlify/functions/lib/paymentRuntime.js';
import { mpRequest } from '../netlify/functions/lib/mercadopago.js';
import { validateOrder } from '../netlify/functions/lib/paymentCore.js';

const reference = process.argv[2];
if (!/^mp_[a-f0-9]{32}$/.test(reference || '')) throw new Error('Expected exact payment reference');
const pool = getPaymentDb();
const db = await pool.connect();
try {
  await db.query('BEGIN');
  const found = await db.query('SELECT id FROM charges WHERE external_reference=$1', [reference]);
  if (found.rows.length !== 1) throw new Error('Charge not found');
  const id = found.rows[0].id;
  const lock = await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [`charge:${id}`]);
  if (!lock.rows[0].locked) throw new Error('Worker is processing this charge; retry later');
  const { rows: [charge] } = await db.query('SELECT * FROM charges WHERE id=$1 FOR UPDATE', [id]);
  if (charge.status !== 'manual_review' || charge.last_error !== 'charge_configuration_changed' ||
      charge.signature || charge.signed_wire || charge.delivered_at || !charge.reserved)
    throw new Error('Charge is not an unsigned reserved configuration-review payment');
  if (charge.environment !== process.env.MP_ENVIRONMENT || charge.network !== process.env.VITE_SOLANA_CLUSTER ||
      charge.seller_id !== process.env.MP_USER_ID)
    throw new Error('Payment environment does not match');
  const settings = { token: process.env.MP_ACCESS_TOKEN };
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(charge.order_id)}`, settings);
  const result = validateOrder(order, charge);
  if (!result.paid || result.refunded || result.terminal) throw new Error('Provider has not confirmed an eligible payment');
  const archived = await db.query('SELECT signature FROM payment_payout_attempts WHERE charge_id=$1 LIMIT 1', [id]);
  if (archived.rows.length) throw new Error('Archived payout requires separate review');
  const updated = await db.query(`UPDATE charges SET status='paid',last_error=NULL,next_attempt_at=now(),
    provider_status=$2,provider_detail=$3,payment_id=$4,paid_at=COALESCE(paid_at,now()),reconciled_at=now()
    WHERE id=$1 RETURNING id,external_reference,order_id,status,last_error,next_attempt_at,signature,
    usdc_raw,amount_cents,reserved`, [id,order.status,order.status_detail,result.paymentId]);
  await db.query('COMMIT');
  console.log(JSON.stringify({ requeued: updated.rows[0] }));
} catch (error) {
  await db.query('ROLLBACK');
  console.error(JSON.stringify({error:error.code || error.name,message:error.message}));
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}

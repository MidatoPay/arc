import { getPaymentDb } from './paymentRuntime.js';
import { factoringSettings } from './factoringConfig.js';
import { applyTacitAcceptances, expireOffers, markDefaults } from './factoringService.js';
import { processTake } from './factoringTakes.js';
import { processPayment } from './factoringPayments.js';
import { iso, nowMs, withSessionLock } from './factoringDb.js';
// Scheduled factoring worker (plan T13): time-driven transitions and order
// tracking, outside the browser. Money goes before the chain; one failing row
// never stops the others; at most 100 calls to 21 Millions per run (its limit
// is 120 per minute per credential).
export const MAX_PROVIDER_CALLS = 100;

/** The pilot is active when it is open to everyone or has an allowlist. */
export function factoringActive(env = process.env) {
  return env.FACTORING_ENABLED === 'true' || Boolean((env.FACTORING_ALLOWED_USER_IDS || '').split(/[\s,]+/).filter(Boolean).length);
}

export async function runFactoringWorker({ budgetMs = 550000, now = Date.now, db, settings, client, env = process.env, log = console.error } = {}) {
  if (!factoringActive(env)) return { skipped: 'factoring_disabled' };
  let config = settings;
  try { config ||= factoringSettings(env); }
  catch (error) { log('factoring_worker_failed', { code: error.code || 'invalid_configuration' }); return { skipped: 'invalid_configuration' }; }
  const pool = db || getPaymentDb();
  const deadline = Date.now() + budgetMs;
  const summary = { tacit: 0, expired: 0, takes: 0, payments: 0, defaulted: 0, providerCalls: 0, errors: 0 };
  const safely = async (job, fn) => {
    try { return await fn(); }
    catch (error) { summary.errors += 1; log('factoring_worker_job_failed', { job, code: error?.code || 'unclassified' }); return 0; }
  };
  const run = await withSessionLock(pool, 'factoring-worker', async work => {
    const opts = { now, settings: config, client, env };
    summary.tacit = await safely('tacit', () => applyTacitAcceptances(work, opts));
    summary.expired = await safely('expire', () => expireOffers(work, opts));
    const due = iso(nowMs(now));
    const takes = await safely('list_takes', async () => (await work.query(`SELECT t.id FROM invoice_takes t WHERE t.status='paying'
      OR (t.status='manual_review' AND EXISTS (SELECT 1 FROM factoring_orders o WHERE o.take_id=t.id AND o.purpose<>'nominal_to_investor'
        AND o.status IN ('pending','submitting','processing')))
      ORDER BY t.created_at LIMIT 50`)).rows) || [];
    for (const { id } of takes) {
      if (summary.providerCalls >= MAX_PROVIDER_CALLS || Date.now() > deadline) break;
      const calls = await safely('take', () => processTake(work, id, opts));
      summary.providerCalls += calls; summary.takes += 1;
    }
    const payments = await safely('list_payments', async () => (await work.query(`SELECT id FROM factoring_orders WHERE purpose='nominal_to_investor'
      AND status IN ('pending','submitting','processing') AND next_attempt_at<=$1 ORDER BY next_attempt_at LIMIT 50`, [due])).rows) || [];
    for (const { id } of payments) {
      if (summary.providerCalls >= MAX_PROVIDER_CALLS || Date.now() > deadline) break;
      const calls = await safely('payment', () => processPayment(work, id, opts));
      summary.providerCalls += calls; summary.payments += 1;
    }
    summary.defaulted = await safely('default', () => markDefaults(work, opts));
    // Phase 6 (on-chain registry, T21) is out of the MVP: events stay queued as pending.
    return summary;
  });
  return run.locked ? run.value : { skipped: 'locked' };
}

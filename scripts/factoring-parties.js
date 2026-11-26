// Loads pilot parties from a JSON file outside the repo:
//   npm run factoring:parties -- <path outside the repo>
// Running it against a real database requires explicit authorization.
// Prints totals only: never CUITs, names, CVUs or customer IDs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPaymentDb } from '../netlify/functions/lib/paymentRuntime.js';
import { assertOutsideRepo, upsertParties, validatePartiesFile } from '../netlify/functions/lib/factoringParties.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let db;
try {
  const path = assertOutsideRepo(process.argv[2], repoRoot);
  let json;
  try { json = JSON.parse(await readFile(path, 'utf8')); } catch { throw Object.assign(new Error('unreadable or invalid JSON file'), { code: 'invalid_parties_file' }); }
  const parties = validatePartiesFile(json);
  db = getPaymentDb();
  const result = await upsertParties(db, parties);
  const byRole = parties.reduce((totals, p) => ({ ...totals, [p.role]: (totals[p.role] || 0) + 1 }), {});
  console.log(JSON.stringify({ ok: true, total: parties.length, byRole, ...result }));
} catch (error) {
  // Validation messages carry index and field only; database errors are reduced to their code.
  console.error(JSON.stringify({ ok: false, error: error.code || 'factoring_parties_failed',
    ...(error.code === 'invalid_parties_file' ? { detail: error.message } : {}) }));
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}

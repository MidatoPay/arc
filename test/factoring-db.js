// Test helper (not a test file): PGlite with the base schema, every payment
// migration in the order of scripts/migrate-payments.js, and the factoring
// migration applied twice to prove it is idempotent.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const PAYMENT_MIGRATIONS = ['20261013_mercadopago.sql', '20261013_commission_history.sql', '20261014_merchant_pos.sql',
  '20261014_merchant_pos_assignments.sql', '20261016_charge_paid_at.sql', '20261016_merchant_profiles.sql',
  '20261016_wallet_transfers.sql'];
export const FACTORING_MIGRATION = '20261125_factoring_pilot.sql';

const read = file => readFile(new URL(`../db/${file}`, import.meta.url), 'utf8');

export async function createFactoringDb({ factoring = true } = {}) {
  const engine = new PGlite();
  await engine.waitReady;
  // gen_random_uuid is built in; PGlite has no pgcrypto extension.
  await engine.exec((await read('schema.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  for (const file of PAYMENT_MIGRATIONS) await engine.exec(await read(`migrations/${file}`));
  if (factoring) {
    const sql = await read(`migrations/${FACTORING_MIGRATION}`);
    await engine.exec(sql);
    await engine.exec(sql);
  }
  const query = async (sql, params) => {
    const result = await engine.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  // Serialized connections: PGlite is a single session, so a "client" holds it
  // until release, like a pooled connection inside a transaction.
  let tail = Promise.resolve();
  const db = {
    query,
    connect: async () => {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query, release: () => release() };
    },
  };
  return { engine, db, close: () => engine.close() };
}

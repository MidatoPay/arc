import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { validatePartiesFile, upsertParties, assertOutsideRepo } from '../netlify/functions/lib/factoringParties.js';
import { createFactoringDb } from './factoring-db.js';
import { makeCuit, cvu } from './factoring-fixtures.js';

const debtorCuit = makeCuit('30', 40000000);
const file = (parties) => ({ version: 1, parties });
const valid = () => file([
  { role: 'issuer', userId: 'did:privy:issuer1', cuit: makeCuit('30', 10000000), legalName: 'Emisor SA', cvu: cvu(1),
    termsAcceptedAt: '2026-11-20', kycStatus: 'approved', kycSource: '21millions', frameworkSha256: 'a'.repeat(64) },
  { role: 'investor', userId: 'did:privy:investor1', cuit: makeCuit('20', 20000000), legalName: 'Inversor SRL', cvu: cvu(2),
    twentyOneCustomerId: 'cus_investor', investorType: 'persona_juridica', termsAcceptedAt: '2026-11-20', kycStatus: 'approved', kycSource: '21millions' },
  { role: 'debtor', userId: 'did:privy:debtor1', cuit: debtorCuit, legalName: 'Deudor SA', twentyOneCustomerId: 'cus_debtor',
    termsAcceptedAt: '2026-11-20', kycStatus: 'approved', kycSource: '21millions' },
]);
const failure = (json, field) => {
  assert.throws(() => validatePartiesFile(json), error => {
    assert.equal(error.code, 'invalid_parties_file');
    assert.equal(error.field, field);
    // Never echo personal data in the message.
    for (const p of json.parties || []) for (const value of [p.cuit, p.legalName, p.cvu]) if (value) assert.ok(!error.message.includes(String(value)));
    return true;
  });
};

test('a valid parties file normalizes every role', () => {
  const parties = validatePartiesFile(valid());
  assert.equal(parties.length, 3);
  assert.equal(parties[1].investorType, 'persona_juridica');
  assert.equal(parties[2].cvu, null);
  assert.equal(parties[0].twentyOneCustomerId, null);
});

test('invalid entries name the index and field without personal data', () => {
  const mutate = (index, change) => { const json = valid(); json.parties[index] = { ...json.parties[index], ...change }; return json; };
  failure(mutate(2, { cuit: debtorCuit.slice(0, 10) + ((Number(debtorCuit[10]) + 1) % 10) }), 'cuit');
  failure(mutate(0, { role: 'admin' }), 'role');
  failure(mutate(1, { cvu: '1'.repeat(21) }), 'cvu');
  failure(mutate(0, { cvu: undefined }), 'cvu');
  failure(mutate(1, { investorType: undefined }), 'investorType');
  failure(mutate(2, { twentyOneCustomerId: undefined }), 'twentyOneCustomerId');
  failure(mutate(2, { termsAcceptedAt: undefined }), 'termsAcceptedAt');
  failure(mutate(0, { password: 'x' }), 'unknown_key');
  const twoDebtors = valid();
  twoDebtors.parties.push({ ...twoDebtors.parties[2], userId: 'did:privy:debtor2' });
  failure(twoDebtors, 'duplicate_debtor_cuit');
  assert.throws(() => validatePartiesFile({ version: 2, parties: [] }), /invalid|version/);
});

test('paths inside the repository are rejected', () => {
  const root = resolve('.');
  for (const inside of ['factoring-parties.json', join(root, 'docs', 'parties.json'), root])
    assert.throws(() => assertOutsideRepo(inside, root), error => error.code === 'parties_path_inside_repo');
  if (process.platform === 'win32')
    assert.throws(() => assertOutsideRepo(join(root.toUpperCase(), 'x.json'), root), error => error.code === 'parties_path_inside_repo');
  assert.equal(assertOutsideRepo(join(tmpdir(), 'parties.json'), root), resolve(tmpdir(), 'parties.json'));
  assert.throws(() => assertOutsideRepo('', root), error => error.code === 'parties_path_required');
  assert.match(readFileSync('.gitignore', 'utf8'), /^factoring-parties\*\.json$/m);
});

test('reapplying the same file updates without duplicating, and the database keeps one debtor per CUIT', async t => {
  const { db, close } = await createFactoringDb();
  t.after(close);
  assert.deepEqual(await upsertParties(db, validatePartiesFile(valid())), { inserted: 3, updated: 0 });
  const again = valid(); again.parties[0].legalName = 'Emisor Renombrado SA';
  assert.deepEqual(await upsertParties(db, validatePartiesFile(again)), { inserted: 0, updated: 3 });
  const rows = (await db.query('SELECT role,legal_name FROM factoring_parties ORDER BY role')).rows;
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.role === 'issuer').legal_name, 'Emisor Renombrado SA');
  const other = file([{ ...valid().parties[2], userId: 'did:privy:debtor2' }]);
  await assert.rejects(() => upsertParties(db, validatePartiesFile(other)));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM factoring_parties WHERE role='debtor'")).rows[0].n, 1);
});

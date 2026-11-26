import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factoringSettings, twentyOneEnvironment } from '../netlify/functions/lib/factoringConfig.js';
import { factoringEnabledFor, assertFactoringEnabled, isFactoringAdmin, factoringRoles } from '../netlify/functions/lib/factoringAccess.js';
import { createFactoringDb } from './factoring-db.js';
import { makeCuit, cvu } from './factoring-fixtures.js';

const SECRET = 'nx_live_' + 'S3cr3t'.repeat(6);
const base = { FACTORING_PAYMENTS_MODE: 'simulated', FACTORING_FEE_CVU: cvu(7) };
const codeOf = fn => { try { fn(); return null; } catch (error) { return error; } };

test('the pilot allowlist matches exact Privy IDs and admins are a separate list', () => {
  const env = { FACTORING_ENABLED: 'false', FACTORING_ALLOWED_USER_IDS: 'did:privy:pilot, did:privy:second', FACTORING_ADMIN_USER_IDS: 'did:privy:admin' };
  assert.equal(factoringEnabledFor('did:privy:pilot', env), true);
  assert.equal(factoringEnabledFor('did:privy:second', env), true);
  for (const user of ['did:privy:pilo', 'did:privy:pilot-extra', '', null, 'other', 'did:privy:admin']) {
    assert.equal(factoringEnabledFor(user, env), false);
    assert.throws(() => assertFactoringEnabled(user, env), error => error.code === 'factoring_disabled' && error.status === 503);
  }
  assert.equal(factoringEnabledFor('other', { ...env, FACTORING_ENABLED: 'true' }), true);
  assert.equal(factoringEnabledFor('did:privy:pilot', { ...env, FACTORING_ALLOWED_USER_IDS: '' }), false);
  assert.equal(isFactoringAdmin('did:privy:admin', env), true);
  assert.equal(isFactoringAdmin('did:privy:pilot', env), false);
  assert.equal(isFactoringAdmin('did:privy:admin', { PAYMENTS_ADMIN_USER_IDS: 'did:privy:admin' }), false);
});

test('defaults are the plan values and the payments mode starts disabled', () => {
  const settings = factoringSettings({});
  assert.deepEqual({ ...settings }, { enabled: false, paymentsMode: 'disabled', rateBps: 3500, feeBps: 250, acceptanceDays: 21,
    offerHours: 72, maxNominalCents: null, feeCvu: null, frameworkSha256: null, nftEnabled: false, registryAddress: null,
    twentyOneEnvironment: null });
  assert.ok(Object.isFrozen(settings));
  const simulated = factoringSettings({ ...base, FACTORING_MAX_NOMINAL_CENTS: '1000000', FACTORING_FRAMEWORK_SHA256: 'AB'.repeat(32) });
  assert.equal(simulated.twentyOneEnvironment, 'simulated');
  assert.equal(simulated.maxNominalCents, 1000000n);
  assert.equal(simulated.frameworkSha256, 'ab'.repeat(32));
  assert.deepEqual({ ...twentyOneEnvironment(base) }, { mode: 'simulated', environment: 'simulated', base: null, ready: true });
});

test('invalid configuration fails closed with the variable name and never the value', () => {
  const cases = [
    [{ FACTORING_RATE_BPS: '0' }, 'invalid_factoring_rate_bps'],
    [{ FACTORING_RATE_BPS: '20001' }, 'invalid_factoring_rate_bps'],
    [{ FACTORING_FEE_BPS: '10001' }, 'invalid_factoring_fee_bps'],
    [{ FACTORING_ACCEPTANCE_DAYS: '366' }, 'invalid_factoring_acceptance_days'],
    [{ FACTORING_OFFER_HOURS: '1.5' }, 'invalid_factoring_offer_hours'],
    [{ FACTORING_PAYMENTS_MODE: 'real' }, 'invalid_factoring_payments_mode'],
    [{ FACTORING_PAYMENTS_MODE: 'simulated' }, 'invalid_factoring_fee_cvu'],
    [{ ...base, FACTORING_FEE_CVU: '123' }, 'invalid_factoring_fee_cvu'],
    [{ ...base, FACTORING_NFT_ENABLED: 'true' }, 'invalid_factoring_nft_enabled'],
    [{ ...base, FACTORING_MAX_NOMINAL_CENTS: '-5' }, 'invalid_factoring_max_nominal_cents'],
    [{ ...base, FACTORING_FRAMEWORK_SHA256: 'zz' }, 'invalid_factoring_framework_sha256'],
    // live in staging with a production key
    [{ ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'staging', TWENTYONE_SECRET_KEY: SECRET, FACTORING_MAX_NOMINAL_CENTS: '1000000' }, 'invalid_factoring_twentyone_secret_key'],
    // live without a cap
    [{ ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'production', TWENTYONE_SECRET_KEY: SECRET }, 'invalid_factoring_max_nominal_cents'],
    // NFT with live staging (D-16)
    [{ ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'staging', TWENTYONE_SECRET_KEY: 'nx_test_abc', FACTORING_MAX_NOMINAL_CENTS: '1000000', FACTORING_NFT_ENABLED: 'true' }, 'invalid_factoring_nft_enabled'],
    [{ ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'production', TWENTYONE_SECRET_KEY: SECRET, FACTORING_MAX_NOMINAL_CENTS: '1000000', FACTORING_NFT_ENABLED: 'true', FACTORING_REGISTRY_ADDRESS: '0x' + '1'.repeat(40), FACTORING_REGISTRY_SECRET_KEY: 'short' }, 'invalid_factoring_registry_secret_key'],
    [{ ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'mainnet', TWENTYONE_SECRET_KEY: SECRET, FACTORING_MAX_NOMINAL_CENTS: '1' }, 'invalid_factoring_twentyone_environment'],
  ];
  for (const [env, expected] of cases) {
    const error = codeOf(() => factoringSettings(env));
    assert.equal(error?.code, expected, JSON.stringify(Object.keys(env)));
    assert.equal(error.status, 503);
    assert.ok(!error.message.includes(SECRET) && !JSON.stringify(error).includes(SECRET));
  }
});

test('a valid live production configuration never exposes the credential', () => {
  const env = { ...base, FACTORING_PAYMENTS_MODE: 'live', TWENTYONE_ENVIRONMENT: 'production', TWENTYONE_SECRET_KEY: SECRET,
    FACTORING_MAX_NOMINAL_CENTS: '1000000', FACTORING_NFT_ENABLED: 'true', FACTORING_REGISTRY_ADDRESS: '0x' + 'a'.repeat(40),
    FACTORING_REGISTRY_SECRET_KEY: '0x' + 'b'.repeat(64) };
  const settings = factoringSettings(env);
  assert.equal(settings.twentyOneEnvironment, 'production');
  assert.equal(settings.nftEnabled, true);
  const environment = twentyOneEnvironment(env);
  assert.equal(environment.ready, true);
  assert.equal(environment.base, 'https://api.21millions.com/v1/partner');
  for (const value of [settings, environment]) {
    const text = JSON.stringify(value, (key, v) => typeof v === 'bigint' ? String(v) : v);
    assert.ok(!text.includes(SECRET) && !text.includes('b'.repeat(64)));
  }
  assert.equal(twentyOneEnvironment({ ...env, TWENTYONE_SECRET_KEY: 'nx_test_x' }).ready, false);
});

test('roles come only from enabled pilot parties', async t => {
  const { db, close } = await createFactoringDb();
  t.after(close);
  await db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,cvu,terms_accepted_at) VALUES('did:privy:a','issuer',$1,'A SA',$2,now())`, [makeCuit('30', 1), cvu(1)]);
  await db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,tw_customer_id,enabled,terms_accepted_at) VALUES('did:privy:a','debtor',$1,'A SA','cus_a',false,now())`, [makeCuit('30', 1)]);
  const roles = await factoringRoles(db, 'did:privy:a');
  assert.equal(roles.issuer.legal_name, 'A SA');
  assert.equal(roles.debtor, null);
  assert.equal(roles.investor, null);
  assert.deepEqual(await factoringRoles(db, 'did:privy:nobody'), { issuer: null, investor: null, debtor: null });
});

test('the env examples document every factoring variable and netlify.toml omits only non-secrets from scanning', () => {
  const names = ['FACTORING_ENABLED', 'FACTORING_ALLOWED_USER_IDS', 'FACTORING_ADMIN_USER_IDS', 'FACTORING_PAYMENTS_MODE',
    'FACTORING_RATE_BPS', 'FACTORING_FEE_BPS', 'FACTORING_ACCEPTANCE_DAYS', 'FACTORING_OFFER_HOURS', 'FACTORING_MAX_NOMINAL_CENTS',
    'FACTORING_FEE_CVU', 'FACTORING_FRAMEWORK_SHA256', 'TWENTYONE_ENVIRONMENT', 'TWENTYONE_SECRET_KEY', 'TWENTYONE_WEBHOOK_SECRET',
    'FACTORING_NFT_ENABLED', 'FACTORING_REGISTRY_ADDRESS', 'FACTORING_REGISTRY_SECRET_KEY', 'FACTORING_ARCA_CHECK'];
  for (const file of ['.env.example', '.env.production.example']) {
    const text = readFileSync(file, 'utf8');
    for (const name of names) assert.match(text, new RegExp(`^${name}=`, 'm'), `${file}: ${name}`);
    assert.doesNotMatch(text, /^VITE_[A-Z_]*(FACTORING|TWENTYONE)/m);
    assert.match(text, /^FACTORING_NFT_ENABLED=false$/m);
  }
  const omit = /SECRETS_SCAN_OMIT_KEYS = "([^"]+)"/.exec(readFileSync('netlify.toml', 'utf8'))[1].split(',');
  for (const name of ['FACTORING_ENABLED', 'FACTORING_PAYMENTS_MODE', 'TWENTYONE_ENVIRONMENT']) assert.ok(omit.includes(name), name);
  for (const secret of omit) assert.doesNotMatch(secret, /SECRET|KEY|CVU|USER_IDS/);
});

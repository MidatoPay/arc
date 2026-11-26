import { PaymentError } from './paymentCore.js';
// All factoring configuration is read and validated here (plan sections 10.1 and 10.2).
// Errors name the variable, never its value. The returned object never holds secrets.
export const TWENTYONE_ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({ base: 'https://api.staging.21millions.com/v1/partner', prefix: 'nx_test_' }),
  production: Object.freeze({ base: 'https://api.21millions.com/v1/partner', prefix: 'nx_live_' }),
});
const PAYMENT_MODES = ['disabled', 'simulated', 'live'];
const invalid = name => new PaymentError(`invalid_factoring_${name}`, 503);

function integer(env, key, fallback, min, max) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d{1,9}$/.test(raw)) throw invalid(key.replace(/^FACTORING_/, '').toLowerCase());
  const value = Number(raw);
  if (value < min || value > max) throw invalid(key.replace(/^FACTORING_/, '').toLowerCase());
  return value;
}

function twentyOneKeyMatches(env, environment) {
  const key = env.TWENTYONE_SECRET_KEY?.trim() || '';
  const prefix = TWENTYONE_ENVIRONMENTS[environment]?.prefix;
  return Boolean(prefix) && key.startsWith(prefix) && key.length > prefix.length && /^[A-Za-z0-9_-]+$/.test(key);
}

function readTwentyOneEnvironment(env) {
  const environment = env.TWENTYONE_ENVIRONMENT?.trim() || 'staging';
  if (!TWENTYONE_ENVIRONMENTS[environment]) throw invalid('twentyone_environment');
  return environment;
}

/** Which 21 Millions environment payments use, without exposing the credential. */
export function twentyOneEnvironment(env = process.env) {
  const mode = env.FACTORING_PAYMENTS_MODE?.trim() || 'disabled';
  if (!PAYMENT_MODES.includes(mode)) throw invalid('payments_mode');
  if (mode === 'disabled') return Object.freeze({ mode, environment: null, base: null, ready: false });
  if (mode === 'simulated') return Object.freeze({ mode, environment: 'simulated', base: null, ready: true });
  const environment = readTwentyOneEnvironment(env);
  return Object.freeze({ mode, environment, base: TWENTYONE_ENVIRONMENTS[environment].base,
    ready: twentyOneKeyMatches(env, environment) });
}

export function factoringSettings(env = process.env) {
  const paymentsMode = env.FACTORING_PAYMENTS_MODE?.trim() || 'disabled';
  if (!PAYMENT_MODES.includes(paymentsMode)) throw invalid('payments_mode');
  const rateBps = integer(env, 'FACTORING_RATE_BPS', 3500, 1, 20000);
  const feeBps = integer(env, 'FACTORING_FEE_BPS', 250, 0, 10000);
  const acceptanceDays = integer(env, 'FACTORING_ACCEPTANCE_DAYS', 21, 1, 365);
  const offerHours = integer(env, 'FACTORING_OFFER_HOURS', 72, 1, 720);
  const capText = env.FACTORING_MAX_NOMINAL_CENTS?.trim();
  if (capText && !/^[1-9]\d{0,17}$/.test(capText)) throw invalid('max_nominal_cents');
  const maxNominalCents = capText ? BigInt(capText) : null;
  const feeCvu = env.FACTORING_FEE_CVU?.trim() || null;
  if (feeCvu && !/^\d{22}$/.test(feeCvu)) throw invalid('fee_cvu');
  if (!feeCvu && paymentsMode !== 'disabled') throw invalid('fee_cvu');
  const framework = env.FACTORING_FRAMEWORK_SHA256?.trim().toLowerCase() || null;
  if (framework && !/^[0-9a-f]{64}$/.test(framework)) throw invalid('framework_sha256');
  const nftText = env.FACTORING_NFT_ENABLED?.trim() || 'false';
  if (!['true', 'false'].includes(nftText)) throw invalid('nft_enabled');
  const nftEnabled = nftText === 'true';
  let twentyOne = { environment: paymentsMode === 'simulated' ? 'simulated' : null };
  if (paymentsMode === 'simulated' && nftEnabled) throw invalid('nft_enabled');
  if (paymentsMode === 'live') {
    const environment = readTwentyOneEnvironment(env);
    if (!twentyOneKeyMatches(env, environment)) throw invalid('twentyone_secret_key');
    if (!maxNominalCents) throw invalid('max_nominal_cents');
    twentyOne = { environment };
  }
  let registryAddress = null;
  if (nftEnabled) {
    // D-16: the public Mainnet registry only records live production payments.
    if (paymentsMode !== 'live' || twentyOne.environment !== 'production') throw invalid('nft_enabled');
    registryAddress = env.FACTORING_REGISTRY_ADDRESS?.trim() || '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress)) throw invalid('registry_address');
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.FACTORING_REGISTRY_SECRET_KEY?.trim() || '')) throw invalid('registry_secret_key');
  }
  return Object.freeze({
    enabled: env.FACTORING_ENABLED === 'true',
    paymentsMode, rateBps, feeBps, acceptanceDays, offerHours, maxNominalCents, feeCvu,
    frameworkSha256: framework, nftEnabled, registryAddress,
    twentyOneEnvironment: twentyOne.environment,
  });
}

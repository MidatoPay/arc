import { concat, getBytes, keccak256, toUtf8Bytes } from 'ethers';
// Hashes and argument lists for the on-chain registry. Nothing personal goes on
// chain: only hashes, statuses, dates, ARS cents, the token ID and wallet addresses.

/** Stable JSON: sorted keys, no spaces, BigInt as decimal text. */
export function canonicalJson(value) {
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new TypeError('canonicalJson: unsupported value');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/** keccak256(salt ‖ canonicalJson(fields)); the 32-byte random salt stops brute force over CUITs. */
export function invoiceCommitment({ salt, fields }) {
  if (!/^[0-9a-f]{64}$/.test(salt || '')) throw new TypeError('invoiceCommitment: salt must be 32 bytes of lowercase hex');
  return keccak256(concat([getBytes('0x' + salt), toUtf8Bytes(canonicalJson(fields))]));
}

export function termsHash({ invoiceHash, quote }) {
  return keccak256(toUtf8Bytes(canonicalJson({ v: 1, invoiceHash, quote })));
}

export function evidenceHash(evidence) {
  return keccak256(toUtf8Bytes(canonicalJson({ v: 1, ...evidence })));
}

/** uint256(keccak256('MIDATO|invoice|v1|' + uuid)) as 0x + 64 hex. Deterministic, so an uncertain mint can be checked. */
export function invoiceTokenId(invoiceId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId || '')) throw new TypeError('invoiceTokenId: UUID required');
  return keccak256(toUtf8Bytes(`MIDATO|invoice|v1|${invoiceId.toLowerCase()}`));
}

/** 'YYYY-MM-DD' → YYYYMMDD integer, readable in the explorer. */
export function chainDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) throw new TypeError('chainDate: ISO date required');
  return Number(isoDate.replaceAll('-', ''));
}

const STATUS_ARGS = ['tokenId', 'detail', 'evidenceHash'];
// Closed list of keys per event kind (plan 8.1). Anything else is rejected.
export const CHAIN_ARG_KEYS = Object.freeze({
  register: Object.freeze(['tokenId', 'issuer', 'invoiceHash', 'frameworkHash', 'nominalCents', 'issueDate', 'dueDate', 'fce', 'simulated']),
  accepted: STATUS_ARGS, rejected: STATUS_ARGS, published: STATUS_ARGS, offer_expired: STATUS_ARGS,
  collected: STATUS_ARGS, defaulted: STATUS_ARGS,
  taken: Object.freeze(['tokenId', 'termsHash', 'assignmentHash', 'rateBps', 'feeBps', 'days', 'discountCents', 'advanceCents', 'feeCents']),
  cede: Object.freeze(['tokenId', 'investor', 'paymentEvidenceHash']),
});

const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CENTS = /^(0|[1-9]\d{0,18})$/;
const validators = {
  tokenId: v => HASH.test(v), invoiceHash: v => HASH.test(v), frameworkHash: v => HASH.test(v), termsHash: v => HASH.test(v),
  assignmentHash: v => HASH.test(v), evidenceHash: v => HASH.test(v), paymentEvidenceHash: v => HASH.test(v),
  issuer: v => ADDRESS.test(v), investor: v => ADDRESS.test(v),
  nominalCents: v => CENTS.test(v) && v !== '0', discountCents: v => CENTS.test(v), advanceCents: v => CENTS.test(v), feeCents: v => CENTS.test(v),
  issueDate: v => Number.isInteger(v) && v >= 20000101 && v <= 99991231,
  dueDate: v => Number.isInteger(v) && v >= 20000101 && v <= 99991231,
  fce: v => typeof v === 'boolean', simulated: v => typeof v === 'boolean',
  detail: v => Number.isInteger(v) && v >= 0 && v <= 255,
  rateBps: v => Number.isInteger(v) && v >= 0 && v <= 65535, feeBps: v => Number.isInteger(v) && v >= 0 && v <= 65535,
  days: v => Number.isInteger(v) && v > 0 && v <= 4294967295,
};

/** Validates the arguments of one event kind; throws on any unknown or malformed key. */
export function chainArgs(kind, args) {
  const keys = CHAIN_ARG_KEYS[kind];
  if (!keys) throw new TypeError(`chain event kind not allowed: ${kind}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError(`chain args required: ${kind}`);
  const extra = Object.keys(args).filter(key => !keys.includes(key));
  if (extra.length) throw new TypeError(`chain args not allowed for ${kind}: ${extra.join(',')}`);
  const out = {};
  for (const key of keys) {
    const value = typeof args[key] === 'bigint' ? String(args[key]) : args[key];
    if (!validators[key](value)) throw new TypeError(`chain arg invalid for ${kind}: ${key}`);
    out[key] = value;
  }
  return out;
}

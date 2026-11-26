import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { INVOICE_STATUSES, TRANSITIONS, assertTransition, chainEventsFor } from '../netlify/functions/lib/factoringStates.js';
import { canonicalJson, invoiceCommitment, termsHash, invoiceTokenId, CHAIN_ARG_KEYS, chainArgs, chainDate, evidenceHash } from '../netlify/functions/lib/factoringHashes.js';

const H = '0x' + 'ab'.repeat(32), A = '0x' + '12'.repeat(20);
const status = { tokenId: H, detail: 1, evidenceHash: H };
const contexts = {
  register: { tokenId: H, issuer: A, invoiceHash: H, frameworkHash: H, nominalCents: 1000000n, issueDate: 20261120, dueDate: 20261220, fce: false, simulated: true },
  accepted: status, rejected: status, published: status, offer_expired: status, collected: status, defaulted: status,
  taken: { tokenId: H, termsHash: H, assignmentHash: H, rateBps: 3500, feeBps: 250, days: 30, discountCents: '27963', advanceCents: 972037n, feeCents: '699' },
  cede: { tokenId: H, investor: A, paymentEvidenceHash: H },
};
// Plan table 5.2: [from, to, actor, chain kinds].
const table = [
  [null, 'cargada', 'issuer', []],
  ['cargada', 'enviada', 'issuer', ['register']],
  ['enviada', 'aceptada', 'debtor', ['accepted']], ['enviada', 'aceptada', 'worker', ['accepted']],
  ['aceptada', 'publicada', 'debtor', ['published']], ['aceptada', 'publicada', 'worker', ['published']],
  ['enviada', 'rechazada', 'debtor', ['rejected']],
  ['publicada', 'oferta_vencida', 'worker', ['offer_expired']],
  ['publicada', 'tomada', 'investor', ['taken']],
  ['tomada', 'pagos_en_curso', 'worker', []],
  ['pagos_en_curso', 'cedida', 'worker', ['cede']],
  ['pagos_en_curso', 'publicada', 'worker', ['published']],
  ['pagos_en_curso', 'revision_manual', 'worker', []],
  ['revision_manual', 'cedida', 'admin', ['cede']],
  ['revision_manual', 'publicada', 'admin', ['published']],
  ['cedida', 'cobrada', 'worker', ['collected']],
  ['cedida', 'en_mora', 'worker', ['defaulted']],
  ['en_mora', 'cobrada', 'worker', ['collected']],
];

test('every transition of the plan passes with its actor and emits its chain events', () => {
  assert.equal(INVOICE_STATUSES.length, 12);
  for (const [from, to, actor, kinds] of table) {
    assert.ok(assertTransition(from, to, actor), `${from}->${to}`);
    assert.deepEqual(chainEventsFor(from, to, contexts).map(e => e.kind), kinds);
  }
  const listed = new Set(table.map(([from, to]) => `${from ?? 'none'}->${to}`));
  assert.deepEqual([...listed].sort(), Object.keys(TRANSITIONS).sort());
});

test('pairs not in the table and wrong actors are rejected', () => {
  const listed = new Set(table.map(([from, to]) => `${from ?? 'none'}->${to}`));
  for (const from of [null, ...INVOICE_STATUSES]) for (const to of INVOICE_STATUSES) {
    if (listed.has(`${from ?? 'none'}->${to}`)) continue;
    assert.throws(() => assertTransition(from, to, 'worker'), error => error.code === 'invalid_transition' && error.status === 409);
  }
  assert.throws(() => assertTransition('enviada', 'aceptada', 'investor'), /invalid_transition/);
  assert.throws(() => assertTransition('enviada', 'aceptada', 'issuer'), /invalid_transition/);
  assert.throws(() => assertTransition('enviada', 'rechazada', 'worker'), /invalid_transition/);
  assert.throws(() => assertTransition('publicada', 'tomada', 'debtor'), /invalid_transition/);
  assert.throws(() => assertTransition('revision_manual', 'publicada', 'worker'), /invalid_transition/);
});

test('chain arguments are a closed list without personal data', () => {
  assert.throws(() => chainEventsFor('enviada', 'aceptada', { accepted: { ...status, cuit: '30111111118' } }), /not allowed/);
  assert.throws(() => chainEventsFor('cargada', 'enviada', { register: { ...contexts.register, legalName: 'X SA' } }), /not allowed/);
  assert.throws(() => chainEventsFor('cargada', 'enviada', { register: { ...contexts.register, issuer: 'Ana' } }), /invalid/);
  assert.throws(() => chainEventsFor('cargada', 'enviada', {}), /required/);
  assert.throws(() => chainArgs('mint_everything', {}), /not allowed/);
  const register = chainEventsFor('cargada', 'enviada', contexts)[0].args;
  assert.equal(register.nominalCents, '1000000');
  assert.deepEqual(Object.keys(register), CHAIN_ARG_KEYS.register);
  for (const keys of Object.values(CHAIN_ARG_KEYS)) for (const key of keys) assert.doesNotMatch(key, /cuit|name|cvu|text|email/i);
});

test('hashes are stable, salted and deterministic per invoice', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2n], c: 'x' } }), '{"a":{"c":"x","d":[1,"2"]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  const fields = { cuit: '30111111118', nominal: 100n, due: '2026-12-20' };
  const salt1 = randomBytes(32).toString('hex'), salt2 = randomBytes(32).toString('hex');
  const h1 = invoiceCommitment({ salt: salt1, fields });
  assert.match(h1, /^0x[0-9a-f]{64}$/);
  assert.equal(h1, invoiceCommitment({ salt: salt1, fields: { due: '2026-12-20', nominal: 100n, cuit: '30111111118' } }));
  assert.notEqual(h1, invoiceCommitment({ salt: salt2, fields }));
  assert.throws(() => invoiceCommitment({ salt: 'short', fields }), /salt/);
  const id = randomUUID();
  assert.equal(invoiceTokenId(id), invoiceTokenId(id.toUpperCase()));
  assert.notEqual(invoiceTokenId(id), invoiceTokenId(randomUUID()));
  assert.match(termsHash({ invoiceHash: h1, quote: { advanceCents: 1n } }), /^0x[0-9a-f]{64}$/);
  assert.notEqual(termsHash({ invoiceHash: h1, quote: { advanceCents: 1n } }), termsHash({ invoiceHash: h1, quote: { advanceCents: 2n } }));
  assert.match(evidenceHash({ net: 'ord_1' }), /^0x[0-9a-f]{64}$/);
  assert.equal(chainDate('2026-12-20'), 20261220);
});

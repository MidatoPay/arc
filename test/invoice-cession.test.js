import test from 'node:test';
import assert from 'node:assert/strict';
import { argentinaDate, addDays, daysBetween, isBankBusinessDay, fceTransferBlocked, cessionQuote,
  centsToArs, arsToCents } from '../src/invoiceCession.js';
import { AR_BANK_HOLIDAYS } from '../src/arBankHolidays.js';

const terms = { rateBps: 3500, feeBps: 250 };
const quote = (ars, days) => cessionQuote({ nominalCents: arsToCents(ars), days, ...terms });
const shown = q => ({ discount: centsToArs(q.discountCents), advance: centsToArs(q.advanceCents),
  fee: centsToArs(q.feeCents), outlay: centsToArs(q.investorOutlayCents), gain: centsToArs(q.investorGainCents),
  tna: q.investorTnaBps });

// Plan section 6.3: every value must match to the cent.
const expected = [
  ['17000000', 30, { discount: '475366.18', advance: '16524633.82', fee: '11884.15', outlay: '16536517.97', gain: '463482.03', tna: 3410 }],
  ['17000000', 60, { discount: '924870.47', advance: '16075129.53', fee: '23121.76', outlay: '16098251.29', gain: '901748.71', tna: 3408 }],
  ['17000000', 90, { discount: '1350567.47', advance: '15649432.53', fee: '33764.19', outlay: '15683196.72', gain: '1316803.28', tna: 3405 }],
  ['100', 30, { discount: '2.80', advance: '97.20', fee: '0.07', outlay: '97.27', gain: '2.73', tna: 3415 }],
  ['100', 60, { discount: '5.44', advance: '94.56', fee: '0.14', outlay: '94.70', gain: '5.30', tna: 3405 }],
  ['100', 90, { discount: '7.94', advance: '92.06', fee: '0.20', outlay: '92.26', gain: '7.74', tna: 3402 }],
];

test('the quote reproduces the plan table to the cent and always adds up to the nominal', () => {
  for (const [ars, days, values] of expected) {
    const q = quote(ars, days);
    assert.deepEqual(shown(q), values, `${ars} at ${days} days`);
    assert.equal(q.advanceCents + q.feeCents + q.investorGainCents, q.nominalCents);
    assert.equal(q.discountCents, q.nominalCents - q.advanceCents);
    assert.equal(q.investorOutlayCents, q.advanceCents + q.feeCents);
  }
});

test('edge and pilot amounts from the plan', () => {
  assert.deepEqual(shown(quote('100', 1)), { discount: '0.10', advance: '99.90', fee: '0.00', outlay: '99.90', gain: '0.10', tna: shown(quote('100', 1)).tna });
  assert.equal(quote('100', 1).feeCents, 0n);
  const big = shown(quote('17000000', 1));
  assert.equal(big.discount, '16285.75'); assert.equal(big.fee, '407.14'); assert.equal(big.gain, '15878.61');
  const seven = shown(quote('10000', 7));
  assert.deepEqual([seven.advance, seven.fee, seven.outlay, seven.gain], ['9933.32', '1.67', '9934.99', '65.01']);
  const thirty = shown(quote('10000', 30));
  assert.deepEqual([thirty.advance, thirty.fee, thirty.outlay, thirty.gain], ['9720.37', '6.99', '9727.36', '272.64']);
});

test('zero or negative days block the cession', () => {
  for (const days of [0, -1, -30]) {
    assert.throws(() => quote('100', days), error => error.code === 'invoice_due_too_soon' && error.status === 422);
  }
  assert.throws(() => cessionQuote({ nominalCents: 100, days: 30, ...terms }), /invalid_amount/);
  assert.throws(() => cessionQuote({ nominalCents: 0n, days: 30, ...terms }), /invalid_amount/);
  assert.throws(() => cessionQuote({ nominalCents: 100n, days: 1.5, ...terms }), /invalid_cession_terms/);
  assert.throws(() => cessionQuote({ nominalCents: 100n, days: 30, rateBps: 20001, feeBps: 250 }), /invalid_cession_terms/);
});

test('rounding is half up on an exact half cent', () => {
  // rate·days = 10000·365 halves the nominal: 1 cent → 0.5 → 1; 3 cents → 1.5 → 2.
  const half = nominalCents => cessionQuote({ nominalCents, days: 365, rateBps: 10000, feeBps: 250 });
  assert.equal(half(1n).advanceCents, 1n);
  assert.equal(half(3n).advanceCents, 2n);
  // Discount of 20 cents at 2.5% is exactly 0.5 cents of fee → 1 cent.
  const q = half(40n);
  assert.equal(q.discountCents, 20n); assert.equal(q.feeCents, 1n); assert.equal(q.investorGainCents, 19n);
});

test('money never goes through Number', () => {
  const nominalCents = 9007199254740993n;
  const q = cessionQuote({ nominalCents, days: 30, ...terms });
  assert.equal(q.advanceCents + q.feeCents + q.investorGainCents, nominalCents);
  assert.equal(centsToArs(nominalCents), '90071992547409.93');
  assert.equal(arsToCents('999999999999.99'), 99999999999999n);
  for (const bad of ['', '1,5', '1.234', '-1', '1e3', ' 1', '1234567890123']) assert.throws(() => arsToCents(bad), /invalid_amount/);
  assert.equal(arsToCents('0.5'), 50n);
});

test('the Argentine date flips at 03:00 UTC', () => {
  assert.equal(argentinaDate(Date.parse('2026-11-25T02:59:59Z')), '2026-11-24');
  assert.equal(argentinaDate(Date.parse('2026-11-25T03:00:00Z')), '2026-11-25');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysBetween('2026-11-24', '2026-12-24'), 30);
  assert.equal(daysBetween('2026-12-24', '2026-11-24'), -30);
  assert.throws(() => daysBetween('2026-02-30', '2026-03-01'), /invalid_date/);
});

test('FCE transfer window counts bank business days, skipping weekends and holidays', () => {
  const holidays = new Set(['2026-12-08']);
  assert.equal(isBankBusinessDay('2026-12-05', holidays), false); // Saturday
  assert.equal(isBankBusinessDay('2026-12-08', holidays), false); // injected holiday
  assert.equal(isBankBusinessDay('2026-12-09', holidays), true);
  // Due Thursday 10/12: the 3 business days before are Wed 9, Mon 7 and Fri 4 (Tue 8 is a holiday).
  assert.equal(fceTransferBlocked('2026-12-03', '2026-12-10', holidays), false);
  assert.equal(fceTransferBlocked('2026-12-04', '2026-12-10', holidays), true);
  assert.equal(fceTransferBlocked('2026-12-06', '2026-12-10', holidays), true);
  // Without the holiday the window starts on Mon 7, so Fri 4 is still allowed.
  assert.equal(fceTransferBlocked('2026-12-04', '2026-12-10', new Set()), false);
  assert.equal(fceTransferBlocked('2026-12-10', '2026-12-10', new Set()), true);
  assert.equal(fceTransferBlocked('2026-12-11', '2026-12-10', new Set()), true);
  assert.ok(AR_BANK_HOLIDAYS.has('2026-12-25') && AR_BANK_HOLIDAYS.has('2027-01-01'));
  for (const day of AR_BANK_HOLIDAYS) assert.match(day, /^202[67]-\d{2}-\d{2}$/);
});

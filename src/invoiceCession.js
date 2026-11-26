// Invoice cession math shared by the server and the UI. Pure: no network, no
// dependencies. Money is always BigInt cents; days and basis points are integers.
// Rules: docs/factoring/PLAN_IMPLEMENTACION_PILOTO.md, sections 6.1 to 6.3
// (D-01 rounding, D-02 Argentine calendar at fixed UTC−3).

export const ART_OFFSET_MINUTES = -180;
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// `src/` cannot import Functions code, so errors carry `code` and `status`;
// the server translates them to PaymentError.
export function cessionError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function dateMs(isoDate) {
  const match = ISO_DATE.exec(String(isoDate || ''));
  if (!match) throw cessionError('invalid_date', 400);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== isoDate) throw cessionError('invalid_date', 400);
  return ms;
}

export function isIsoDate(text) {
  try { dateMs(text); return true; } catch { return false; }
}

/** Calendar date in Argentina ('YYYY-MM-DD'); Argentina has no DST since 2009. */
export function argentinaDate(nowMs) {
  const ms = typeof nowMs === 'number' ? nowMs : new Date(nowMs).getTime();
  if (!Number.isFinite(ms)) throw cessionError('invalid_date', 400);
  return new Date(ms + ART_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  if (!Number.isInteger(days)) throw cessionError('invalid_date', 400);
  return new Date(dateMs(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `fromIso` to `toIso`; may be zero or negative. */
export function daysBetween(fromIso, toIso) {
  return Math.round((dateMs(toIso) - dateMs(fromIso)) / DAY_MS);
}

export function isBankBusinessDay(isoDate, holidays = new Set()) {
  const weekday = new Date(dateMs(isoDate)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !holidays.has(isoDate);
}

/**
 * Ley 27.440 art. 18: an FCE cannot be transferred during the 3 bank business
 * days before its due date. True when `todayIso` is inside that window or later.
 */
export function fceTransferBlocked(todayIso, dueOnIso, holidays = new Set()) {
  if (daysBetween(todayIso, dueOnIso) <= 0) return true;
  let day = dueOnIso, found = 0;
  while (found < 3) {
    day = addDays(day, -1);
    if (isBankBusinessDay(day, holidays)) found += 1;
  }
  return daysBetween(day, todayIso) >= 0;
}

/** Integer division rounding half up; a >= 0 and b > 0. */
function roundHalfUp(a, b) {
  return (2n * a + b) / (2n * b);
}

function assertBps(value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw cessionError('invalid_cession_terms', 400);
  return BigInt(value);
}

/**
 * Quote for an investor taking an invoice `days` before its due date.
 * advance + fee + gain === nominal, and discount === nominal − advance.
 */
export function cessionQuote({ nominalCents, days, rateBps, feeBps }) {
  if (typeof nominalCents !== 'bigint' || nominalCents <= 0n) throw cessionError('invalid_amount', 400);
  if (!Number.isInteger(days)) throw cessionError('invalid_cession_terms', 400);
  if (days <= 0) throw cessionError('invoice_due_too_soon', 422);
  const r = assertBps(rateBps, 20000), f = assertBps(feeBps, 10000), d = BigInt(days);
  if (r === 0n) throw cessionError('invalid_cession_terms', 400);
  const N = nominalCents;
  const advanceCents = roundHalfUp(N * 10000n * 365n, 10000n * 365n + r * d);
  const discountCents = N - advanceCents;
  const feeCents = roundHalfUp(discountCents * f, 10000n);
  const investorOutlayCents = advanceCents + feeCents;
  const investorGainCents = N - investorOutlayCents;
  const investorTnaBps = Number(roundHalfUp(investorGainCents * 365n * 10000n, investorOutlayCents * d));
  return { days, rateBps, feeBps, nominalCents: N, discountCents, advanceCents, feeCents,
    investorOutlayCents, investorGainCents, investorTnaBps };
}

/** 123456n → '1234.56' (no grouping; the UI formats it per locale). */
export function centsToArs(cents) {
  const n = BigInt(cents), sign = n < 0n ? '-' : '', abs = n < 0n ? -n : n;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** '1234.5' → 123450n. Same criterion as decimalUnits(text, 2) on the server. */
export function arsToCents(text) {
  const value = String(text ?? '');
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw cessionError('invalid_amount', 400);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { QR_HOSTS, isValidCuit, parseFiscalQr, validateInvoiceInput, isFceType, cuitHint, formatCuit, normalizeCuit } from '../src/invoiceQr.js';
import { makeCuit, cuitPrefixGivingTen, fiscalQr } from './factoring-fixtures.js';

const today = { todayIso: '2026-11-25' };
const qrInput = (fields, options, dueOn = '2026-12-25') => ({ source: 'qr', qrText: fiscalQr(fields, options), dueOn });
const form = (extra = {}) => ({ source: 'form', debtorId: '7d3f2c1a-9b8e-4f6d-a5c4-3b2a1f0e9d8c', cbteTipo: 6, ptoVta: 1,
  cbteNro: 15, issuedOn: '2026-11-20', dueOn: '2026-12-20', nominal: '10000.50', ...extra });
const code = expected => error => error.code === expected;

test('CUIT check digit: valid, wrong digit, the "gives 10" case and formats', () => {
  const cuit = makeCuit('30', 12345678);
  assert.equal(isValidCuit(cuit), true);
  assert.equal(isValidCuit(formatCuit(cuit)), true);
  assert.equal(isValidCuit(Number(cuit)), true);
  const wrong = cuit.slice(0, 10) + ((Number(cuit[10]) + 1) % 10);
  assert.equal(isValidCuit(wrong), false);
  const ten = cuitPrefixGivingTen('20');
  for (let digit = 0; digit <= 9; digit += 1) assert.equal(isValidCuit(ten + digit), false);
  for (const bad of ['', '123', '3071234567', '307123456789', 'abcdefghijk', null]) assert.equal(isValidCuit(bad), false);
  assert.equal(cuitHint(cuit), `30-…-${cuit[10]}`);
  assert.equal(normalizeCuit('30-12345678-9'), '30123456789');
});

test('a valid QR from the AFIP host and from serviciosweb parses to a canonical invoice', () => {
  for (const host of ['www.afip.gob.ar', 'serviciosweb.afip.gob.ar']) {
    const invoice = validateInvoiceInput(qrInput({}, { host }), today);
    assert.equal(invoice.source, 'qr'); assert.equal(invoice.simulated, false);
    assert.equal(invoice.nominalCents, 1000000n); assert.equal(invoice.cbteTipo, 1); assert.equal(invoice.letter, 'A');
    assert.equal(invoice.issuerCuit, makeCuit('30', 11111111)); assert.equal(invoice.receiverCuit, makeCuit('30', 22222222));
    assert.equal(invoice.authMode, 'CAE'); assert.equal(invoice.isFce, false);
    assert.equal(invoice.qrPayload.importe, '10000');
  }
  assert.ok(QR_HOSTS.includes('www.arca.gob.ar'));
});

test('URL-safe Base64 and missing padding are accepted', () => {
  let found = false;
  for (let nroCmp = 1; nroCmp < 400 && !found; nroCmp += 1) {
    // '?', '>' and '~' encode to the 62nd and 63rd Base64 symbols ('+' and '/', or '-' and '_').
    const text = fiscalQr({ nroCmp, importe: '1234.5', obs: '??>>~~' + 'a'.repeat(nroCmp % 3) }, { encoding: 'base64url' });
    const p = new URL(text).searchParams.get('p');
    if (!/[-_]/.test(p) || p.length % 4 === 0) continue;
    found = true;
    const parsed = parseFiscalQr(text);
    assert.equal(parsed.cbteNro, nroCmp); assert.equal(parsed.amountText, '1234.5');
  }
  assert.ok(found, 'a URL-safe payload without padding was generated');
});

test('structural QR problems are rejected as invalid_qr', () => {
  const cases = [
    fiscalQr({}, { host: 'www.afip.gob.ar.evil.com' }),
    fiscalQr({}, { host: 'example.com' }),
    fiscalQr({}, { protocol: 'http:' }),
    fiscalQr({}, { path: '/otra/qr/' }),
    fiscalQr('{"ver":1,'),
    fiscalQr({ ver: 2 }),
    fiscalQr({ fecha: '2026-02-30' }),
    fiscalQr({ codAut: 123 }),
    fiscalQr({ tipoCodAut: 'X' }),
    'not a url',
    'https://www.afip.gob.ar/fe/qr/',
    'https://www.afip.gob.ar/fe/qr/?p=%%%',
  ];
  for (const text of cases) assert.throws(() => validateInvoiceInput({ source: 'qr', qrText: text, dueOn: '2026-12-25' }, today), code('invalid_qr'), text);
});

test('business rules of the QR: issuer CUIT, currency, type, receiver, amount and dates', () => {
  const prefix = makeCuit('30', 11111111).slice(0, 10);
  const badCuit = prefix + ((Number(makeCuit('30', 11111111)[10]) + 1) % 10);
  assert.throws(() => validateInvoiceInput(qrInput({ cuit: Number(badCuit) }), today), code('invalid_cuit'));
  assert.throws(() => validateInvoiceInput(qrInput({ moneda: 'DOL', ctz: 1000 }), today), code('unsupported_currency'));
  assert.throws(() => validateInvoiceInput(qrInput({ ctz: 2 }), today), code('unsupported_currency'));
  assert.throws(() => validateInvoiceInput(qrInput({ tipoCmp: 3 }), today), code('unsupported_invoice_type'));
  assert.throws(() => validateInvoiceInput(qrInput({ tipoDocRec: 96, nroDocRec: 30111222 }), today), code('receiver_cuit_required'));
  assert.throws(() => validateInvoiceInput(qrInput({ tipoDocRec: undefined, nroDocRec: undefined }), today), code('receiver_cuit_required'));
  assert.throws(() => validateInvoiceInput(qrInput({ importe: 100.125 }), today), code('invalid_qr'));
  assert.throws(() => validateInvoiceInput(qrInput({ importe: 0 }), today), code('invalid_nominal'));
  assert.throws(() => validateInvoiceInput(qrInput({ fecha: '2026-11-26' }), today), code('invalid_issue_date'));
  assert.throws(() => validateInvoiceInput(qrInput({}, {}, '2026-11-19'), today), code('invalid_due_date'));
  assert.throws(() => validateInvoiceInput(qrInput({}, {}, '2026-11-25'), today), code('invalid_due_date'));
  assert.equal(validateInvoiceInput(qrInput({ tipoCmp: 201 }), today).isFce, true);
  assert.equal(validateInvoiceInput(qrInput({ importe: 100.1 }), today).nominalCents, 10010n);
});

test('form invoices are simulated, strict about keys and never choose FCE', () => {
  const invoice = validateInvoiceInput(form(), today);
  assert.equal(invoice.simulated, true); assert.equal(invoice.nominalCents, 1000050n); assert.equal(invoice.letter, 'B');
  assert.equal(invoice.issuerCuit, null); assert.equal(invoice.qrPayload, null); assert.equal(invoice.isFce, false);
  assert.equal(validateInvoiceInput(form({ cbteTipo: 201 }), today).isFce, true);
  assert.throws(() => validateInvoiceInput(form({ isFce: true }), today), code('invalid_body'));
  assert.throws(() => validateInvoiceInput(form({ issuerCuit: makeCuit() }), today), code('invalid_body'));
  const missing = form(); delete missing.dueOn;
  assert.throws(() => validateInvoiceInput(missing, today), code('invalid_body'));
  assert.throws(() => validateInvoiceInput(form({ nominal: '0' }), today), code('invalid_nominal'));
  assert.throws(() => validateInvoiceInput(form({ nominal: '0.00' }), today), code('invalid_nominal'));
  assert.throws(() => validateInvoiceInput(form({ nominal: 100 }), today), code('invalid_nominal'));
  assert.throws(() => validateInvoiceInput(form({ nominal: '1.999' }), today), code('invalid_nominal'));
  assert.throws(() => validateInvoiceInput(form({ cbteTipo: 3 }), today), code('unsupported_invoice_type'));
  assert.throws(() => validateInvoiceInput(form({ debtorId: 'nope' }), today), code('invalid_body'));
  assert.throws(() => validateInvoiceInput(form({ ptoVta: 0 }), today), code('invalid_body'));
  assert.throws(() => validateInvoiceInput(form({ issuedOn: '2026-11-30' }), today), code('invalid_issue_date'));
  assert.throws(() => validateInvoiceInput(form({ dueOn: '2026-11-10' }), today), code('invalid_due_date'));
  assert.throws(() => validateInvoiceInput({ source: 'pdf' }, today), code('invalid_body'));
  assert.throws(() => validateInvoiceInput(null, today), code('invalid_body'));
  assert.equal(isFceType(211), true); assert.equal(isFceType(11), false);
});

// One invoice validator for the browser preview and the server (the server is
// the source of truth and re-parses the QR text). Fiscal QR format: RG 4892/2020,
// field names [S] (FACTORING_HANDOFF.md 3.2, FD-17). Pure: no network.
import { argentinaDate, arsToCents, cessionError, daysBetween, isIsoDate } from './invoiceCession.js';

export const QR_HOSTS = ['www.afip.gob.ar', 'afip.gob.ar', 'serviciosweb.afip.gob.ar', 'www.arca.gob.ar', 'arca.gob.ar'];
// Invoices only: credit and debit notes are out of the pilot. [S]
export const INVOICE_TYPES = new Map([[1, 'A'], [6, 'B'], [11, 'C'], [201, 'FCE A'], [206, 'FCE B'], [211, 'FCE C']]);
const FCE_TYPES = new Set([201, 206, 211]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QR_TEXT = 4096;
const FORM_KEYS = ['source', 'debtorId', 'cbteTipo', 'ptoVta', 'cbteNro', 'issuedOn', 'dueOn', 'nominal'];
const QR_KEYS = ['source', 'qrText', 'dueOn'];

const fail = (code, status = 400) => { throw cessionError(code, status); };

/** Accepts '30712345671' or '30-71234567-1'; returns the 11 digits or null. */
export function normalizeCuit(text) {
  const value = typeof text === 'number' && Number.isSafeInteger(text) ? String(text) : String(text ?? '').trim();
  if (/^\d{11}$/.test(value)) return value;
  if (/^\d{2}-\d{8}-\d$/.test(value)) return value.replace(/-/g, '');
  return null;
}

/** Weights 5,4,3,2,7,6,5,4,3,2; 11 → 0; 10 → invalid. */
export function isValidCuit(text) {
  const cuit = normalizeCuit(text);
  if (!cuit) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, i) => total + weight * Number(cuit[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(cuit[10]);
}

export function formatCuit(cuit) {
  return /^\d{11}$/.test(cuit || '') ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit[10]}` : '';
}

/** Partial CUIT for lists: '30-…-1'. */
export function cuitHint(cuit) {
  return /^\d{11}$/.test(cuit || '') ? `${cuit.slice(0, 2)}-…-${cuit[10]}` : '';
}

export function isFceType(cbteTipo) {
  return FCE_TYPES.has(Number(cbteTipo));
}

function decodeBase64Json(param) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(param)) fail('invalid_qr');
  const normal = param.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (normal.length % 4 === 1) fail('invalid_qr');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  let text;
  try {
    const binary = atob(padded);
    text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  } catch { fail('invalid_qr'); }
  let json;
  try { json = JSON.parse(text); } catch { fail('invalid_qr'); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('invalid_qr');
  return { json, text };
}

function integerField(value, min, max) {
  const n = typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('invalid_qr');
  return n;
}

/** The exact decimal text of `importe`, never a float conversion. */
function amountText(value, rawJson) {
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_qr');
  const raw = /"importe"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rawJson)?.[1];
  return raw ?? String(value);
}

/**
 * Parses the fiscal QR URL. Structural problems → 'invalid_qr'. Business rules
 * (currency, type, receiver, dates) are checked by validateInvoiceInput.
 */
export function parseFiscalQr(urlText) {
  if (typeof urlText !== 'string' || !urlText.trim() || urlText.length > MAX_QR_TEXT) fail('invalid_qr');
  let url;
  try { url = new URL(urlText.trim()); } catch { fail('invalid_qr'); }
  if (url.protocol !== 'https:' || !QR_HOSTS.includes(url.hostname.toLowerCase()) || !url.pathname.startsWith('/fe/qr')) fail('invalid_qr');
  const param = url.searchParams.get('p');
  if (!param) fail('invalid_qr');
  const { json, text } = decodeBase64Json(param);
  if (json.ver !== 1 && json.ver !== '1') fail('invalid_qr');
  if (typeof json.fecha !== 'string' || !isIsoDate(json.fecha)) fail('invalid_qr');
  const issuerCuit = normalizeCuit(json.cuit);
  if (!issuerCuit) fail('invalid_qr');
  const amount = amountText(json.importe, text);
  if (!/^\d{1,12}(?:\.\d+)?$/.test(amount)) fail('invalid_qr');
  const ctz = typeof json.ctz === 'number' ? String(json.ctz) : String(json.ctz ?? '');
  const authMode = json.tipoCodAut === 'E' ? 'CAE' : json.tipoCodAut === 'A' ? 'CAEA' : fail('invalid_qr');
  const authCode = String(json.codAut ?? '');
  if (!/^\d{14}$/.test(authCode)) fail('invalid_qr');
  const hasReceiver = json.tipoDocRec !== undefined && json.tipoDocRec !== null;
  return {
    ver: 1,
    issuedOn: json.fecha,
    issuerCuit,
    ptoVta: integerField(json.ptoVta, 1, 99999),
    cbteTipo: integerField(json.tipoCmp, 1, 999),
    cbteNro: integerField(json.nroCmp, 1, 99999999),
    amountText: amount,
    currency: typeof json.moneda === 'string' ? json.moneda.trim().toUpperCase() : fail('invalid_qr'),
    ctz,
    receiverDocType: hasReceiver ? integerField(json.tipoDocRec, 0, 999) : null,
    receiverDoc: json.nroDocRec === undefined || json.nroDocRec === null ? null : String(json.nroDocRec),
    authMode,
    authCode,
  };
}

function nominalCents(text) {
  if (typeof text !== 'string') fail('invalid_nominal');
  let cents;
  try { cents = arsToCents(text); } catch { fail('invalid_nominal'); }
  if (cents <= 0n) fail('invalid_nominal');
  return cents;
}

function checkDates(issuedOn, dueOn, todayIso) {
  if (!isIsoDate(issuedOn)) fail('invalid_issue_date');
  if (daysBetween(issuedOn, todayIso) < 0) fail('invalid_issue_date');
  if (typeof dueOn !== 'string' || !isIsoDate(dueOn)) fail('invalid_due_date');
  if (daysBetween(issuedOn, dueOn) <= 0 || daysBetween(todayIso, dueOn) <= 0) fail('invalid_due_date');
}

function strictKeys(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_body');
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) fail('invalid_body');
}

/**
 * Form or QR input → canonical invoice. The issuer CUIT of a form invoice is
 * set by the server from the registered party; the client never sends it.
 */
export function validateInvoiceInput(input, { todayIso = argentinaDate(Date.now()) } = {}) {
  if (input?.source === 'form') {
    strictKeys(input, FORM_KEYS);
    if (typeof input.debtorId !== 'string' || !UUID.test(input.debtorId)) fail('invalid_body');
    const cbteTipo = input.cbteTipo;
    if (!Number.isInteger(cbteTipo)) fail('invalid_body');
    if (!INVOICE_TYPES.has(cbteTipo)) fail('unsupported_invoice_type');
    if (!Number.isInteger(input.ptoVta) || input.ptoVta < 1 || input.ptoVta > 99999) fail('invalid_body');
    if (!Number.isInteger(input.cbteNro) || input.cbteNro < 1 || input.cbteNro > 99999999) fail('invalid_body');
    if (typeof input.issuedOn !== 'string') fail('invalid_issue_date');
    checkDates(input.issuedOn, input.dueOn, todayIso);
    return { source: 'form', simulated: true, debtorId: input.debtorId.toLowerCase(), issuerCuit: null, receiverCuit: null,
      cbteTipo, letter: INVOICE_TYPES.get(cbteTipo), ptoVta: input.ptoVta, cbteNro: input.cbteNro,
      issuedOn: input.issuedOn, dueOn: input.dueOn, nominalCents: nominalCents(input.nominal),
      currency: 'PES', isFce: isFceType(cbteTipo), authMode: null, authCode: null, qrPayload: null };
  }
  if (input?.source === 'qr') {
    strictKeys(input, QR_KEYS);
    const qr = parseFiscalQr(input.qrText);
    if (!isValidCuit(qr.issuerCuit)) fail('invalid_cuit');
    if (qr.currency !== 'PES' || !/^1(?:\.0+)?$/.test(qr.ctz)) fail('unsupported_currency');
    if (!INVOICE_TYPES.has(qr.cbteTipo)) fail('unsupported_invoice_type');
    if (qr.receiverDocType !== 80 || !isValidCuit(qr.receiverDoc)) fail('receiver_cuit_required');
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(qr.amountText)) fail('invalid_qr');
    checkDates(qr.issuedOn, input.dueOn, todayIso);
    const cents = nominalCents(qr.amountText);
    return { source: 'qr', simulated: false, debtorId: null, issuerCuit: qr.issuerCuit, receiverCuit: normalizeCuit(qr.receiverDoc),
      cbteTipo: qr.cbteTipo, letter: INVOICE_TYPES.get(qr.cbteTipo), ptoVta: qr.ptoVta, cbteNro: qr.cbteNro,
      issuedOn: qr.issuedOn, dueOn: input.dueOn, nominalCents: cents, currency: 'PES', isFce: isFceType(qr.cbteTipo),
      authMode: qr.authMode, authCode: qr.authCode,
      // Normalized fields only: never the raw URL text.
      qrPayload: { ver: 1, fecha: qr.issuedOn, cuit: qr.issuerCuit, ptoVta: qr.ptoVta, tipoCmp: qr.cbteTipo, nroCmp: qr.cbteNro,
        importe: qr.amountText, moneda: qr.currency, ctz: qr.ctz, tipoDocRec: qr.receiverDocType,
        nroDocRec: normalizeCuit(qr.receiverDoc), tipoCodAut: qr.authMode === 'CAE' ? 'E' : 'A', codAut: qr.authCode } };
  }
  fail('invalid_body');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { factoringTexts, factoringProfileTexts } from '../src/i18n.factoring.js';
import { formatArs, formatBps, formatDate, formatDateTime, factoringErrorKey, FACTORING_ERROR_CODES, factoringApi, groupCvu, timeLeft } from '../src/factoring.js';

// One bundle for every module, so screens and the language provider share one React context.
async function bundle(modules) {
  const contents = Object.entries(modules).map(([name, file]) => `export * as ${name} from './${file}';`).join('\n');
  const compiled = await build({ stdin: { contents, resolveDir: '.', loader: 'js' }, bundle: true, write: false, platform: 'node', format: 'cjs',
    jsx: 'automatic', loader: { '.js': 'jsx' }, external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}
// Spanish UI: the provider reads the language from localStorage.
globalThis.localStorage = { getItem: () => 'es', setItem() {} };
const { i18n, profile, issuer, debtor, investor, parts } = await bundle({ i18n: 'src/i18n.jsx', profile: 'src/ProfileScreen.jsx',
  issuer: 'src/InvoicesScreen.jsx', debtor: 'src/DebtorInvoicesScreen.jsx', investor: 'src/InvestorOffersScreen.jsx', parts: 'src/FactoringParts.jsx' });
const inSpanish = node => renderToStaticMarkup(createElement(i18n.LanguageProvider, null, node));

const keysOf = (value, prefix = '') => Object.entries(value).flatMap(([key, v]) =>
  v && typeof v === 'object' ? keysOf(v, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();

test('Profile hides the invoices section without roles and shows one row per enabled role', () => {
  const none = inSpanish(createElement(profile.InvoicesSection, {}));
  assert.equal(none, '');
  const issuer = inSpanish(createElement(profile.InvoicesSection, { goInvoices: () => {} }));
  assert.match(issuer, /Facturas/); assert.match(issuer, /Mis facturas/);
  assert.doesNotMatch(issuer, /Facturas a pagar|Oportunidades/);
  const all = inSpanish(createElement(profile.InvoicesSection, { goInvoices: () => {}, goOwed: () => {}, goOffers: () => {} }));
  for (const text of ['Mis facturas', 'Facturas a pagar', 'Oportunidades']) assert.match(all, new RegExp(text));
});

test('new texts exist in en and es with the same keys, and every server error code has a message', () => {
  assert.deepEqual(keysOf(factoringTexts.en), keysOf(factoringTexts.es));
  assert.deepEqual(keysOf(factoringProfileTexts.en), keysOf(factoringProfileTexts.es));
  for (const lang of ['en', 'es']) {
    for (const ns of ['factoring', 'invoices', 'owed', 'offers']) assert.ok(i18n.translations[lang][ns], `${lang}.${ns}`);
    assert.equal(i18n.translations[lang].mas.sectionInvoices, factoringProfileTexts[lang].sectionInvoices);
    assert.ok(i18n.translations[lang].mas.title, 'existing mas keys survive');
    for (const code of [...FACTORING_ERROR_CODES, 'generic']) assert.ok(factoringTexts[lang].factoring.errors[code], `${lang}: ${code}`);
    for (const status of ['cargada', 'enviada', 'aceptada', 'rechazada', 'publicada', 'oferta_vencida', 'tomada', 'pagos_en_curso',
      'revision_manual', 'cedida', 'cobrada', 'en_mora']) assert.ok(factoringTexts[lang].factoring.status[status]);
  }
  assert.equal(factoringErrorKey('offer_taken'), 'factoring.errors.offer_taken');
  assert.equal(factoringErrorKey('something_new'), 'factoring.errors.generic');
});

test('formatting works on the server text without Number', () => {
  assert.equal(formatArs('9934.99', 'es'), '9.934,99');
  assert.equal(formatArs('16536517.97', 'en'), '16,536,517.97');
  assert.equal(formatArs('90071992547409.93', 'es'), '90.071.992.547.409,93');
  assert.equal(formatArs('0.07', 'es'), '0,07');
  assert.equal(formatBps(3410, 'es'), '34,10%'); assert.equal(formatBps(3405, 'en'), '34.05%');
  assert.equal(formatDate('2026-12-25', 'es'), '25/12/2026');
  assert.equal(formatDateTime('2026-11-28T15:00:00.000Z', 'es'), '28/11/2026 12:00');
  assert.equal(groupCvu('0000003100000000000042'), '0000 0031 0000 0000 0000 42');
  assert.deepEqual(timeLeft('2026-11-28T15:00:00Z', Date.parse('2026-11-25T14:30:00Z')), { hours: 72, minutes: 30 });
  assert.equal(timeLeft('2026-11-25T14:00:00Z', Date.parse('2026-11-25T14:30:00Z')), null);
});

test('the API client sends the bearer and Idempotency-Key and maps server error codes', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return new Response(JSON.stringify({ error: 'offer_taken' }), { status: 409 }); };
  await assert.rejects(() => factoringApi('/invoice-offers/x/take', async () => 'tok', { method: 'POST', body: { expectedOutlay: '1.00' }, idempotencyKey: 'k', request }),
    error => error.code === 'offer_taken' && error.status === 409);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'k');
  assert.equal(calls[0].options.body, '{"expectedOutlay":"1.00"}');
  await assert.rejects(() => factoringApi('/invoices', async () => null), error => error.code === 'unauthorized');
  await assert.rejects(() => factoringApi('/invoices', async () => 'tok', { request: async () => { throw new Error('offline'); } }), error => error.code === 'network');
  const ok = await factoringApi('/invoices/access', async () => 'tok', { request: async () => new Response('{"enabled":false}', { status: 200 }) });
  assert.deepEqual(ok, { enabled: false });
});

const invoice = (extra = {}) => ({ id: 'a1b2c3d4-0000-4000-8000-000000000001', status: 'cargada', source: 'form', simulated: true, isFce: false,
  cbte: { tipo: 6, letra: 'B', ptoVta: 1, nro: 15 }, issuedOn: '2026-11-20', dueOn: '2026-12-25', nominal: '10000.00',
  tacitAcceptanceOn: '2026-12-11', offer: null, nft: { tokenId: null, status: 'disabled', txHash: null, explorerUrl: null },
  debtor: { legalName: 'Deudora Grande SA', cuit: '30200000020' }, take: null, createdAt: '2026-11-25T15:00:00.000Z', ...extra });

test('issuer list: loading, empty, error with retry, SIMULATED badge and server amounts formatted', () => {
  const html = props => inSpanish(createElement(issuer.InvoiceList, { invoices: [], onNew() {}, onOpen() {}, onRetry() {}, ...props }));
  assert.match(html({ loading: true }), /Cargando…/);
  assert.match(html({}), /Todavía no cargaste facturas/);
  const failed = html({ error: 'twentyone_unavailable' });
  assert.match(failed, /role="alert"/); assert.match(failed, /Reintentar/); assert.match(failed, /21 Millions no responde/);
  const listed = html({ invoices: [invoice(), invoice({ id: 'x2', status: 'enviada', simulated: false, isFce: true, source: 'qr', nominal: '17000000.00' })] });
  assert.equal((listed.match(/SIMULADA/g) || []).length, 1);
  assert.match(listed, /FCE/);
  assert.match(listed, /\$ 10\.000,00/); assert.match(listed, /\$ 17\.000\.000,00/);
  assert.match(listed, /Aceptación tácita el 11\/12\/2026/);
  assert.match(listed, /Factura B 00001-00000015/);
});

test('issuer detail warns before sending an invoice past its tacit deadline (D-11)', () => {
  const fresh = inSpanish(createElement(issuer.InvoiceDetail, { invoice: invoice(), timeline: [], todayIso: '2026-11-25' }));
  assert.match(fresh, /Enviar al deudor/); assert.doesNotMatch(fresh, /más de 21 días/);
  const old = inSpanish(createElement(issuer.InvoiceDetail, { invoice: invoice(), timeline: [], todayIso: '2026-12-11' }));
  assert.match(old, /más de 21 días/);
  const taken = inSpanish(createElement(issuer.InvoiceDetail, { invoice: invoice({ status: 'cedida', take: { advance: '9720.37', discount: '279.63', days: 30, status: 'completed' },
    nft: { tokenId: '0x' + 'a'.repeat(64), status: 'pending', txHash: null, explorerUrl: null } }), timeline: [{ status: 'cargada', at: '2026-11-25T15:00:00.000Z' }] }));
  assert.match(taken, /\$ 9\.720,37/); assert.match(taken, /Registro on-chain pendiente/); assert.doesNotMatch(taken, /Enviar al deudor/);
  assert.match(taken, /25\/11\/2026 12:00/);
});

test('the form preview uses the shared validator and blocks invalid input', () => {
  const todayIso = '2026-11-25';
  const ok = issuer.previewInvoice('form', { debtorId: '7d3f2c1a-9b8e-4f6d-a5c4-3b2a1f0e9d8c', cbteTipo: '6', ptoVta: '1', cbteNro: '15',
    issuedOn: '2026-11-20', dueOn: '2026-12-25', nominal: '10000,50' }, todayIso);
  assert.equal(ok.ok, true); assert.equal(ok.invoice.nominalCents, 1000050n); assert.equal(ok.body.nominal, '10000.50'); assert.equal(ok.body.cbteTipo, 6);
  assert.equal(issuer.previewInvoice('form', { debtorId: '7d3f2c1a-9b8e-4f6d-a5c4-3b2a1f0e9d8c', cbteTipo: '6', ptoVta: '1', cbteNro: '15',
    issuedOn: '2026-11-20', dueOn: '2026-11-19', nominal: '1' }, todayIso).code, 'invalid_due_date');
  assert.equal(issuer.previewInvoice('qr', { qrText: 'https://example.com/fe/qr/?p=x', dueOn: '2026-12-25' }, todayIso).code, 'invalid_qr');
  const values = { debtorId: '7d3f2c1a-9b8e-4f6d-a5c4-3b2a1f0e9d8c', ptoVta: '1', cbteNro: '15', issuedOn: '2026-11-20', dueOn: '2026-12-25', nominal: '10000' };
  const form = inSpanish(createElement(issuer.InvoiceForm, { debtors: [{ id: values.debtorId, legalName: 'Deudora Grande SA', cuitHint: '30-…-0' }],
    todayIso, initialValues: values }));
  assert.match(form, /Vista previa/); assert.match(form, /\$ 10\.000,00/); assert.match(form, /SIMULADA/);
  assert.match(form, /<label for="inv-nominal"/); assert.match(form, /role="tablist"/);
  const invalid = inSpanish(createElement(issuer.InvoiceForm, { todayIso, initialValues: { ...values, nominal: '0' } }));
  assert.match(invalid, /mayor a cero/); assert.match(invalid, /disabled=""/);
});

const CVU = '0000003100000000000021';
const owed = (extra = {}) => ({ ...invoice({ status: 'cedida', debtor: undefined, issuer: { legalName: 'Emisora Piloto SA' } }),
  payTo: { legalName: 'Inversora Uno SA', cvu: CVU }, canPayFrom: '2026-12-25', payment: null, ...extra });

test('debtor: Pay is disabled before the due date and the confirmation shows the exact amount and full CVU', () => {
  const before = inSpanish(createElement(debtor.OwedDetail, { invoice: owed(), timeline: [], paymentsMode: 'simulated', todayIso: '2026-12-24' }));
  assert.match(before, /Podés pagar desde el 25\/12\/2026/);
  assert.match(before, /<button type="button" disabled=""[^>]*>Pagar<\/button>/);
  assert.match(before, /Esta factura fue cedida/); assert.match(before, /Inversora Uno SA/);
  assert.match(before, /0000 0031 0000 0000 0000 21/);
  const due = inSpanish(createElement(debtor.OwedDetail, { invoice: owed(), timeline: [], paymentsMode: 'simulated', todayIso: '2026-12-25' }));
  assert.doesNotMatch(due, /disabled=""[^>]*>Pagar</);
  const sheet = inSpanish(createElement(debtor.OwedDetail, { invoice: owed(), timeline: [], paymentsMode: 'simulated', todayIso: '2026-12-25', initialSheet: 'pay' }));
  assert.match(sheet, /role="dialog"/); assert.match(sheet, /aria-modal="true"/); assert.match(sheet, /Confirmar el pago/);
  assert.match(sheet, /\$ 10\.000,00/); assert.match(sheet, /0000 0031 0000 0000 0000 21/);
  const off = inSpanish(createElement(debtor.OwedDetail, { invoice: owed(), timeline: [], paymentsMode: 'disabled', todayIso: '2026-12-25' }));
  assert.match(off, /Pagos no habilitados/);
  assert.equal(debtor.payBlock(owed({ payment: { status: 'processing' } }), { paymentsMode: 'simulated', todayIso: '2026-12-30' }), 'processing');
  assert.equal(debtor.payBlock(owed({ status: 'en_mora' }), { paymentsMode: 'live', todayIso: '2026-12-30' }), null);
  const sent = inSpanish(createElement(debtor.OwedDetail, { invoice: owed({ status: 'enviada', payTo: null, canPayFrom: null }), timeline: [], paymentsMode: 'simulated' }));
  assert.match(sent, /Aceptar/); assert.match(sent, /Rechazar/); assert.match(sent, /queda aceptada el 11\/12\/2026/);
  assert.match(inSpanish(createElement(debtor.OwedDetail, { invoice: owed({ status: 'cobrada' }), timeline: [], paymentsMode: 'simulated' })), /Pagada/);
});

const detail = (quote = {}) => ({ offer: { id: 'o1', status: 'open', expiresAt: '2026-11-28T15:00:00.000Z', rateBps: 3500, feeBps: 250 },
  invoice: { ...invoice({ status: 'publicada', debtor: { legalName: 'Deudora Grande SA' }, issuer: { legalName: 'Emisora Piloto SA' } }) },
  quote: { days: 30, rateBps: 3500, feeBps: 250, nominal: '10000.00', discount: '279.63', advance: '9720.37', fee: '6.99', outlay: '9727.36',
    gain: '272.64', investorTnaBps: 3410, takeable: true, blockedReason: null, ...quote },
  debit: { issuerCvu: '0000000000000000000011', feeCvu: '0000000000000000000099' } });
const NOW = Date.parse('2026-11-25T15:00:00Z');

test('investor: the take confirmation shows net, fee, debit, gain and rate from the server', () => {
  const html = inSpanish(createElement(investor.OfferDetail, { detail: detail(), paymentsMode: 'simulated', nowMs: NOW, initialSheet: true }));
  for (const text of ['Confirmar la compra', '\\$ 9\\.720,37', '\\$ 6,99', '\\$ 9\\.727,36', '\\$ 272,64', '34,10%', '0000 0000 0000 0000 0000 11',
    '0000 0000 0000 0000 0000 99', 'Vence en 72 h 0 min']) assert.match(html, new RegExp(text), text);
  const blocked = inSpanish(createElement(investor.OfferDetail, { detail: detail({ takeable: false, blockedReason: 'fce_transfer_window_closed' }), paymentsMode: 'simulated', nowMs: NOW }));
  assert.match(blocked, /3 días hábiles/); assert.match(blocked, /disabled=""/);
  const off = inSpanish(createElement(investor.OfferDetail, { detail: detail(), paymentsMode: 'disabled', nowMs: NOW }));
  assert.match(off, /Pagos no habilitados/);
});

test('investor: terms_changed shows the new quote and asks to confirm again; take status follows the worker', () => {
  const html = inSpanish(createElement(investor.OfferDetail, { detail: detail({ days: 29, outlay: '9736.71', advance: '9729.47', fee: '7.24', gain: '263.29' }),
    paymentsMode: 'simulated', nowMs: NOW, termsChanged: true }));
  assert.match(html, /Los montos cambiaron/); assert.match(html, /\$ 9\.736,71/); assert.match(html, /role="dialog"/);
  for (const [status, text] of [['paying', 'Pagos en curso'], ['completed', 'Cedida a tu nombre'], ['failed_net', 'no se debitó la comisión'], ['manual_review', 'En revisión']])
    assert.match(inSpanish(createElement(investor.TakeStatus, { take: { status } })), new RegExp(text));
  const card = inSpanish(createElement(investor.OfferCard, { offer: { offerId: 'o1', expiresAt: detail().offer.expiresAt, invoice: detail().invoice, quote: detail().quote }, nowMs: NOW }));
  for (const text of ['Deudora Grande SA', 'Emisora Piloto SA', '\\$ 9\\.727,36', '\\$ 272,64', '34,10%', 'SIMULADA']) assert.match(card, new RegExp(text), text);
});

test('the simulated banner appears only in simulated mode', () => {
  assert.match(inSpanish(createElement(parts.SimulatedBanner, { paymentsMode: 'simulated' })), /SIMULADO: no se mueve dinero real/);
  assert.equal(inSpanish(createElement(parts.SimulatedBanner, { paymentsMode: 'live' })), '');
});

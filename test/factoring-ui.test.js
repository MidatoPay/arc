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
const { i18n, profile } = await bundle({ i18n: 'src/i18n.jsx', profile: 'src/ProfileScreen.jsx' });
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

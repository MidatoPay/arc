import assert from 'node:assert/strict';

const origin = 'http://localhost:8888';
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(30000) });
}

const page = await request('/');
assert.equal(page.status, 200, 'La página debe responder 200');
assert.match(await page.text(), /id="root"/, 'Debe servir la aplicación');

// A 200 HTML response for these URLs means the SPA fallback swallowed Vite.
for (const path of ['/src/main.jsx', '/@vite/client', '/@react-refresh', '/node_modules/.vite/deps/react.js']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') || '', /javascript/, `${path} debe servir JavaScript, no HTML`);
  assert.doesNotMatch(await response.text(), /^\s*<!doctype html>/i, path);
  console.log(`OK JavaScript: ${path}`);
}

const webhook = await request('/webhooks/mercadopago', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.equal(webhook.status, 401, 'El webhook debe rechazar una petición sin firma');
assert.equal((await webhook.json()).error, 'invalid_signature');
console.log('OK Functions: webhook accesible y firma requerida');

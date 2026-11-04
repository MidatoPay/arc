import { readFile } from 'node:fs/promises';

// No network calls unless --execute is supplied. Staging only.
const [action = 'plan', input, customerId] = process.argv.slice(2).filter(x => x !== '--execute');
const execute = process.argv.includes('--execute');
const base = 'https://api.staging.21millions.com/v1/partner';
const key = process.env.TWENTYONE_API_KEY;
async function request(method, path, body) {
  if (!execute) {
    console.log(JSON.stringify({ method, url: base + path, body }, null, 2));
    return {};
  }
  if (!key?.startsWith('nx_test_')) throw new Error('Se requiere TWENTYONE_API_KEY nx_test_ de staging.');
  const response = await fetch(base + path, {
    method, headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
try {
  if (!['plan', 'create', 'submit', 'status'].includes(action) || !input) {
    throw new Error('Uso: node onboard.mjs plan|create|submit|status archivo.json [customer_id] [--execute]');
  }
  const data = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  const type = data.customer.verification_type;
  if (!['individual', 'company'].includes(type)) throw new Error('Tipo de cliente inválido.');
  const id = encodeURIComponent(customerId || 'CUSTOMER_ID');
  if (action === 'plan' || action === 'create') {
    const result = await request('POST', '/customers', data.customer);
    if (execute) console.log(JSON.stringify(result, null, 2));
  }
  if (action === 'plan' || action === 'submit') {
    if (action === 'submit' && !customerId) throw new Error('Falta customer_id del alta.');
    const fiscal = x => x.replace(/\D/g, '');
    if (fiscal(data.customer.fiscal_id) !== fiscal(type === 'individual' ? data.kyc.tin : data.kyc.tax_id)) {
      throw new Error('El identificador fiscal del formulario debe coincidir con el alta.');
    }
    const result = await request('POST', `/customers/${id}/kyc/${type}`, data.kyc);
    if (execute) console.log(JSON.stringify(result, null, 2));
  }
  if (action === 'plan' || action === 'status') {
    if (action === 'status' && !customerId) throw new Error('Falta customer_id.');
    const result = await request('GET', `/customers/${id}/kyc`);
    if (execute) console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

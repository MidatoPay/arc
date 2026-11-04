import { queryCatalog, filterOptions, buildReadQuery } from './query-catalog.js';

const $ = id => document.getElementById(id);
const form = $('query-form');
const select = $('query-name');
const result = $('query-result');
const message = $('query-message');
const previous = $('query-previous');
const next = $('query-next');
const config = await fetch('/config').then(response => response.json());
let busy = false;
let lastRequest = null;
let lastTotal = 0;
let lastCount = 0;

const labels = {
  from: 'Desde (hora local, incluido)', to: 'Hasta (hora local, excluido)',
  limit: 'Resultados por página', offset: 'Resultados a saltear', kind: 'Tipo de movimiento', status: 'Estado de la orden',
};
const columnLabels = {
  id: 'ID', customer_id: 'Cliente', type: 'Tipo', rail: 'Rail', cvu: 'CVU', address: 'Dirección', network: 'Red',
  currencies: 'Monedas', amount: 'Importe', currency: 'Moneda', balance: 'Saldo', balance_after: 'Saldo posterior',
  status: 'Estado', source_amount: 'Importe de origen', source_currency: 'Moneda de origen',
  target_amount: 'Importe de destino', target_currency: 'Moneda de destino', rate: 'Cotización',
  network_fee: 'Comisión de red', created_at: 'Fecha de registro', updated_at: 'Última actualización',
  operation_date: 'Fecha de operación', proof: 'Comprobante', destination: 'Destino',
  kind: 'Tipo de movimiento', source: 'Origen', direction: 'Sentido', reference_id: 'Referencia',
};
const localDate = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
for (const [name, definition] of Object.entries(queryCatalog)) select.add(new Option(definition.label, name));

function pagination() {
  const paged = lastRequest && queryCatalog[lastRequest.queryName].filters.includes('offset');
  const offset = Number(lastRequest?.filters.offset || 0);
  previous.disabled = busy || !paged || offset === 0;
  next.disabled = busy || !paged || !lastCount || offset + lastCount >= lastTotal;
}
function renderFilters() {
  const definition = queryCatalog[select.value];
  $('query-description').textContent = definition.description;
  $('query-customer-field').hidden = !definition.customer;
  $('query-customer').required = !!definition.customer;
  $('query-order-field').hidden = !definition.order;
  $('query-order').required = !!definition.order;
  $('query-use-customer').hidden = !definition.customer;
  const fields = $('query-filters'); fields.replaceChildren();
  const end = new Date();
  for (const name of definition.filters) {
    const label = document.createElement('label'); label.textContent = labels[name];
    const input = document.createElement(filterOptions[name] ? 'select' : 'input');
    input.name = name;
    if (filterOptions[name]) {
      input.add(new Option('Todos', ''));
      for (const value of filterOptions[name]) input.add(new Option(value, value));
    } else if (name === 'from' || name === 'to') {
      input.type = 'datetime-local'; input.step = '1'; input.required = !!definition.windowRequired;
      if (definition.windowRequired) input.value = localDate(name === 'to' ? end : new Date(end.getTime() - 7 * 86400000));
    } else {
      input.type = 'number'; input.min = name === 'limit' ? '1' : '0'; input.step = '1';
      if (name === 'limit') input.max = '100';
      input.value = name === 'limit' ? '50' : '0'; input.required = true;
    }
    label.append(input); fields.append(label);
  }
  lastRequest = null; lastCount = 0; lastTotal = 0;
  result.replaceChildren(); $('query-json').textContent = ''; $('query-path').textContent = '';
  $('query-page').textContent = ''; message.textContent = 'Completá los datos y pulsá Consultar.';
  pagination();
}

function readRequest() {
  const filters = {};
  for (const input of $('query-filters').querySelectorAll('[name]')) {
    if (!input.value) continue;
    filters[input.name] = input.type === 'datetime-local' ? new Date(input.value).toISOString() : input.value;
  }
  return { queryName: select.value, customerId: $('query-customer').value.trim(), orderId: $('query-order').value.trim(), filters };
}
function renderResult(data, definition) {
  result.replaceChildren();
  $('query-json').textContent = JSON.stringify(data, null, 2);
  if (!definition.rows) {
    const detail = document.createElement('pre'); detail.textContent = JSON.stringify(data, null, 2); result.append(detail);
    return 0;
  }
  const rows = data[definition.rows];
  if (!Array.isArray(rows)) throw new Error('La respuesta no contiene la lista esperada. Revisá el JSON recibido.');
  if (!rows.length) {
    const empty = document.createElement('p'); empty.textContent = 'No hay resultados para esta consulta.'; result.append(empty); return 0;
  }
  const columns = definition.columns.filter(name => rows.some(row => Object.hasOwn(row, name)));
  const table = document.createElement('table');
  const caption = document.createElement('caption'); caption.textContent = definition.label; table.append(caption);
  const head = document.createElement('thead'), header = document.createElement('tr');
  for (const name of columns) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = columnLabels[name] || name; header.append(cell); }
  head.append(header); table.append(head);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const line = document.createElement('tr');
    for (const name of columns) {
      const cell = document.createElement('td'), value = row[name];
      cell.textContent = value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      line.append(cell);
    }
    body.append(line);
  }
  table.append(body); result.append(table); return rows.length;
}
async function run(request) {
  if (busy) return;
  try {
    const route = buildReadQuery(request);
    busy = true; form.inert = true; $('query-submit').disabled = true; pagination();
    message.textContent = 'Consultando staging…'; message.setAttribute('aria-busy', 'true');
    result.replaceChildren(); $('query-json').textContent = ''; $('query-page').textContent = '';
    $('query-path').textContent = `${route.method} /v1/partner${route.path}`;
    lastRequest = null;
    const response = await fetch('/api', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': config.token },
      body: JSON.stringify({ action: 'query', ...request }),
    });
    const data = await response.json(); $('query-json').textContent = JSON.stringify(data, null, 2);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof data.error === 'string' ? data.error : data.message || 'Revisá la respuesta JSON.'}`);
    const definition = queryCatalog[request.queryName];
    lastCount = renderResult(data, definition); lastTotal = Number.isSafeInteger(data.total) ? data.total : lastCount;
    lastRequest = structuredClone(request);
    const offset = Number(request.filters.offset || 0);
    $('query-page').textContent = definition.filters.includes('offset') ? (lastCount ? `Resultados ${offset + 1}–${offset + lastCount} de ${lastTotal}.` : `0 resultados en esta página. Total: ${lastTotal}.`) : `${lastCount} resultados.`;
    if (definition.order) $('query-page').textContent = 'Detalle de la orden.';
    message.textContent = 'Consulta completada.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    busy = false; form.inert = false; $('query-submit').disabled = false; message.removeAttribute('aria-busy'); pagination();
  }
}
function changePage(direction) {
  if (!lastRequest || busy) return;
  const request = structuredClone(lastRequest);
  request.filters.offset = String(Math.max(0, Number(request.filters.offset || 0) + direction * Number(request.filters.limit || 50)));
  const input = $('query-filters').querySelector('[name="offset"]'); if (input) input.value = request.filters.offset;
  void run(request);
}
select.onchange = renderFilters;
form.onsubmit = event => { event.preventDefault(); try { void run(readRequest()); } catch (error) { message.textContent = error.message; } };
$('query-use-customer').onclick = () => { $('query-customer').value = $('customerId').value.trim(); };
function openClientQueries(event) {
  if (busy) { event.preventDefault(); message.textContent = 'Esperá a que termine la consulta actual.'; return; }
  const customerId = $('customerId').value.trim();
  if (!queryCatalog[select.value].customer) select.value = 'depositAccounts';
  renderFilters();
  $('query-customer').value = customerId;
  message.textContent = customerId ? `Cliente ${customerId} seleccionado. Elegí una consulta y pulsá Consultar.` : 'Completá el ID de cliente para consultar sus APIs.';
}
$('nav-queries').onclick = openClientQueries;
$('client-queries').onclick = openClientQueries;
previous.onclick = () => changePage(-1); next.onclick = () => changePage(1);
renderFilters();

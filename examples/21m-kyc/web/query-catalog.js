// Consultas GET del contrato público partner-api.json, revisado el 2026-11-04.
// Este catálogo lo comparten la pantalla y la allowlist del servidor local.
const page = ['limit', 'offset'];
const dates = ['from', 'to'];
const orderFilters = [...page, 'status'];
export const queryCatalog = {
  depositAccounts: {
    label: 'Cuentas de depósito del cliente', path: '/customers/{customer_id}/deposit-accounts', customer: true,
    description: 'CVU y direcciones cripto de los rails aprobados. Consultá de nuevo antes de cada depósito: las direcciones pueden cambiar.',
    filters: [], rows: 'destinations', columns: ['type', 'rail', 'cvu', 'address', 'network', 'currencies'],
  },
  deposits: {
    label: 'Depósitos acreditados · toda la cartera', path: '/deposits',
    description: 'Ingresos por CVU o cripto de todos los clientes. Ventana obligatoria sobre la fecha de acreditación; no incluye ajustes ni reembolsos.',
    filters: [...dates, ...page], windowRequired: true, rows: 'deposits',
    columns: ['id', 'customer_id', 'type', 'amount', 'currency', 'created_at', 'operation_date', 'proof'],
  },
  customerBalances: {
    label: 'Saldos del cliente', path: '/customers/{customer_id}/balances', customer: true,
    description: 'Saldo por moneda del cliente seleccionado.', filters: [], rows: 'balances', columns: ['currency', 'balance'],
  },
  portfolioBalances: {
    label: 'Saldos · toda la cartera', path: '/balances',
    description: 'Suma de los saldos de todos los clientes por moneda.', filters: [], rows: 'balances', columns: ['currency', 'balance'],
  },
  customerMovements: {
    label: 'Movimientos del cliente', path: '/customers/{customer_id}/movements', customer: true,
    description: 'Entradas, salidas, cambios y ajustes del saldo. La ventana de fechas es opcional.',
    filters: [...dates, ...page, 'kind'], rows: 'movements',
    columns: ['id', 'kind', 'source', 'direction', 'amount', 'currency', 'balance_after', 'created_at', 'reference_id', 'proof'],
  },
  portfolioMovements: {
    label: 'Movimientos · toda la cartera', path: '/movements', windowRequired: true,
    description: 'Movimientos de todos los clientes. Requiere una ventana de hasta 400 días.',
    filters: [...dates, ...page, 'kind'], rows: 'movements',
    columns: ['id', 'customer_id', 'kind', 'source', 'direction', 'amount', 'currency', 'balance_after', 'created_at', 'proof'],
  },
  swaps: {
    label: 'Swaps del cliente', path: '/customers/{customer_id}/orders', customer: true,
    description: 'Órdenes de cambio de moneda registradas para el cliente.',
    filters: orderFilters, fixed: { type: 'swap' }, rows: 'orders',
    columns: ['id', 'status', 'source_amount', 'source_currency', 'target_amount', 'target_currency', 'rate', 'created_at', 'updated_at'],
  },
  bankWithdrawals: {
    label: 'Retiros bancarios del cliente', path: '/customers/{customer_id}/orders', customer: true,
    description: 'Órdenes de retiro bancario, con destino y comprobante cuando esté disponible.',
    filters: orderFilters, fixed: { type: 'bank_withdrawal' }, rows: 'orders',
    columns: ['id', 'status', 'source_amount', 'source_currency', 'target_amount', 'target_currency', 'destination', 'proof', 'created_at'],
  },
  cryptoWithdrawals: {
    label: 'Retiros cripto del cliente', path: '/customers/{customer_id}/orders', customer: true,
    description: 'Órdenes de retiro cripto, comisión de red y comprobante cuando esté disponible.',
    filters: orderFilters, fixed: { type: 'crypto_withdrawal' }, rows: 'orders',
    columns: ['id', 'status', 'source_amount', 'source_currency', 'target_amount', 'target_currency', 'network_fee', 'destination', 'proof', 'created_at'],
  },
  order: {
    label: 'Detalle de una orden', path: '/customers/{customer_id}/orders/{order_id}', customer: true, order: true,
    description: 'Estado y detalle de una orden de swap o retiro del cliente.', filters: [],
  },
};

export const filterOptions = {
  kind: ['cash_in', 'cash_out', 'swap', 'adjustment'],
  status: ['PROCESSING', 'COMPLETED', 'FAILED'],
};

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalid(`Completá un ${label} válido.`);
  return encodeURIComponent(value);
};
function utcDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    invalid(`${name} debe ser una fecha ISO 8601 UTC terminada en Z.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) invalid(`${name} contiene una fecha inválida.`);
  return timestamp;
}

export function buildReadQuery({ queryName, customerId, orderId, filters = {} } = {}) {
  if (!Object.hasOwn(queryCatalog, queryName)) invalid('Consulta no admitida.');
  const definition = queryCatalog[queryName];
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) invalid('Filtros inválidos.');
  let path = definition.path;
  if (definition.customer) path = path.replace('{customer_id}', identifier(customerId, 'ID de cliente'));
  if (definition.order) path = path.replace('{order_id}', identifier(orderId, 'ID de orden'));
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (!definition.filters.includes(name)) invalid(`El filtro ${name} no está admitido para esta consulta.`);
    if (value === '' || value === undefined || value === null) continue;
    if (name === 'limit' || name === 'offset') {
      if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) invalid(`${name} debe ser un entero.`);
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < (name === 'limit' ? 1 : 0) || (name === 'limit' && number > 100)) invalid(`${name} está fuera del rango permitido.`);
    } else if (name === 'from' || name === 'to') {
      utcDate(value, name);
    } else if (!filterOptions[name]?.includes(value)) invalid(`El valor de ${name} no está admitido.`);
    query.set(name, String(value));
  }
  const from = query.get('from'), to = query.get('to');
  if ((definition.windowRequired || from || to) && (!from || !to)) invalid('Completá las dos fechas de la ventana.');
  if (from && to) {
    const width = Date.parse(to) - Date.parse(from);
    if (width <= 0 || width > 400 * 86400000) invalid('La fecha final debe ser posterior al inicio, con un máximo de 400 días.');
  }
  for (const [name, value] of Object.entries(definition.fixed || {})) query.set(name, value);
  return { method: 'GET', path: path + (query.size ? `?${query}` : '') };
}

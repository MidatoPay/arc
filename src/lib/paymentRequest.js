/**
 * paymentRequest.js — El lado "cobrar".
 *
 * IMPORTANTE, y es la decisión de arquitectura que define esta feature:
 * en una blockchain no podés sacarle plata a nadie. Un ERC-20 solo se mueve
 * si el dueño firma. Entonces "cobrar" NO es una transacción: es generar un
 * pedido que la contraparte firma.
 *
 * Un cobro = una URL. Sin backend, sin estado en servidor. Todo va en el link.
 * El QR es esa URL. El que paga la abre, ve el monto ya cargado, y confirma.
 */

import { parseUnits, formatUnits } from 'viem';

/* ------------------------------------------------------------------ *
 * Registro de tokens (Arc Testnet)
 * ------------------------------------------------------------------ */

export const ARC_TESTNET_CHAIN_ID = 5042002;

export const TOKENS = {
  USDC: {
    symbol: 'USDC',
    label: 'USDC',
    decimals: 6,
    address: import.meta.env?.VITE_USDC_ADDRESS || '',
  },
  ARST: {
    symbol: 'ARST',
    label: 'Pesos (prueba)',
    decimals: 6,
    address: import.meta.env?.VITE_ARST_ADDRESS || '',
  },
};

export const getToken = (symbol) => TOKENS[String(symbol || '').toUpperCase()] || TOKENS.USDC;

export const toBaseUnits = (amount, symbol) =>
  parseUnits(String(amount), getToken(symbol).decimals);

export const fromBaseUnits = (base, symbol) =>
  formatUnits(base, getToken(symbol).decimals);

/** Formato de pantalla: $ 1.500,75 */
export function formatAmount(amount, symbol) {
  const t = getToken(symbol);
  const n = typeof amount === 'bigint' ? Number(fromBaseUnits(amount, symbol)) : Number(amount);
  const str = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${str} ${t.symbol}`;
}

/* ------------------------------------------------------------------ *
 * Crear un cobro
 * ------------------------------------------------------------------ */

const newRef = () =>
  (globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10));

/**
 * @param {object} p
 * @param {string} p.to      Dirección que cobra (la del merchant)
 * @param {number} p.amount  Monto en unidades humanas (50.25)
 * @param {string} p.token   'USDC' | 'ARST'
 * @param {string} [p.memo]  Concepto ("2 cafés")
 * @param {string} [p.from]  Contraparte esperada, si el cobro es a alguien puntual
 * @param {string} [p.origin] Base del link. Default: window.location.origin
 */
export function createPaymentRequest({ to, amount, token = 'USDC', memo = '', from = '', origin } = {}) {
  if (!to) throw new Error('createPaymentRequest: falta la dirección que cobra.');
  if (!(Number(amount) > 0)) throw new Error('createPaymentRequest: el monto tiene que ser mayor a cero.');

  const t = getToken(token);
  const ref = newRef();
  const base = origin || globalThis.location?.origin || 'https://app.midatopay.com';

  const params = new URLSearchParams({
    to,
    amt: String(amount),
    tk: t.symbol,
    ref,
  });
  if (memo) params.set('memo', memo);
  if (from) params.set('from', from);

  const url = `${base.replace(/\/$/, '')}/pagar?${params.toString()}`;

  // EIP-681: lo entienden MetaMask, Rainbow y varias wallets externas.
  // Sirve para que alguien que NO tiene Midato igual pueda pagar el QR.
  const eip681 = t.address
    ? `ethereum:${t.address}@${ARC_TESTNET_CHAIN_ID}/transfer?address=${to}&uint256=${toBaseUnits(amount, t.symbol)}`
    : null;

  return {
    ref,
    to,
    from,
    amount: Number(amount),
    token: t.symbol,
    memo,
    url,        // link/QR para usuarios de Midato
    eip681,     // fallback para wallets externas
    createdAt: Date.now(),
  };
}

/**
 * Lee un cobro desde la URL actual (o una que le pases).
 * Devuelve null si no hay un cobro válido.
 */
export function parsePaymentRequest(input) {
  let params;
  try {
    if (!input) params = new URLSearchParams(globalThis.location?.search || '');
    else if (input instanceof URLSearchParams) params = input;
    else params = new URL(input, globalThis.location?.origin || 'https://x.dev').searchParams;
  } catch {
    return null;
  }

  const to = params.get('to');
  const amt = params.get('amt');
  if (!to || !amt) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return null;
  const amount = Number(amt);
  if (!(amount > 0)) return null;

  return {
    to,
    amount,
    token: getToken(params.get('tk')).symbol,
    memo: params.get('memo') || '',
    from: params.get('from') || '',
    ref: params.get('ref') || '',
  };
}

/* ------------------------------------------------------------------ *
 * Confirmar que el cobro entró
 * ------------------------------------------------------------------ */

const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
};

/**
 * Escucha la blockchain hasta que llegue un Transfer del monto exacto.
 * Esto es lo que hace que la pantalla de cobro pase sola a "Cobrado".
 *
 * @returns función para cortar la escucha
 */
export function watchIncomingPayment(publicClient, { to, amount, token = 'USDC', onPaid, onError }) {
  const t = getToken(token);
  if (!t.address) {
    onError?.(new Error(`Falta la dirección del contrato de ${t.symbol} en el .env`));
    return () => {};
  }
  const expected = toBaseUnits(amount, t.symbol);

  return publicClient.watchEvent({
    address: t.address,
    event: ERC20_TRANSFER_EVENT,
    args: { to },
    onLogs: (logs) => {
      const hit = logs.find((l) => l.args?.value === expected);
      if (hit) {
        onPaid?.({
          txHash: hit.transactionHash,
          from: hit.args.from,
          value: hit.args.value,
          blockNumber: hit.blockNumber,
        });
      }
    },
    onError,
  });
}

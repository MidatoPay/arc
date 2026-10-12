/**
 * Cliente HTTP de la recaudadora.
 * La secret key vive solo en la Netlify Function (`TREASURY_SECRET_KEY`).
 * El browser solo ve address/balance públicos y pide payouts autenticados.
 */

let _status = { configured: false, address: null, balance: null };
let _statusPromise = null;

async function api(path, token, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `http_${res.status}`);
    err.code = body.error;
    err.status = res.status;
    throw err;
  }
  return body;
}

/** Refresca configured/address/balance desde GET /treasury (público). */
export async function refreshTreasuryStatus() {
  _statusPromise = api("/treasury")
    .then((body) => {
      _status = {
        configured: Boolean(body.configured),
        address: body.address || null,
        balance: body.balance == null ? null : Number(body.balance),
      };
      return _status;
    })
    .catch(() => {
      _status = { configured: false, address: null, balance: null };
      return _status;
    });
  return _statusPromise;
}

function ensureStatus() {
  if (!_statusPromise) refreshTreasuryStatus();
  return _statusPromise;
}

export function isTreasuryConfigured() {
  return Boolean(_status.configured && _status.address);
}

export function getTreasuryAddress() {
  return _status.address;
}

export async function getTreasuryAddressAsync() {
  await ensureStatus();
  return _status.address;
}

export async function getTreasuryBalance() {
  const st = await refreshTreasuryStatus();
  return st.balance;
}

/**
 * Payout desde la recaudadora → usuario (vía Function server-side).
 * Requiere access token de Privy.
 */
export async function sendTreasuryPayout(token, { to, usdc, kind, ars, fxRate, factura }) {
  if (!token) throw new Error("Sesión requerida para operar la recaudadora");
  await ensureStatus();
  if (!isTreasuryConfigured()) {
    throw new Error("Treasury no configurada. Definí TREASURY_SECRET_KEY en el server (Netlify/.env).");
  }
  const { payout } = await api("/treasury", token, {
    method: "POST",
    body: JSON.stringify({ to, usdc, kind, ars, fxRate, factura }),
  });
  return payout;
}

// Hidrata address/configured al cargar el módulo (UI sync).
ensureStatus();

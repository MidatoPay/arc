import { ethers } from "ethers";
import { readProvider, getUsdcBalance, sendNativeUsdc, armarMemo, nuevaFactura } from "./arc.js";

/**
 * Wallet recaudadora (tesorería) fondeada en Arc Testnet.
 * En demo: clave en VITE_TREASURY_PRIVATE_KEY (solo testnet).
 * En producción: reemplazar por un servicio/backend que firme payouts.
 */
const TREASURY_PK = import.meta.env.VITE_TREASURY_PRIVATE_KEY || "";

export function isTreasuryConfigured() {
  return Boolean(TREASURY_PK && TREASURY_PK.length >= 64);
}

export function getTreasuryWallet() {
  if (!isTreasuryConfigured()) {
    throw new Error("Treasury no configurada. Definí VITE_TREASURY_PRIVATE_KEY en .env");
  }
  return new ethers.Wallet(TREASURY_PK, readProvider);
}

export function getTreasuryAddress() {
  if (!isTreasuryConfigured()) return null;
  try {
    return new ethers.Wallet(TREASURY_PK).address;
  } catch {
    return null;
  }
}

export async function getTreasuryBalance() {
  const addr = getTreasuryAddress();
  if (!addr) return null;
  return getUsdcBalance(addr);
}

/**
 * Payout desde la recaudadora → usuario (USDC nativo en Arc).
 * Usado por Cobrar y Convertir ARS→USDC.
 */
export async function sendTreasuryPayout({ to, usdc, kind, ars, fxRate }) {
  const wallet = getTreasuryWallet();
  const factura = nuevaFactura();
  const memo = armarMemo({
    inv: factura,
    kind,
    cur: "ARS",
    amt: ars,
    fx: Number(fxRate).toFixed(2),
    usdc: Number(usdc).toFixed(6),
  });
  const result = await sendNativeUsdc(wallet, { to, usdc, memo });
  return { ...result, factura, from: wallet.address, to, usdc, ars, fxRate, kind };
}

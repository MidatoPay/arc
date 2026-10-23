// Firma de payouts USDC desde la recaudadora en Arc (solo server-side).
// La clave privada NUNCA sale del proceso de la Function.

import { Transaction, Wallet } from "ethers";
import { NETWORK } from "../../../src/network.js";
import { armarMemo, feeFields, gasLimitWithMargin, isAddress, memoTransferData, nuevaFactura, normalizeAddress,
  rawToUsdc, usdcToRaw, weiToUsdc, weiToUsdcRaw } from "../../../src/arc.js";
import { PaymentError } from "./paymentCore.js";
import { alreadySubmitted, assertArcNetwork, createArcRpc } from "./arcRpc.js";

// Gas the treasury always keeps aside for its own payouts. The treasury pays
// the gas of every payout from the same USDC balance it pays out, so this
// amount is never counted as payout liquidity (≈ dozens of payouts at the
// 20 gwei floor).
export const TREASURY_GAS_RESERVE_WEI = 50_000_000_000_000_000n; // 0.05 USDC

function treasurySecret() {
  // Only private server environment names are accepted.
  return (process.env.TREASURY_SECRET_KEY || process.env.TREASURY_PRIVATE_KEY || "").trim();
}

export function isTreasuryConfigured() {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(treasurySecret());
}

let cachedSigner = null;
export async function getTreasurySigner() {
  if (!isTreasuryConfigured()) throw new PaymentError("treasury_not_configured");
  if (!cachedSigner) {
    try {
      const secret = treasurySecret();
      cachedSigner = new Wallet(secret.startsWith("0x") ? secret : `0x${secret}`);
    } catch {
      throw new PaymentError("invalid_treasury_secret_key");
    }
  }
  return cachedSigner;
}

export const treasuryRpc = createArcRpc();

export async function getTreasuryAddress() {
  if (!isTreasuryConfigured()) return null;
  try {
    return (await getTreasurySigner()).address;
  } catch {
    return null;
  }
}

/** Liquidity snapshot: USDC (6 decimals) available for payouts after the gas reserve. */
export async function treasuryLiquidity(adapters = {}) {
  const owner = await (adapters.getTreasuryAddress || getTreasuryAddress)();
  if (!owner) throw new PaymentError("treasury_not_configured");
  const rpc = adapters.rpc || treasuryRpc, network = adapters.network || NETWORK;
  await assertArcNetwork(rpc, network);
  const nativeWei = BigInt(await rpc("eth_getBalance", [owner, "latest"]));
  const spendable = nativeWei > TREASURY_GAS_RESERVE_WEI ? nativeWei - TREASURY_GAS_RESERVE_WEI : 0n;
  return { owner, raw: String(weiToUsdcRaw(spendable)), nativeWei: String(nativeWei) };
}

export async function getTreasuryBalance() {
  const owner = await getTreasuryAddress();
  if (!owner) return null;
  const { nativeWei } = await treasuryLiquidity({ getTreasuryAddress: async () => owner });
  return rawToUsdc(weiToUsdcRaw(BigInt(nativeWei)));
}

/**
 * Builds and signs (does NOT send) a USDC payout. `nonce` is assigned by the
 * caller under a treasury lock so concurrent payouts never share a nonce.
 */
export async function prepareTreasuryPayout({ to, usdc, rawAmount, kind, ars, fxRate, factura: facturaIn, nonce }, adapters = {}) {
  if (!isAddress(to)) throw new PaymentError("invalid_wallet", 400);
  const rpc = adapters.rpc || treasuryRpc, network = adapters.network || NETWORK;
  const signer = await (adapters.signer || getTreasurySigner)();
  const from = signer.address, recipient = normalizeAddress(to);
  const amount = rawAmount ? BigInt(rawAmount) : usdcToRaw(usdc);
  const factura = facturaIn || nuevaFactura();
  const memo = armarMemo({
    inv: factura, kind, cur: "ARS", amt: ars, fx: Number(fxRate).toFixed(2), usdc: rawToUsdc(amount).toFixed(6),
  });
  const data = memoTransferData({ to: recipient, raw: amount, memo, reference: factura, network });
  await assertArcNetwork(rpc, network);
  const [gasEstimate, gasPrice] = await Promise.all([
    rpc("eth_estimateGas", [{ from, to: network.memo, data }]),
    rpc("eth_gasPrice", []),
  ]);
  const accountNonce = nonce ?? BigInt(await rpc("eth_getTransactionCount", [from, "pending"]));
  const tx = Transaction.from({
    type: 2, chainId: network.chainId, to: network.memo, data, value: 0n,
    nonce: Number(accountNonce), gasLimit: gasLimitWithMargin(gasEstimate), ...feeFields({ gasPrice, network }),
  });
  const signedTx = await signer.signTransaction(tx);
  const hash = Transaction.from(signedTx).hash;
  return { signedTx, hash, nonce: String(accountNonce), memo, factura, from, to: recipient,
    usdc: rawToUsdc(amount), ars: Number(ars), fxRate: Number(fxRate), kind };
}

// Only used by the test-network demo. Production jobs persist the prepared tx first.
export async function sendTreasuryPayout(options, adapters = {}) {
  const network = adapters.network || NETWORK;
  if (!network.testnet) throw new Error("direct_treasury_payout_disabled");
  const rpc = adapters.rpc || treasuryRpc;
  const prepared = await prepareTreasuryPayout(options, adapters);
  try {
    await rpc("eth_sendRawTransaction", [prepared.signedTx]);
  } catch (error) {
    if (!alreadySubmitted(error)) throw error;
  }
  let block = null, fee = null;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const receipt = await rpc("eth_getTransactionReceipt", [prepared.hash]).catch(() => null);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("treasury_payout_failed");
      block = Number(receipt.blockNumber);
      fee = weiToUsdc(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice));
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { hash, memo, factura, from, to, usdc, ars, fxRate, kind } = prepared;
  return { hash, block, fee, memo, factura, from, to, usdc, ars, fxRate, kind };
}


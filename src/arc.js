import { ethers } from "ethers";
import { ARC, RPC_PROXY } from "./chain.js";

/** Provider de lectura/escritura vía proxy /rpc (evita CORS). */
export const readProvider = new ethers.JsonRpcProvider(RPC_PROXY, ARC.chainId, {
  staticNetwork: true,
  batchMaxCount: 1,
});
readProvider.pollingInterval = 8000;

export async function withRetry(fn, tries = 4) {
  let wait = 1200;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e);
      const limited = m.includes("limit reached") || m.includes("-32011") || m.includes("429");
      if (!limited || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

export function nuevaFactura() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function armarMemo(parts) {
  const body = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
  return `MIDATO|v1|${body}`;
}

/** Balance nativo USDC (18 decimals) como número. */
export async function getUsdcBalance(address) {
  if (!address) return null;
  const b = await withRetry(() => readProvider.getBalance(address));
  return Number(ethers.formatEther(b));
}

/** Arma el TransactionRequest de un envío nativo USDC (mismo shape para estimate y send). */
export function buildNativeUsdcTx({ to, usdc, memo, from }) {
  const value = ethers.parseEther(Number(usdc).toFixed(6));
  const txReq = { to, value };
  if (from) txReq.from = from;
  if (memo) txReq.data = ethers.hexlify(ethers.toUtf8Bytes(memo));
  return txReq;
}

/**
 * Estima gas y costo de una transferencia nativa USDC en Arc.
 * Usa estimateGas + getFeeData (EIP-1559 si la red lo reporta; si no, gasPrice legacy).
 * No hardcodea gas ni tarifas.
 *
 * @param {{ from: string, to: string, usdc: number, memo?: string }} opts
 */
export async function estimateNativeUsdcTransfer({ from, to, usdc, memo }) {
  if (!from) throw new Error("Wallet no conectada");
  if (!to) throw new Error("Destinatario inválido");
  if (!Number.isFinite(Number(usdc)) || Number(usdc) <= 0) throw new Error("Monto inválido");

  const txReq = buildNativeUsdcTx({ from, to, usdc, memo });

  const [gasLimit, feeData] = await Promise.all([
    withRetry(() => readProvider.estimateGas(txReq)),
    withRetry(() => readProvider.getFeeData()),
  ]);

  const maxFeePerGas = feeData.maxFeePerGas ?? null;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? null;
  const gasPrice = feeData.gasPrice ?? null;
  const eip1559 = maxFeePerGas != null;
  // Cota superior EIP-1559; fallback a gasPrice legacy.
  const effectiveGasPrice = maxFeePerGas ?? gasPrice;
  if (effectiveGasPrice == null) {
    throw new Error("La red no devolvió tarifas de gas");
  }

  const feeWei = gasLimit * effectiveGasPrice;
  const feeNative = Number(ethers.formatEther(feeWei));
  // En Arc el nativo es USDC → equivalente USD ≈ 1:1.
  const feeUsd = feeNative;

  const toGwei = (v) => (v == null ? null : Number(ethers.formatUnits(v, "gwei")));

  return {
    gasLimit,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    effectiveGasPrice,
    feeWei,
    feeNative,
    feeUsd,
    eip1559,
    nativeSymbol: "USDC",
    gasPriceGwei: toGwei(gasPrice),
    maxFeePerGasGwei: toGwei(maxFeePerGas),
    maxPriorityFeePerGasGwei: toGwei(maxPriorityFeePerGas),
  };
}

/**
 * Transfiere USDC nativo en Arc.
 * @param {ethers.Signer} signer
 * @param {{ to: string, usdc: number, memo?: string }} opts
 */
export async function sendNativeUsdc(signer, { to, usdc, memo }) {
  const from = await signer.getAddress();
  const txReq = buildNativeUsdcTx({ to, usdc, memo, from });
  const tx = await withRetry(() => signer.sendTransaction(txReq));
  let block = null;
  let fee = null;
  try {
    const rec = await withRetry(() => readProvider.waitForTransaction(tx.hash, 1, 30000));
    if (rec) {
      block = rec.blockNumber;
      if (rec.gasUsed && rec.gasPrice) fee = ethers.formatEther(rec.gasUsed * rec.gasPrice);
    }
  } catch {
    /* la tx ya se envió */
  }
  return { hash: tx.hash, block, fee, memo: memo || null };
}

/** Signer EIP-1193 (Privy / browser wallet) en Arc Testnet. */
export async function getBrowserSigner(wallet) {
  if (!wallet) throw new Error("No wallet available.");
  await wallet.switchChain(ARC.chainId);
  const eip1193 = await wallet.getEthereumProvider();
  const browserProvider = new ethers.BrowserProvider(eip1193, ARC.chainId);
  return browserProvider.getSigner();
}

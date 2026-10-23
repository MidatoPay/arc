// Arc primitives shared by browser and server: addresses, USDC units, memo
// encoding, fees and receipt parsing. No secrets and no network access at import.
import { Interface, ZeroAddress, formatUnits, getAddress, isAddress as isEvmAddress, keccak256, toUtf8Bytes, toUtf8String } from "ethers";
import { NETWORK } from "./network.js";

export const ERC20 = new Interface([
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
// docs.arc.io/arc/concepts/transaction-memos
export const MEMO = new Interface([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);
export const TRANSFER_TOPIC = ERC20.getEvent("Transfer").topicHash;
export const MEMO_TOPIC = MEMO.getEvent("Memo").topicHash;

/** 6-decimal USDC units → 18-decimal native units. */
export const NATIVE_PER_USDC_UNIT = 10n ** BigInt(NETWORK.nativeDecimals - NETWORK.usdcDecimals);
/** Conservative gas limit for a memo-wrapped USDC transfer, used only for UI estimates. */
export const TRANSFER_GAS_ESTIMATE = 150_000n;

/** EVM address (any case with a valid checksum), never the zero address. */
export function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && isEvmAddress(value) &&
    value.toLowerCase() !== ZeroAddress;
}
export function normalizeAddress(value) {
  if (!isAddress(value)) throw new Error("invalid_address");
  return getAddress(value);
}
export function sameAddress(a, b) {
  return isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();
}

export async function withRetry(fn, tries = 4) {
  let wait = 1200;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e);
      // -32014: the load-balanced public RPC has not imported the block yet.
      const transient = m.includes("429") || m.includes("Too Many Requests") || m.includes("rate limit") ||
        m.includes("-32014") || e?.code === -32014 || e?.code === 429;
      if (!transient || i === tries - 1) throw e;
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

export function usdcToRaw(usdc) {
  const n = Number(usdc);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Monto inválido");
  return BigInt(Math.round(n * 10 ** NETWORK.usdcDecimals));
}
export function rawToUsdc(raw) {
  return Number(raw) / 10 ** NETWORK.usdcDecimals;
}
/** Native wei (18 decimals) → exact USDC decimal string. */
export function weiToUsdc(wei) {
  return formatUnits(BigInt(wei), NETWORK.nativeDecimals);
}
/** Native wei → whole 6-decimal USDC units (what the ERC-20 interface can move). */
export function weiToUsdcRaw(wei) {
  return BigInt(wei) / NATIVE_PER_USDC_UNIT;
}

/** Calldata for Memo.memo(USDC, transfer(to, raw), keccak256(reference), memo). */
export function memoTransferData({ to, raw, memo, reference, network = NETWORK }) {
  const inner = ERC20.encodeFunctionData("transfer", [normalizeAddress(to), BigInt(raw)]);
  return MEMO.encodeFunctionData("memo", [network.usdc, inner, keccak256(toUtf8Bytes(String(reference))), toUtf8Bytes(String(memo))]);
}

/** EIP-1559 fee fields respecting Arc's 20 gwei mempool floor. */
export function feeFields({ gasPrice, priorityFee = 0n, network = NETWORK }) {
  const floor = network.minFeePerGasWei;
  const suggested = BigInt(gasPrice || 0) * 2n;
  const maxFeePerGas = suggested > floor ? suggested : floor;
  let maxPriorityFeePerGas = BigInt(priorityFee || 0);
  if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}
export function gasLimitWithMargin(estimate) {
  return (BigInt(estimate) * 12n) / 10n + 5_000n;
}

/** MIDATO memo text attached through the Memo contract, if present. */
export function memoFromLogs(logs = [], network = NETWORK) {
  for (const log of logs) {
    if (String(log.address).toLowerCase() !== network.memo.toLowerCase() || log.topics?.[0] !== MEMO_TOPIC) continue;
    try {
      return toUtf8String(MEMO.parseLog(log).args.memo);
    } catch {
      return null;
    }
  }
  return null;
}

/** ERC-20 USDC Transfer logs (6 decimals) of a receipt. */
export function usdcTransfers(logs = [], network = NETWORK) {
  return logs.filter((log) => String(log.address).toLowerCase() === network.usdc.toLowerCase() &&
    log.topics?.[0] === TRANSFER_TOPIC && log.topics.length === 3).map((log) => {
    const parsed = ERC20.parseLog(log);
    return { from: parsed.args.from, to: parsed.args.to, value: BigInt(parsed.args.value) };
  });
}

// ——— Browser-side helpers (use the authenticated /rpc proxy) ———

let appRpc;
async function rpc(method, params) {
  if (!appRpc) appRpc = (await import("./chain.js")).createAppRpc();
  return withRetry(() => appRpc(method, params));
}

/** Network fee estimate in USDC for a memo-wrapped transfer (paid by the sender). */
export async function estimateUsdcTransfer({ from, to, usdc, memo }) {
  if (!from) throw new Error("Wallet no conectada");
  if (!isAddress(to)) throw new Error("Destinatario inválido");
  if (!Number.isFinite(Number(usdc)) || Number(usdc) <= 0) throw new Error("Monto inválido");
  const data = memoTransferData({ to, raw: usdcToRaw(usdc), memo: memo || "", reference: memo || "estimate" });
  const [gasHex, gasPriceHex] = await Promise.all([
    rpc("eth_estimateGas", [{ from, to: NETWORK.memo, data }]).catch(() => `0x${TRANSFER_GAS_ESTIMATE.toString(16)}`),
    rpc("eth_gasPrice", []),
  ]);
  const gasLimit = gasLimitWithMargin(gasHex);
  const { maxFeePerGas, maxPriorityFeePerGas } = feeFields({ gasPrice: gasPriceHex });
  const feeWei = gasLimit * maxFeePerGas;
  const feeNative = Number(weiToUsdc(feeWei));
  return {
    gasLimit,
    gasPrice: BigInt(gasPriceHex),
    maxFeePerGas,
    maxPriorityFeePerGas,
    feeWei,
    feeNative,
    // Gas is paid in USDC, so the dollar value is the native amount.
    feeUsd: feeNative,
    eip1559: true,
    nativeSymbol: "USDC",
  };
}

/**
 * Sends USDC signed by the user's Privy wallet (`useSendTransaction`).
 * Only used by the test-only Convert USDC→ARS flow (disabled on mainnet).
 */
export async function sendUsdc(wallet, sendTransaction, { to, usdc, memo, reference }) {
  if (!wallet?.address) throw new Error("Wallet no conectada");
  if (typeof sendTransaction !== "function") throw new Error("sendTransaction no disponible");
  await wallet.switchChain?.(NETWORK.chainId);
  const data = memoTransferData({ to, raw: usdcToRaw(usdc), memo, reference: reference || memo });
  const { hash } = await sendTransaction({ to: NETWORK.memo, data, chainId: NETWORK.chainId },
    { address: wallet.address, uiOptions: { showWalletUIs: false } });
  let block = null, fee = null;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("La transferencia falló en Arc");
      block = Number(receipt.blockNumber);
      fee = weiToUsdc(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice));
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { hash, block, fee, memo: memo || null };
}

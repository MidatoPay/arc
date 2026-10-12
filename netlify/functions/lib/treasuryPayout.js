// Firma y envío de USDC SPL desde la recaudadora (solo server-side).
// La secret key NUNCA sale del proceso de la Function.

import {
  address,
  assertIsAddress,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  fetchMaybeToken,
} from "@solana-program/token";
import { getAddMemoInstruction } from "@solana-program/memo";
import bs58 from "bs58";

const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_DECIMALS = 6;

const RPC_URL =
  process.env.VITE_SOLANA_RPC || process.env.SOLANA_RPC || "https://api.devnet.solana.com";

function treasurySecret() {
  // Preferir nombre sin VITE_. El fallback VITE_* solo ayuda en migraciones
  // locales: en el server no se embebe en el bundle del browser.
  return (
    process.env.TREASURY_SECRET_KEY ||
    process.env.TREASURY_PRIVATE_KEY ||
    process.env.VITE_TREASURY_SECRET_KEY ||
    process.env.VITE_TREASURY_PRIVATE_KEY ||
    ""
  ).trim();
}

export function isTreasuryConfigured() {
  return treasurySecret().length >= 32;
}

async function keypairSignerFromSecret(secret) {
  const raw = String(secret || "").trim();
  if (!raw) throw new Error("Secret key vacía");
  let bytes;
  if (raw.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(raw));
  } else {
    bytes = bs58.decode(raw);
  }
  if (bytes.length === 64) {
    return createKeyPairSignerFromBytes(bytes);
  }
  if (bytes.length === 32) {
    const { createKeyPairSignerFromPrivateKeyBytes } = await import("@solana/kit");
    return createKeyPairSignerFromPrivateKeyBytes(bytes);
  }
  throw new Error("Secret key Solana inválida (esperaba 32 o 64 bytes)");
}

let cachedSignerPromise = null;

export async function getTreasurySigner() {
  if (!isTreasuryConfigured()) {
    throw new Error("Treasury no configurada. Definí TREASURY_SECRET_KEY en el entorno del server.");
  }
  if (!cachedSignerPromise) {
    cachedSignerPromise = keypairSignerFromSecret(treasurySecret());
  }
  return cachedSignerPromise;
}

function usdcToRaw(usdc) {
  const n = Number(usdc);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Monto inválido");
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

function rawToUsdc(raw) {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

function nuevaFactura() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function armarMemo(parts) {
  const body = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
  return `MIDATO|v1|${body}`;
}

async function withRetry(fn, tries = 4) {
  let wait = 1200;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e);
      const limited =
        m.includes("429") ||
        m.includes("Too Many Requests") ||
        m.includes("rate limit") ||
        m.includes("-32429");
      if (!limited || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

function getRpc() {
  return createSolanaRpc(RPC_URL);
}

export async function getTreasuryAddress() {
  if (!isTreasuryConfigured()) return null;
  try {
    const signer = await getTreasurySigner();
    return signer.address;
  } catch {
    return null;
  }
}

export async function getTreasuryBalance() {
  const owner = await getTreasuryAddress();
  if (!owner) return null;
  const rpc = getRpc();
  const [ata] = await findAssociatedTokenPda({
    mint: address(USDC_MINT),
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const account = await withRetry(() => fetchMaybeToken(rpc, ata));
  if (!account.exists) return 0;
  return rawToUsdc(account.data.amount);
}

async function waitForSignature(rpc, sig, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await withRetry(() =>
      rpc.getSignatureStatuses([sig], { searchTransactionHistory: true }).send()
    );
    const st = res?.value?.[0];
    if (st?.err) throw new Error(`Tx falló on-chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
      let fee = null;
      try {
        const tx = await rpc
          .getTransaction(sig, {
            encoding: "json",
            maxSupportedTransactionVersion: 1,
            commitment: "confirmed",
          })
          .send();
        fee = tx?.meta?.fee ?? null;
        return { slot: tx?.slot ?? st.slot ?? null, fee };
      } catch {
        return { slot: st.slot ?? null, fee };
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

export async function sendTreasuryPayout({ to, usdc, kind, ars, fxRate, factura: facturaIn }) {
  assertIsAddress(to);
  const signer = await getTreasurySigner();
  const from = signer.address;
  const amount = usdcToRaw(usdc);
  const mint = address(USDC_MINT);
  const owner = address(from);
  const destinationOwner = address(to);

  const [sourceAta] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [destAta] = await findAssociatedTokenPda({
    mint,
    owner: destinationOwner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const factura = facturaIn || nuevaFactura();
  const memo = armarMemo({
    inv: factura,
    kind,
    cur: "ARS",
    amt: ars,
    fx: Number(fxRate).toFixed(2),
    usdc: Number(usdc).toFixed(6),
  });

  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: signer,
      ata: destAta,
      owner: destinationOwner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getTransferCheckedInstruction({
      source: sourceAta,
      mint,
      destination: destAta,
      authority: signer,
      amount,
      decimals: USDC_DECIMALS,
    }),
    getAddMemoInstruction({
      memo: String(memo),
      signers: [signer],
    }),
  ];

  const rpc = getRpc();
  const { value: latestBlockhash } = await withRetry(() => rpc.getLatestBlockhash().send());

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );

  const signed = await signTransactionMessageWithSigners(message);
  const wire = getBase64EncodedWireTransaction(signed);
  const hash = getSignatureFromTransaction(signed);

  await withRetry(() =>
    rpc
      .sendTransaction(wire, {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
      })
      .send()
  );

  let block = null;
  let fee = null;
  try {
    const status = await waitForSignature(rpc, hash, 45_000);
    block = status?.slot ?? null;
    fee = status?.fee != null ? String(Number(status.fee) / 1e9) : null;
  } catch {
    /* ok */
  }

  return { hash, block, fee, memo, factura, from, to, usdc, ars, fxRate, kind };
}

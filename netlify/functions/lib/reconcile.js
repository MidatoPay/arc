import { NETWORK } from "../../../src/network.js";
import { TRANSFER_TOPIC, memoFromLogs, weiToUsdc } from "../../../src/arc.js";
import { createArcRpc } from "./arcRpc.js";
// Reconciliación compartida: trae movimientos USDC de una address desde Arc y
// los inserta en `transactions` si faltan. Usado por reconcile-wallets.js (job)
// y transactions.js (GET).
//
// Fuente: logs `Transfer` del emisor de sistema de Arc (EIP-7708), que registra
// TODO movimiento de USDC (nativo y ERC-20) en 18 decimales. Se lee un solo
// emisor para no contar dos veces las transferencias ERC-20.

// eth_getLogs admite como máximo 10.000 bloques por llamada (~85 min).
export const MAX_LOG_RANGE = 9_999n;
const MAX_RANGES_PER_RUN = 6n;

const rpcCall = createArcRpc();

export function decodeMemo(text) {
  if (!text) return null;
  if (text.includes("\u0000") || text.includes("�")) return null;
  if (!text.startsWith("MIDATO|v1|")) return { text, fields: null };
  const fields = {};
  for (const part of text.split("|").slice(2)) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    fields[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return { text, fields };
}

const topicFor = (address) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const addressFromTopic = (topic) => `0x${String(topic).slice(-40)}`;

async function logs(rpc, network, fromBlock, toBlock, topics) {
  return rpc("eth_getLogs", [{
    address: network.systemEmitter,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics,
  }]);
}

/**
 * @param {import('pg').Pool} db
 * @param {{ userId: string, address: string, lastSyncedBlock: number|string|null, getFxRate: () => Promise<number> }} opts
 * @returns {Promise<string|null>} nuevo last_synced_block (número de bloque)
 */
export async function reconcileWallet(db, { userId, address, lastSyncedBlock, getFxRate }, adapters = {}) {
  const rpc = adapters.rpc || rpcCall, network = adapters.network || NETWORK;
  const head = BigInt(await rpc("eth_blockNumber", []));
  let from = lastSyncedBlock == null ? (head > MAX_LOG_RANGE ? head - MAX_LOG_RANGE : 0n) : BigInt(lastSyncedBlock) + 1n;
  if (from > head) return lastSyncedBlock == null ? null : String(lastSyncedBlock);
  const target = topicFor(address);
  let synced = lastSyncedBlock == null ? null : BigInt(lastSyncedBlock);
  const blockTimes = new Map();

  for (let ranges = 0n; from <= head && ranges < MAX_RANGES_PER_RUN; ranges++) {
    const to = from + MAX_LOG_RANGE - 1n < head ? from + MAX_LOG_RANGE - 1n : head;
    const [incoming, outgoing] = await Promise.all([
      logs(rpc, network, from, to, [TRANSFER_TOPIC, null, target]),
      logs(rpc, network, from, to, [TRANSFER_TOPIC, target, null]),
    ]);
    const entries = [...incoming.map((log) => ({ log, direction: "in" })), ...outgoing.map((log) => ({ log, direction: "out" }))]
      .filter(({ log }) => !log.removed)
      .sort((a, b) => Number(BigInt(a.log.blockNumber) - BigInt(b.log.blockNumber)));

    for (const { log, direction } of entries) {
      const hash = log.transactionHash;
      try {
        const amount = BigInt(log.data);
        if (amount <= 0n) continue;
        const usdc = weiToUsdc(amount);
        // Mint/burn (0x0) are not payments between wallets.
        const counterpartyAddress = addressFromTopic(direction === "in" ? log.topics[1] : log.topics[2]);
        if (/^0x0{40}$/.test(counterpartyAddress)) continue;

        const paymentJob = await db.query("SELECT id FROM charges WHERE tx_hash=$1 AND user_id=$2 AND network=$3", [hash, userId, network.network]);
        if (paymentJob.rowCount) continue; // payment worker writes its authoritative conversion metadata
        const transferJob = await db.query("SELECT id FROM wallet_transfers WHERE tx_hash=$1 AND user_id=$2 AND network=$3", [hash, userId, network.network]);
        if (transferJob.rowCount) continue; // transfer worker persists its authoritative outgoing movement

        const receipt = await rpc("eth_getTransactionReceipt", [hash]);
        if (!receipt || receipt.status !== "0x1") continue;
        const memoText = memoFromLogs(receipt.logs, network);
        const fields = decodeMemo(memoText)?.fields ?? null;

        let kind = "received";
        let factura = null;
        let ars = null;
        let fxRate;
        if (fields && fields.kind) {
          kind = ["voice", "pay", "charge_p2p"].includes(fields.kind) ? fields.kind : "received";
          factura = fields.inv ? String(fields.inv).slice(0, 64) : null;
          if (fields.cur === "ARS" && fields.amt) {
            const parsedArs = Number(fields.amt);
            if (Number.isFinite(parsedArs) && parsedArs > 0) {
              ars = parsedArs;
              fxRate = ars / Number(usdc);
            }
          }
        }
        if (ars == null) {
          fxRate = await getFxRate();
          ars = Number(usdc) * fxRate;
        }

        let who = `${counterpartyAddress.slice(0, 6)}…${counterpartyAddress.slice(-4)}`;
        const contact = await db.query(
          "SELECT name FROM contacts WHERE user_id = $1 AND lower(address) = lower($2) LIMIT 1",
          [userId, counterpartyAddress]
        );
        if (contact.rows[0]?.name) who = contact.rows[0].name;

        const block = BigInt(log.blockNumber);
        if (!blockTimes.has(block)) {
          const header = await rpc("eth_getBlockByNumber", [log.blockNumber, false]).catch(() => null);
          blockTimes.set(block, header?.timestamp ? new Date(Number(BigInt(header.timestamp)) * 1000).toISOString() : null);
        }
        // The fee belongs to the sender; for outgoing transfers it is in the receipt.
        const fee = direction === "out" ? weiToUsdc(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)) : null;

        await db.query(
          `INSERT INTO transactions (user_id, hash, kind, direction, who, amt, fx_rate, ars, factura, block, fee, memo, created_at, network)
           VALUES ($1, $2, $3, $13, $4, $5, $6, $7, $8, $9, $14, $10, COALESCE($11::timestamptz, now()), $12)
           ON CONFLICT (user_id, network, hash) DO NOTHING`,
          [userId, hash, kind, who, usdc, fxRate, ars, factura, String(block), memoText, blockTimes.get(block), network.network, direction, fee]
        );
      } catch (err) {
        console.error(`Failed to reconcile transaction ${hash || "unknown"}:`, err?.code || err?.message || "unknown");
      }
    }
    synced = to;
    from = to + 1n;
  }

  return synced == null ? null : String(synced);
}

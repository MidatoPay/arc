// Reconciliación compartida: trae transferencias USDC entrantes de ArcScan
// (Blockscout) para una address y las inserta en `transactions` si faltan.
// Usado por netlify/functions/reconcile-wallets.js (job) y
// netlify/functions/transactions.js (GET, al reabrir). No es una ruta —
// vive en lib/ a propósito, ver docs/superpowers/specs/2026-08-08-
// background-reconciliation-design.md § 2.

const ARCSCAN_API = "https://testnet.arcscan.app/api/v2";
const MAX_PAGES_FIRST_SYNC = 3; // ~150 txs — acota el costo del primer sync de una wallet nueva

/**
 * Decodifica raw_input (hex) a { text, fields }. fields es null si el
 * texto no matchea el formato MIDATO|v1|... (el texto se guarda igual, si
 * es UTF-8 válido, para no perder referencia de un memo no reconocido).
 * Devuelve null si raw_input está vacío o no es UTF-8 válido.
 */
export function decodeMemo(rawInputHex) {
  if (!rawInputHex || rawInputHex === "0x") return null;
  let text;
  try {
    text = Buffer.from(rawInputHex.slice(2), "hex").toString("utf8");
  } catch {
    return null;
  }
  if (!text.startsWith("MIDATO|v1|")) return { text, fields: null };
  const fields = {};
  for (const part of text.split("|").slice(2)) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    fields[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return { text, fields };
}

async function fetchArcScanPage(address, params) {
  const url = new URL(`${ARCSCAN_API}/addresses/${address}/transactions`);
  url.searchParams.set("filter", "to");
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`arcscan_http_${res.status}`);
  return res.json();
}

/**
 * Reconcilia una wallet: trae páginas de ArcScan (más nuevo primero) hasta
 * llegar a lastSyncedBlock (o hasta MAX_PAGES_FIRST_SYNC si no hay
 * checkpoint), inserta lo que falte, devuelve el nuevo checkpoint.
 *
 * @param {import('pg').Pool} db
 * @param {{ userId: string, address: string, lastSyncedBlock: number|null, getFxRate: () => Promise<number> }} opts
 * @returns {Promise<number|null>} nuevo last_synced_block (null si no hubo nada que procesar)
 */
export async function reconcileWallet(db, { userId, address, lastSyncedBlock, getFxRate }) {
  let params = {};
  let maxBlockSeen = lastSyncedBlock ?? null;
  let page = 0;
  const isFirstSync = lastSyncedBlock == null;

  while (true) {
    page++;
    const data = await fetchArcScanPage(address, params);
    const items = data.items || [];
    if (items.length === 0) break;

    for (const tx of items) {
      if (tx.status !== "ok") continue;
      if (lastSyncedBlock != null && tx.block_number <= lastSyncedBlock) continue;

      const decoded = decodeMemo(tx.raw_input);
      const fields = decoded?.fields ?? null;
      const memoText = decoded?.text ?? null;
      const usdc = Number(tx.value) / 1e18;
      if (!(usdc > 0)) continue; // filtra llamadas a contrato sin valor nativo

      let kind = "received";
      let factura = null;
      let ars = null;
      let fxRate;

      if (fields && fields.kind) {
        kind = fields.kind;
        factura = fields.inv || null;
        if (fields.cur === "ARS" && fields.amt) {
          ars = Number(fields.amt);
          fxRate = ars / usdc; // reconstruida del propio memo, no la cotización "de ahora"
        }
      }
      if (ars == null) {
        fxRate = await getFxRate();
        ars = usdc * fxRate;
      }

      const contact = await db.query(
        "SELECT name FROM contacts WHERE user_id = $1 AND LOWER(address) = LOWER($2) LIMIT 1",
        [userId, tx.from.hash]
      );
      const who = contact.rows[0]?.name || `${tx.from.hash.slice(0, 6)}…${tx.from.hash.slice(-4)}`;

      // fee no se popula acá (el formato exacto del campo `fee` de la API
      // de ArcScan no está verificado contra una transferencia real) — el
      // fee sólo se conoce con certeza en el flujo de detección en vivo
      // (findIncomingTransfer), que sí llama getTransactionReceipt.
      await db.query(
        `INSERT INTO transactions (user_id, hash, kind, direction, who, amt, fx_rate, ars, factura, block, fee, memo)
         VALUES ($1, $2, $3, 'in', $4, $5, $6, $7, $8, $9, NULL, $10)
         ON CONFLICT (user_id, hash) DO NOTHING`,
        [userId, tx.hash, kind, who, usdc, fxRate, ars, factura, tx.block_number, memoText]
      );

      if (maxBlockSeen == null || tx.block_number > maxBlockSeen) maxBlockSeen = tx.block_number;
    }

    const stoppedAtCheckpoint = lastSyncedBlock != null && items.some((tx) => tx.block_number <= lastSyncedBlock);
    if (stoppedAtCheckpoint) break;
    if (isFirstSync && page >= MAX_PAGES_FIRST_SYNC) break;
    if (!data.next_page_params) break;
    params = data.next_page_params;
  }

  return maxBlockSeen;
}

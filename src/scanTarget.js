import { isAddress } from "@solana/kit";
import { parsePayUrl } from "./payQr.js";

// Interpreta lo escaneado o pegado en "Pagar":
// - link de cobro MidatoPay (?pay=…, monto fijo en ARS) → kind "charge_p2p";
// - dirección de wallet Solana (texto plano, como el QR "Recibir USDC" de las apps cripto) → kind "pay";
// - URL Solana Pay de transferencia (solana:<dirección>?amount=…&spl-token=<mint USDC>) → kind "pay".
// Devuelve { kind, addr, name, usdc, ars, factura, solanaPay } o { error }.
// No decide la red: una dirección Solana es igual en devnet y mainnet; el usuario confirma antes de firmar.

const USDC_AMOUNT = /^\d{1,12}(?:\.\d{1,6})?$/;

export function parseScanTarget(raw, { mint, self } = {}) {
  const text = String(raw || "").trim();
  if (!text) return { error: "empty" };
  const checkSelf = (target) => (self && target.addr === self ? { error: "self" } : target);

  const midato = parsePayUrl(text);
  if (midato) {
    return checkSelf({ kind: "charge_p2p", addr: midato.addr, name: midato.who || "", ars: midato.ars, factura: midato.factura || "", usdc: null });
  }

  if (/^solana:/i.test(text)) {
    const body = text.slice("solana:".length);
    let decoded = body;
    try { decoded = decodeURIComponent(body); } catch { /* se valida abajo */ }
    if (/^https?:/i.test(decoded)) return { error: "transaction_request" };
    const [path, query = ""] = body.split("?");
    const addr = path.replace(/^\/\//, "");
    if (!isAddress(addr)) return { error: "invalid" };
    const params = new URLSearchParams(query);
    const token = params.get("spl-token");
    const amount = params.get("amount");
    if (token && token !== mint) return { error: "other_token" };
    if (!token && amount) return { error: "sol_request" };
    // Algunas billeteras exigen memo para acreditar; no podemos agregarlo y se perderían los fondos.
    if (params.get("memo")) return { error: "memo_required" };
    if (amount && (!USDC_AMOUNT.test(amount) || Number(amount) <= 0)) return { error: "invalid_amount" };
    return checkSelf({ kind: "pay", addr, name: params.get("label") || "", usdc: amount || null, ars: null, factura: "",
      solanaPay: params.has("reference") });
  }

  // Dirección sola. Algunas apps agregan parámetros o saltos de línea: se usa el primer token.
  const plain = text.split(/[?\s]/)[0];
  if (isAddress(plain)) return checkSelf({ kind: "pay", addr: plain, name: "", usdc: null, ars: null, factura: "" });
  return { error: "invalid" };
}

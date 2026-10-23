import { isAddress, sameAddress } from "./arc.js";
import { parsePayUrl } from "./payQr.js";
import { ARC } from "./chain.js";

// Interpreta lo escaneado o pegado en "Pagar":
// - link de cobro MidatoPay (?pay=…, monto fijo en ARS) → kind "charge_p2p";
// - dirección de wallet EVM (texto plano, como el QR "Recibir USDC" de las apps cripto) → kind "pay";
// - URI EIP-681 de transferencia USDC en Arc
//   (ethereum:<USDC>@<chainId>/transfer?address=<dirección>&uint256=<unidades de 6 decimales>) → kind "pay".
// Devuelve { kind, addr, name, usdc, ars, factura } o { error }.

const USDC_UNITS = /^\d{1,19}$/;

function eip681(text, usdc) {
  const match = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([A-Za-z0-9_]+))?(?:\?(.*))?$/i.exec(text);
  if (!match) return { error: "invalid" };
  const [, target, chain, fn, query = ""] = match;
  if (chain && Number(chain) !== ARC.chainId) return { error: "other_network" };
  const params = new URLSearchParams(query);
  // Pedido de valor nativo directo a una dirección (sin función): MidatoPay envía USDC por su interfaz ERC-20.
  if (!fn) {
    if (!isAddress(target)) return { error: "invalid" };
    if (params.get("value")) return { error: "native_request" };
    return { kind: "pay", addr: target, name: "", usdc: null, ars: null, factura: "" };
  }
  if (fn !== "transfer") return { error: "transaction_request" };
  if (!sameAddress(target, usdc)) return { error: "other_token" };
  const addr = params.get("address");
  if (!isAddress(addr || "")) return { error: "invalid" };
  const units = params.get("uint256");
  if (units != null && (!USDC_UNITS.test(units) || BigInt(units) <= 0n)) return { error: "invalid_amount" };
  const amount = units == null ? null : `${BigInt(units) / 1000000n}.${String(BigInt(units) % 1000000n).padStart(6, "0")}`;
  return { kind: "pay", addr, name: "", usdc: amount, ars: null, factura: "" };
}

export function parseScanTarget(raw, { usdc = ARC.usdc, self } = {}) {
  const text = String(raw || "").trim();
  if (!text) return { error: "empty" };
  const checkSelf = (target) => (target.addr && self && sameAddress(target.addr, self) ? { error: "self" } : target);

  const midato = parsePayUrl(text);
  if (midato) {
    return checkSelf({ kind: "charge_p2p", addr: midato.addr, name: midato.who || "", ars: midato.ars, factura: midato.factura || "", usdc: null });
  }

  if (/^ethereum:/i.test(text)) {
    const result = eip681(text, usdc);
    return result.error ? result : checkSelf(result);
  }

  // Dirección sola. Algunas apps agregan parámetros o saltos de línea: se usa el primer token.
  const plain = text.split(/[?\s]/)[0];
  if (isAddress(plain)) return checkSelf({ kind: "pay", addr: plain, name: "", usdc: null, ars: null, factura: "" });
  return { error: "invalid" };
}

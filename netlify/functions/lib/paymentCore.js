import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export class PaymentError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
export function decimalUnits(value, decimals) {
  const text = String(value);
  if (!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${decimals}})?$`).test(text)) throw new PaymentError("invalid_amount", 400);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}
export function unitsDecimal(value, decimals) {
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  return `${n / scale}.${String(n % scale).padStart(decimals, "0")}`;
}
export function quoteCharge(ars, rate, feeBps = 50) {
  const cents = decimalUnits(ars, 2), rateRaw = decimalUnits(rate, 18);
  if (cents <= 0n || cents > 100000000n || rateRaw <= 0n || feeBps !== 50) throw new PaymentError("invalid_amount_or_fee", 400);
  const fee = (cents * BigInt(feeBps) + 5000n) / 10000n;
  const raw = (cents - fee) * 10n ** 18n * 10000n / rateRaw;
  if (raw < 10000n) throw new PaymentError("amount_below_minimum", 400);
  return { amountCents: String(cents), feeCents: String(fee), usdcRaw: String(raw), rate: String(rate) };
}
export function orderBody(charge) {
  const amount = unitsDecimal(charge.amount_cents, 2);
  return { type: "qr", total_amount: amount, description: "Cobro MidatoPay",
    external_reference: charge.external_reference, expiration_time: "PT15M",
    config: { qr: { external_pos_id: charge.pos_id, mode: "dynamic" } },
    transactions: { payments: [{ amount }] } };
}
export function validateOrder(order, charge) {
  const payments = order.transactions?.payments;
  if (order.id !== charge.order_id && charge.order_id) throw new PaymentError("order_mismatch", 409);
  if (!/^ORD[A-Za-z0-9]+$/.test(order.id || "") || order.type !== "qr" ||
      String(order.user_id) !== charge.seller_id || order.currency !== "ARS" ||
      order.external_reference !== charge.external_reference ||
      decimalUnits(order.total_amount, 2) !== BigInt(charge.amount_cents) ||
      order.config?.qr?.external_pos_id !== charge.pos_id || !Array.isArray(payments) || payments.length !== 1 ||
      (order.live_mode !== undefined && order.live_mode !== (charge.environment === "production"))) {
    throw new PaymentError("order_mismatch", 409);
  }
  const payment = payments[0];
  if (!payment.id || decimalUnits(payment.amount, 2) !== BigInt(charge.amount_cents) ||
      (charge.payment_id && payment.id !== charge.payment_id)) throw new PaymentError("payment_mismatch", 409);
  const paid = order.status === "processed" && order.status_detail === "accredited";
  if (paid && (payment.status !== "processed" || payment.status_detail !== "accredited" ||
      decimalUnits(payment.paid_amount, 2) !== BigInt(charge.amount_cents) ||
      decimalUnits(order.total_paid_amount, 2) !== BigInt(charge.amount_cents))) throw new PaymentError("payment_mismatch", 409);
  return { paid, refunded: [order.status,payment.status].some((s) => /refunded/.test(s || "")) ||
      (Array.isArray(payment.refunds) && payment.refunds.length > 0) ||
      (Array.isArray(order.transactions?.refunds) && order.transactions.refunds.length > 0),
    terminal: ["expired", "canceled"].includes(order.status), paymentId: payment.id };
}
export function verifyWebhook(event, secret) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const id = event.queryStringParameters?.["data.id"], requestId = headers["x-request-id"];
  const signature = headers["x-signature"] || "";
  const parts = signature.split(",").map((x) => x.trim().split("="));
  const ts = parts.filter(([k]) => k === "ts"), hashes = parts.filter(([k]) => k === "v1");
  if (!secret || !/^ORD[A-Za-z0-9]+$/.test(id || "") || !requestId ||
      ts.length !== 1 || hashes.length !== 1 || !/^\d{1,16}$/.test(ts[0][1]) || !/^[a-f0-9]{64}$/i.test(hashes[0][1])) throw new PaymentError("invalid_signature", 401);
  const expected = createHmac("sha256", secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts[0][1]};`).digest();
  if (!timingSafeEqual(expected, Buffer.from(hashes[0][1], "hex"))) throw new PaymentError("invalid_signature", 401);
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body || "{}"); }
  catch { throw new PaymentError("invalid_json", 400); }
  if (body.type !== "order" || event.queryStringParameters?.type !== "order" || body.data?.id !== id) throw new PaymentError("invalid_event", 400);
  // Signature covers the order ID, not body contents. Body is only a reconciliation signal.
  const key = createHash("sha256").update(`${id}:${ts[0][1]}`).digest("hex");
  return { body, id, key };
}
export function publicCharge(c) {
  const status = c.cancel_requested && ["creating","awaiting_payment"].includes(c.status) ? "cancel_pending" : c.status;
  return { id: c.id, status, providerStatus: c.provider_status, providerDetail: c.provider_detail,
    ars: unitsDecimal(c.amount_cents, 2), feeArs: unitsDecimal(c.fee_cents, 2), feeBps: c.fee_bps,
    usdc: unitsDecimal(c.usdc_raw, 6), fxRate: c.fx_rate, qrData: c.qr_data,
    orderId: c.order_id, paymentId: c.payment_id, signature: c.signature,
    reference: c.external_reference, createdAt: c.created_at, expiresAt: c.expires_at,
    lastError: c.last_error, network: c.network };
}

export const USDC_DELIVERY_ESTIMATE_MS = 3 * 60 * 1000;

export function paymentReceived(charge) {
  if (!charge || charge.lastError === "mercadopago_refund_after_payout" || ["expired", "canceled", "refunded"].includes(charge.status) ||
    /refunded|canceled|expired/.test(charge.providerStatus || "")) return false;
  return ["paid", "delivery_pending", "broadcasting", "confirmed", "delivered"].includes(charge.status) ||
    (charge.providerStatus === "processed" && charge.providerDetail === "accredited");
}

export function canStartNewCharge(charge) {
  return paymentReceived(charge) || ["delivered", "expired", "canceled", "refunded", "manual_review", "cancel_pending"].includes(charge?.status);
}

// Presentation only: elapsed time never changes delivery status or releases funds.
export function deliveryPhase(charge, now = Date.now()) {
  if (!paymentReceived(charge)) return null;
  if (charge.status === "manual_review") return "review";
  if (charge.status === "delivered" || charge.settled === true) return "delivered";
  const paidAt = new Date(charge.paidAt || "").getTime();
  if (Number.isFinite(paidAt) && now - paidAt >= USDC_DELIVERY_ESTIMATE_MS) return "delayed";
  return charge.status === "confirmed" ? "confirmed" : "pending";
}

export function chargeStatusLabel(charge) {
  if (paymentReceived(charge)) return "Pago recibido";
  return ({ creating: "Generando QR…", awaiting_payment: "Esperando pago",
    cancel_pending: "Cancelación pendiente", expired: "QR vencido",
    canceled: "Cobro cancelado", refunded: "Reembolsado",
    manual_review: "En revisión" })[charge?.status] || "Actualizando…";
}

export function deliveryNoticeKey(charge, now) {
  return ({ pending: "chargeDeliveryEstimate", confirmed: "chargeDeliveryEstimate",
    delayed: "chargeDeliveryDelayedNotice", review: "chargeDeliveryReviewNotice" })[deliveryPhase(charge, now)] || null;
}

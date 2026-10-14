import { PaymentError } from "./paymentCore.js";

export async function mpRequest(path, settings, options = {}) {
  let response;
  try {
    response = await fetch(`https://api.mercadopago.com${path}`, { ...options,
      headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(12000) });
  } catch { throw new PaymentError("mercadopago_timeout"); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body.errors?.[0]?.code || body.error || body.message;
    const safeCode = ["pos_not_found", "forbidden", "unauthorized", "idempotency_key_already_used", "idempotency_key_conflict"].includes(code) ? code : `http_${response.status}`;
    throw new PaymentError(`mercadopago_${safeCode}`, response.status >= 500 ? 503 : 409);
  }
  return body;
}
let verified;
export async function verifySeller(settings) {
  if (verified?.token === settings.token && verified.seller === settings.seller && verified.pos === settings.pos && verified.until > Date.now()) return;
  const response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(10000) });
  const account = await response.json().catch(() => ({}));
  if (!response.ok || String(account.id) !== settings.seller || account.site_id !== "MLA") throw new PaymentError("seller_account_mismatch");
  if (settings.environment === "production" && account.tags?.includes("test_user")) throw new PaymentError("seller_is_test_account");
  if (settings.environment === "test" && !account.tags?.includes("test_user")) throw new PaymentError("seller_is_not_test_account");
  const result = await mpRequest(`/v2/pos?external_id=${encodeURIComponent(settings.pos)}&limit=30`, settings);
  if (!(result.results || []).some((p) => p.external_id === settings.pos && p.config?.qr?.operating_mode === "pdv")) throw new PaymentError("mercadopago_pos_not_found");
  verified = { token: settings.token, seller: settings.seller, pos: settings.pos, until: Date.now() + 60000 };
}

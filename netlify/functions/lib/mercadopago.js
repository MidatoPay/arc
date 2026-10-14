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
    const safeCode = ["pos_not_found", "store_not_found", "pos_already_exists", "forbidden", "unauthorized", "idempotency_key_already_used", "idempotency_key_conflict"].includes(code) ? code : `http_${response.status}`;
    throw new PaymentError(`mercadopago_${safeCode}`, response.status >= 500 ? 503 : 409);
  }
  return body;
}
let verified;
export async function verifySeller(settings) {
  if (verified?.token === settings.token && verified.seller === settings.seller && verified.pos === settings.pos && verified.environment === settings.environment && verified.until > Date.now()) return;
  const response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(10000) });
  const account = await response.json().catch(() => ({}));
  if (!response.ok || String(account.id) !== settings.seller || account.site_id !== "MLA") throw new PaymentError("seller_account_mismatch");
  if (settings.environment === "production" && account.tags?.includes("test_user")) throw new PaymentError("seller_is_test_account");
  if (settings.environment === "test" && !account.tags?.includes("test_user")) throw new PaymentError("seller_is_not_test_account");
  if (!settings.pos) {
    verified = { token:settings.token, seller:settings.seller, environment:settings.environment, until:Date.now()+60000 };
    return;
  }
  const result = await mpRequest(`/v2/pos?external_id=${encodeURIComponent(settings.pos)}&limit=30`, settings);
  // The current API returns data; older responses used results.
  const positions = Array.isArray(result.data) ? result.data : Array.isArray(result.results) ? result.results : null;
  if (!positions) throw new PaymentError("mercadopago_invalid_pos_response");
  const pos = positions.find((p) => p.external_id === settings.pos);
  if (!pos) throw new PaymentError("mercadopago_pos_not_found");
  if (pos.user_id != null && String(pos.user_id) !== settings.seller) throw new PaymentError("seller_account_mismatch");
  if (pos.config?.qr?.operating_mode !== "pdv") throw new PaymentError("mercadopago_pos_not_pdv");
  if (pos.status === "inactive") throw new PaymentError("mercadopago_pos_inactive");
  verified = { token: settings.token, seller: settings.seller, pos: settings.pos, environment: settings.environment, until: Date.now() + 60000 };
}

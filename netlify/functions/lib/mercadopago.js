import { PaymentError } from "./paymentCore.js";

export async function mpRequest(path, settings, options = {}) {
  let response;
  try {
    response = await fetch(`https://api.mercadopago.com${path}`, { ...options,
      headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(12000) });
  } catch { throw new PaymentError("mercadopago_timeout"); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.errors?.[0]?.code || body?.error || body?.message;
    const safeCode = ["pos_not_found", "store_not_found", "pos_already_exists", "forbidden", "unauthorized", "idempotency_key_already_used", "idempotency_key_conflict"].includes(code) ? code : `http_${response.status}`;
    throw new PaymentError(`mercadopago_${safeCode}`, response.status >= 500 ? 503 : 409);
  }
  if(!body || typeof body!=="object" || Array.isArray(body))throw new PaymentError("mercadopago_invalid_response");
  return body;
}
let verified,verifiedAccount;
export async function verifySellerAccount(settings) {
  if(verifiedAccount?.token===settings.token && verifiedAccount.seller===settings.seller && verifiedAccount.environment===settings.environment && verifiedAccount.until>Date.now())return;
  let response;
  try {response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(10000) });}
  catch {throw new PaymentError("mercadopago_timeout");}
  if(response.status===401)throw new PaymentError("mercadopago_http_401");
  if(response.status===403)throw new PaymentError("mercadopago_forbidden");
  const account = await response.json().catch(() => ({}));
  if(!response.ok)throw new PaymentError("mercadopago_account_unavailable");
  if (!account || String(account.id) !== settings.seller || account.site_id !== "MLA") throw new PaymentError("seller_account_mismatch");
  if (settings.environment === "production" && account.tags?.includes("test_user")) throw new PaymentError("seller_is_test_account");
  if (settings.environment === "test" && !account.tags?.includes("test_user")) throw new PaymentError("seller_is_not_test_account");
  verifiedAccount={token:settings.token,seller:settings.seller,environment:settings.environment,until:Date.now()+60000};
}
export async function verifyStore(settings) {
  if(!settings.store)throw new PaymentError("missing_mp_store_id");
  if(!/^\d+$/.test(settings.store))throw new PaymentError("invalid_mp_store_id");
  const store=await mpRequest(`/stores/${encodeURIComponent(settings.store)}`,settings);
  if(String(store.id)!==settings.store || String(store.user_id)!==settings.seller)throw new PaymentError("mercadopago_store_owner_mismatch");
  if(store.status==="inactive")throw new PaymentError("mercadopago_store_inactive");
  return store;
}
export async function verifySeller(settings) {
  if (verified?.token === settings.token && verified.seller === settings.seller && verified.pos === settings.pos && verified.environment === settings.environment && verified.until > Date.now()) return;
  await verifySellerAccount(settings);
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

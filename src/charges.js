import { SOLANA } from "./chain.js";
const storageKey = (userId) => `mp_charge_${SOLANA.cluster}_${userId}`;
export function readChargeAttempt(userId) {
  try { return JSON.parse(localStorage.getItem(storageKey(userId))); } catch { return null; }
}
export function saveChargeAttempt(userId, attempt) {
  localStorage.setItem(storageKey(userId), JSON.stringify(attempt));
}
export function clearChargeAttempt(userId) { localStorage.removeItem(storageKey(userId)); }
export function prepareChargeAttempt(previous, value, wallet) {
  if (previous?.id) return previous;
  return { key:previous?.key || crypto.randomUUID(), ars:String(value).replace(",","."), wallet:previous?.wallet || wallet };
}
export async function chargeApi(path, token, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type":"application/json",
    Authorization:`Bearer ${token}`, ...options.headers }, signal:AbortSignal.timeout(25000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || "payment_service_unavailable"); error.code = body.error; error.status = response.status; throw error; }
  return body;
}
export const CHARGE_ERRORS = {
  missing_mp_store_id:"Falta MP_STORE_ID en Netlify: el ID de la sucursal Mercado Pago donde se crearán las cajas de los comercios.",
  merchant_email_required:"Vinculá un email a tu usuario Privy para crear la caja del comercio.",
  merchant_pos_pending:"La caja de tu comercio se está creando. Intentá nuevamente en unos segundos.",
  merchant_pos_mismatch:"La caja del comercio no coincide con la cuenta o sucursal registrada. Requiere revisión.",
  mercadopago_store_not_found:"La sucursal Mercado Pago no existe o no pertenece a la cuenta configurada. Revisá MP_STORE_ID.",
  mercadopago_pos_inactive:"La caja Mercado Pago del comercio está inactiva.",
  payment_schema_missing:"Faltan las tablas de cobros en PostgreSQL. Aplicá las migraciones de Mercado Pago.",
  payment_schema_outdated:"El esquema de PostgreSQL está desactualizado. Aplicá las migraciones de Mercado Pago.",
  payment_database_auth_failed:"PostgreSQL rechazó las credenciales del servidor.",
  payment_database_permission_denied:"El usuario de PostgreSQL no tiene permisos para consultar los cobros.",
  payment_database_tls_failed:"No se pudo validar el certificado TLS de PostgreSQL. Revisá AIVEN_PG_CA_CERT.",
  payment_database_unavailable:"El servidor no puede conectarse a PostgreSQL. Revisá la conexión de la base.",
  invalid_database_url:"AIVEN_PG_URL no contiene una URL PostgreSQL válida.",
  missing_aiven_pg_url:"Falta AIVEN_PG_URL en las variables de Functions de Netlify.",
  missing_aiven_pg_ca_cert:"Falta AIVEN_PG_CA_CERT en las variables de Functions de Netlify.",
  idempotency_conflict:"Este intento ya tiene un cobro con otro importe. Recuperá esa operación antes de iniciar otra.",
  payments_disabled:"Los cobros están deshabilitados hasta completar la configuración productiva.",
  quote_unavailable:"No hay una cotización Chainlink vigente. Intentá nuevamente más tarde.",
  insufficient_treasury:"No hay suficiente liquidez USDC para iniciar este cobro.",
  insufficient_treasury_sol:"La tesorería necesita SOL para completar las entregas.",
  mercadopago_pos_not_found:"La caja Mercado Pago no está configurada para esta cuenta.",
  mercadopago_pos_not_pdv:"La caja existe, pero debe configurarse con config.qr.operating_mode=pdv para cobrar con este QR.",
  mercadopago_invalid_pos_response:"Mercado Pago devolvió un formato de cajas inesperado. No se inició el cobro.",
  seller_account_mismatch:"La cuenta Mercado Pago no coincide con el vendedor configurado.",
  seller_is_test_account:"La cuenta Mercado Pago configurada es de prueba; se necesita un vendedor real para producción.",
  seller_is_not_test_account:"Para el ambiente de prueba se necesita un vendedor de prueba de Mercado Pago.",
  mercadopago_forbidden:"Mercado Pago rechazó los permisos de la cuenta vendedora.",
  mercadopago_http_403:"Mercado Pago rechazó los permisos de la cuenta vendedora.",
  mercadopago_http_401:"La credencial Mercado Pago no es válida.",
  mercadopago_idempotency_key_conflict:"El proveedor detectó un conflicto en este cobro. Requiere revisión.",
  mercadopago_missing_qr:"Mercado Pago no devolvió un QR. Se está cancelando la orden.",
  mercadopago_timeout:"La respuesta de Mercado Pago está pendiente. Conservamos el mismo intento.",
  user_payment_review:"Tu cuenta tiene un cobro que requiere revisión.",
  amount_below_minimum:"El importe neto debe equivaler al menos a 0,01 USDC.",
  invalid_amount:"Ingresá un importe positivo con hasta dos decimales.",
  invalid_amount_or_fee:"El importe debe estar entre 0 y $1.000.000 ARS.",
  wallet_not_owned:"La wallet no pertenece a la sesión actual.",
  payment_network_mismatch:"La red de la billetera y el ambiente Mercado Pago no coinciden.",
};
export function chargeError(code) {
  return CHARGE_ERRORS[code] || (code?.startsWith("missing_") ? "Falta completar la configuración del servidor." : "El cobro no pudo actualizarse. Conservamos la operación para reintentar.");
}

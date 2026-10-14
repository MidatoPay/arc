import pg from "pg";
import { PrivyClient } from "@privy-io/server-auth";
import { timingSafeEqual } from "node:crypto";
import { NETWORK } from "../../../src/network.js";
import { PaymentError } from "./paymentCore.js";

let pool, privy;
export function getPaymentDb() {
  if (!pool) {
    if (!process.env.AIVEN_PG_URL?.trim()) throw new PaymentError("missing_aiven_pg_url");
    if (!process.env.AIVEN_PG_CA_CERT?.trim()) throw new PaymentError("missing_aiven_pg_ca_cert");
    const connectionString = (process.env.AIVEN_PG_URL || "").replace(/[?&]sslmode=[^&]*/, "");
    let hostname;
    try {
      const url = new URL(connectionString);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
      hostname = url.hostname;
    } catch { throw new PaymentError("invalid_database_url"); }
    pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
      ssl: { ca: (process.env.AIVEN_PG_CA_CERT || "").replace(/\\n/g, "\n"), rejectUnauthorized: true,
        servername: hostname } });
  }
  return pool;
}
export function getPaymentPrivy() {
  return privy ??= new PrivyClient(process.env.VITE_PRIVY_APP_ID, process.env.PRIVY_APP_SECRET);
}
export async function authenticatePayment(event) {
  const token = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new PaymentError("unauthorized", 401);
  try { return (await getPaymentPrivy().verifyAuthToken(token)).userId; }
  catch { throw new PaymentError("unauthorized", 401); }
}
export async function assertWalletOwned(userId, wallet) {
  const user = await getPaymentPrivy().getUser(userId);
  if (!(user.linkedAccounts || []).some((a) => a.type === "wallet" && a.address === wallet &&
    (a.chainType === "solana" || a.chain_type === "solana"))) throw new PaymentError("wallet_not_owned", 403);
}
export function paymentSettings() {
  const environment = process.env.MP_ENVIRONMENT || "test";
  if (!["test", "production"].includes(environment)) throw new PaymentError("invalid_mp_environment");
  if ((environment === "production") !== (NETWORK.cluster === "mainnet-beta")) throw new PaymentError("payment_network_mismatch");
  for (const key of ["MP_ACCESS_TOKEN", "MP_USER_ID", "MP_WEBHOOK_SECRET", "SOLANA_RPC", "INTERNAL_WORKER_SECRET"]) {
    if (!process.env[key]?.trim()) throw new PaymentError(`missing_${key.toLowerCase()}`);
  }
  if (process.env.INTERNAL_WORKER_SECRET.length < 32) throw new PaymentError("invalid_worker_secret");
  return { environment, network: NETWORK.cluster, seller: process.env.MP_USER_ID.trim(),
    store: process.env.MP_STORE_ID?.trim(), token: process.env.MP_ACCESS_TOKEN.trim() };
}
export function assertPaymentsEnabled() {
  if (process.env.PAYMENTS_ENABLED !== "true") throw new PaymentError("payments_disabled");
  if (process.env.CONVERSION_FEE_BPS && process.env.CONVERSION_FEE_BPS !== "50") throw new PaymentError("invalid_conversion_fee");
}
export function paymentQuoteSettings() {
  const rpc=process.env.ETH_RPC_URL?.trim();
  if (!rpc) throw new PaymentError("missing_eth_rpc_url");
  try {if(!["http:","https:"].includes(new URL(rpc).protocol))throw new Error();}
  catch {throw new PaymentError("invalid_eth_rpc_url");}
  const age=process.env.CHAINLINK_MAX_AGE_SECONDS?.trim();
  if (!age) throw new PaymentError("missing_chainlink_max_age_seconds");
  const maxAge=Number(age);
  if (!/^\d+$/.test(age) || !Number.isSafeInteger(maxAge) || maxAge<=0) throw new PaymentError("invalid_chainlink_max_age_seconds");
  return {rpc,maxAge};
}
export function internalAuthorized(event) {
  const actual = event.headers?.["x-worker-secret"] || event.headers?.["X-Worker-Secret"] || "";
  const secret = process.env.INTERNAL_WORKER_SECRET || "";
  return secret.length >= 32 && Buffer.byteLength(actual) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(secret));
}
export function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}
export function errorResponse(error) {
  if (!(error instanceof PaymentError)) {
    const codes = { "42P01":"payment_schema_missing", "42703":"payment_schema_outdated",
      "28P01":"payment_database_auth_failed", "42501":"payment_database_permission_denied",
      CERT_HAS_EXPIRED:"payment_database_tls_failed", SELF_SIGNED_CERT_IN_CHAIN:"payment_database_tls_failed",
      DEPTH_ZERO_SELF_SIGNED_CERT:"payment_database_tls_failed", UNABLE_TO_VERIFY_LEAF_SIGNATURE:"payment_database_tls_failed",
      ERR_TLS_CERT_ALTNAME_INVALID:"payment_database_tls_failed", ECONNREFUSED:"payment_database_unavailable",
      ETIMEDOUT:"payment_database_unavailable", ENOTFOUND:"payment_database_unavailable", ECONNRESET:"payment_database_unavailable" };
    const code = codes[error?.code] || "payment_service_unavailable";
    // Never log SQL, connection strings, request headers or arbitrary error messages.
    console.error("payments_failure", { code, causeCode: codes[error?.code] ? error.code : "unclassified" });
    return json(503, { error: code });
  }
  if (error.status>=500) console.error("payments_failure",{code:error.code});
  return json(error instanceof PaymentError ? error.status : 503,
    { error: error instanceof PaymentError ? error.code : "payment_service_unavailable" });
}
export async function transaction(fn, poolOverride) {
  const db = await (poolOverride || getPaymentDb()).connect();
  try { await db.query("BEGIN"); const result = await fn(db); await db.query("COMMIT"); return result; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
export async function kickWorker() {
  const origin = process.env.PAYMENTS_BASE_URL || process.env.URL;
  if (!origin || !process.env.INTERNAL_WORKER_SECRET) return;
  try {
    await fetch(new URL("/.netlify/functions/payments-worker-background", origin), {
      method: "POST", headers: { "x-worker-secret": process.env.INTERNAL_WORKER_SECRET }, signal: AbortSignal.timeout(4000) });
  } catch { /* durable records will be picked up by the scheduled dispatcher */ }
}

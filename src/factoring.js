import { useCallback, useEffect, useState } from "react";
// Browser client of the invoice cession pilot (plan T16). Amounts always come
// from the server as text with 2 decimals; this module only formats them.

/** Every server error code that has its own message; anything else falls back to `generic`. */
export const FACTORING_ERROR_CODES = Object.freeze([
  "unauthorized", "factoring_disabled", "factoring_role_required", "invalid_json", "invalid_body", "invalid_qr", "invalid_cuit",
  "unsupported_currency", "unsupported_invoice_type", "receiver_cuit_required", "invalid_due_date", "invalid_issue_date",
  "invalid_nominal", "invalid_idempotency_key", "invoice_duplicate", "idempotency_conflict", "debtor_not_listed",
  "issuer_cuit_mismatch", "nominal_above_pilot_cap", "invoice_not_found", "invalid_transition", "primary_wallet_required",
  "factoring_framework_missing", "already_accepted_tacitly", "payment_in_progress", "payment_not_yet_due",
  "debtor_insufficient_funds", "amount_below_provider_minimum", "amount_above_provider_maximum", "daily_limit_exceeded",
  "factoring_payments_disabled", "twentyone_unavailable", "twentyone_not_configured", "investor_kyc_required",
  "self_take_not_allowed", "offer_taken", "offer_expired", "terms_changed", "invoice_due_too_soon", "fce_investor_not_allowed",
  "fce_transfer_window_closed", "investor_insufficient_funds", "offer_not_found", "take_not_found", "payment_schema_missing",
  "network",
]);

export class FactoringApiError extends Error {
  constructor(code, status, body) { super(code); this.code = code; this.status = status; this.body = body; }
}

/** Authenticated JSON request with the Privy bearer, like src/merchantProfile.js. */
export async function factoringApi(path, getAccessToken, { method = "GET", body, idempotencyKey, timeoutMs = 25000, request = fetch } = {}) {
  const token = await getAccessToken();
  if (!token) throw new FactoringApiError("unauthorized", 401);
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response;
  try {
    response = await request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new FactoringApiError("network", 0);
  }
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  if (!response.ok) {
    const code = typeof json?.error === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(json.error) ? json.error : "generic";
    throw new FactoringApiError(code, response.status, json);
  }
  return json;
}

export function factoringErrorKey(code) {
  return `factoring.errors.${FACTORING_ERROR_CODES.includes(code) ? code : "generic"}`;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

const DISABLED = Object.freeze({ enabled: false, roles: Object.freeze({ issuer: false, debtor: false, investor: false, admin: false }),
  paymentsMode: null, nftEnabled: false });

/** Pilot access of the signed-in user; disabled (and silent) on any error, so the app looks as today. */
export function useFactoringAccess(userId, getAccessToken) {
  const [state, setState] = useState({ userId: null, access: DISABLED, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let canceled = false;
    setState({ userId: null, access: DISABLED, error: null });
    if (userId) factoringApi("/invoices/access", getAccessToken)
      .then(access => { if (!canceled) setState({ userId, access: { ...DISABLED, ...access }, error: null }); })
      .catch(error => { if (!canceled) setState({ userId, access: DISABLED, error: error.code || "generic" }); });
    return () => { canceled = true; };
  }, [userId, getAccessToken, revision]);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const access = state.userId === userId ? state.access : DISABLED;
  return { ...access, error: state.userId === userId ? state.error : null, retry };
}

/** '9934.99' → '9.934,99' (es) or '9,934.99' (en). String-only: never through Number. */
export function formatArs(text, lang = "es") {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(String(text ?? ""));
  if (!match) return String(text ?? "");
  const [, sign, whole, cents] = match;
  const [group, decimal] = lang === "es" ? [".", ","] : [",", "."];
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${decimal}${cents}`;
}

/** 3410 → '34,10%' (es) or '34.10%' (en). */
export function formatBps(bps, lang = "es") {
  if (!Number.isInteger(bps)) return "";
  const text = `${Math.floor(bps / 100)}${lang === "es" ? "," : "."}${String(bps % 100).padStart(2, "0")}%`;
  return text;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (es) or 'MM/DD/YYYY' (en), without time zone shifts. */
export function formatDate(iso, lang = "es") {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!match) return "";
  const [, y, m, d] = match;
  return lang === "es" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
}

/** Timestamp in Argentine time (UTC−3, no DST): 'DD/MM/YYYY HH:MM'. */
export function formatDateTime(isoTimestamp, lang = "es") {
  const ms = Date.parse(isoTimestamp || "");
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms - 3 * 3_600_000).toISOString();
  return `${formatDate(local.slice(0, 10), lang)} ${local.slice(11, 16)}`;
}

/** Today in Argentina as 'YYYY-MM-DD' (same rule as the server, D-02). */
export function argentinaToday(nowMs = Date.now()) {
  return new Date(nowMs - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Hours and minutes left until a timestamp, or null when it already passed. */
export function timeLeft(isoTimestamp, nowMs = Date.now()) {
  const ms = Date.parse(isoTimestamp || "") - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** 22-digit CVU in groups of 4 for reading (the full number is always shown). */
export function groupCvu(cvu) {
  return /^\d{22}$/.test(cvu || "") ? cvu.replace(/(\d{4})(?=\d)/g, "$1 ") : cvu || "";
}

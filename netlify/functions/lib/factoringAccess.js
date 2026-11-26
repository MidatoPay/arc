import { PaymentError } from './paymentCore.js';
// Same pattern as transferAccess.js: server configuration, never a client-controlled role.
const ids = text => (text || '').split(/[\s,]+/).filter(Boolean);

export function factoringEnabledFor(userId, env = process.env) {
  if (typeof userId !== 'string' || !userId) return false;
  if (env.FACTORING_ENABLED === 'true') return true;
  return ids(env.FACTORING_ALLOWED_USER_IDS).includes(userId);
}

export function assertFactoringEnabled(userId, env = process.env) {
  if (!factoringEnabledFor(userId, env)) throw new PaymentError('factoring_disabled', 503);
}

/** Admins are a separate list (least privilege): not the pilot allowlist, not PAYMENTS_ADMIN_USER_IDS. */
export function isFactoringAdmin(userId, env = process.env) {
  return typeof userId === 'string' && Boolean(userId) && ids(env.FACTORING_ADMIN_USER_IDS).includes(userId);
}

/** Active pilot parties of the user, by role, or null per missing role. */
export async function factoringRoles(db, userId) {
  const { rows } = await db.query(`SELECT id,user_id,role,cuit,legal_name,investor_type,kyc_status,kyc_source,tw_customer_id,cvu,
    framework_sha256,terms_accepted_at FROM factoring_parties WHERE user_id=$1 AND enabled`, [userId]);
  const roles = { issuer: null, investor: null, debtor: null };
  for (const row of rows) roles[row.role] = row;
  return roles;
}

export async function requireRole(db, userId, role) {
  const party = (await factoringRoles(db, userId))[role];
  if (!party) throw new PaymentError('factoring_role_required', 403);
  return party;
}

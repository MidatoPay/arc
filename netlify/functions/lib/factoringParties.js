import { relative, resolve, isAbsolute } from 'node:path';
import { isValidCuit, normalizeCuit } from '../../../src/invoiceQr.js';
import { isIsoDate } from '../../../src/invoiceCession.js';
import { transaction } from './paymentRuntime.js';
// Pilot parties (issuers, investors, debtors) are loaded from a file kept
// outside the repo. Error messages name the index and field, never the value.
const ROLES = ['issuer', 'investor', 'debtor'];
const INVESTOR_TYPES = ['entidad_financiera', 'proveedor_no_financiero_credito', 'persona_juridica', 'persona_humana'];
const KEYS = ['role', 'userId', 'cuit', 'legalName', 'twentyOneCustomerId', 'termsAcceptedAt', 'kycStatus', 'kycSource',
  'investorType', 'cvu', 'frameworkSha256', 'enabled'];

class PartiesFileError extends Error {
  constructor(index, field) {
    super(index === null ? `parties file: ${field}` : `parties[${index}].${field}: invalid`);
    this.code = 'invalid_parties_file'; this.index = index; this.field = field;
  }
}

export function validatePartiesFile(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.version !== 1 || !Array.isArray(json.parties))
    throw new PartiesFileError(null, 'expected {"version":1,"parties":[…]}');
  const seen = new Set(), debtorCuits = new Set();
  return json.parties.map((p, i) => {
    const bad = field => { throw new PartiesFileError(i, field); };
    if (!p || typeof p !== 'object' || Array.isArray(p)) bad('entry');
    const extra = Object.keys(p).find(key => !KEYS.includes(key));
    if (extra) bad('unknown_key');
    if (!ROLES.includes(p.role)) bad('role');
    if (typeof p.userId !== 'string' || !/^did:privy:[A-Za-z0-9]{1,64}$/.test(p.userId)) bad('userId');
    if (!isValidCuit(p.cuit)) bad('cuit');
    const cuit = normalizeCuit(p.cuit);
    const legalName = typeof p.legalName === 'string' ? p.legalName.trim() : '';
    if (!legalName || legalName.length > 160 || /[\u0000-\u001f\u007f]/.test(legalName)) bad('legalName');
    if (typeof p.termsAcceptedAt !== 'string' || !(isIsoDate(p.termsAcceptedAt) || !Number.isNaN(Date.parse(p.termsAcceptedAt)))) bad('termsAcceptedAt');
    const cvu = p.cvu ?? null;
    if (cvu !== null && (typeof cvu !== 'string' || !/^\d{22}$/.test(cvu))) bad('cvu');
    if (p.role !== 'debtor' && !cvu) bad('cvu');
    const customer = p.twentyOneCustomerId ?? null;
    if (customer !== null && (typeof customer !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(customer))) bad('twentyOneCustomerId');
    if (p.role !== 'issuer' && !customer) bad('twentyOneCustomerId');
    const investorType = p.investorType ?? null;
    if (p.role === 'investor' && !INVESTOR_TYPES.includes(investorType)) bad('investorType');
    if (p.role !== 'investor' && investorType !== null) bad('investorType');
    const kycStatus = p.kycStatus ?? 'pending';
    if (!['pending', 'approved', 'rejected'].includes(kycStatus)) bad('kycStatus');
    const kycSource = p.kycSource ?? null;
    if (kycSource !== null && (typeof kycSource !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(kycSource))) bad('kycSource');
    const framework = p.frameworkSha256 ?? null;
    if (framework !== null && (typeof framework !== 'string' || !/^[0-9a-f]{64}$/.test(framework))) bad('frameworkSha256');
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') bad('enabled');
    const key = `${p.userId}|${p.role}`;
    if (seen.has(key)) bad('duplicate_user_role');
    seen.add(key);
    if (p.role === 'debtor') {
      if (debtorCuits.has(cuit)) bad('duplicate_debtor_cuit');
      debtorCuits.add(cuit);
    }
    return { role: p.role, userId: p.userId, cuit, legalName, twentyOneCustomerId: customer, termsAcceptedAt: p.termsAcceptedAt,
      kycStatus, kycSource, investorType, cvu, frameworkSha256: framework, enabled: p.enabled ?? true };
  });
}

export async function upsertParties(db, parties) {
  return transaction(async client => {
    let inserted = 0, updated = 0;
    for (const p of parties) {
      const { rows: [row] } = await client.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,investor_type,kyc_status,
        kyc_source,tw_customer_id,cvu,framework_sha256,terms_accepted_at,enabled)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(user_id,role) DO UPDATE SET cuit=EXCLUDED.cuit,legal_name=EXCLUDED.legal_name,investor_type=EXCLUDED.investor_type,
          kyc_status=EXCLUDED.kyc_status,kyc_source=EXCLUDED.kyc_source,tw_customer_id=EXCLUDED.tw_customer_id,cvu=EXCLUDED.cvu,
          framework_sha256=EXCLUDED.framework_sha256,terms_accepted_at=EXCLUDED.terms_accepted_at,enabled=EXCLUDED.enabled,updated_at=now()
        RETURNING (xmax = 0) AS inserted`,
      [p.userId, p.role, p.cuit, p.legalName, p.investorType, p.kycStatus, p.kycSource, p.twentyOneCustomerId, p.cvu,
        p.frameworkSha256, p.termsAcceptedAt, p.enabled]);
      if (row.inserted) inserted += 1; else updated += 1;
    }
    return { inserted, updated };
  }, db);
}

/** The parties file holds real CUITs: it must live outside the repository. */
export function assertOutsideRepo(filePath, repoRoot) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw Object.assign(new Error('parties file path required'), { code: 'parties_path_required' });
  const target = resolve(filePath), root = resolve(repoRoot);
  const insensitive = process.platform === 'win32';
  const rel = relative(insensitive ? root.toLowerCase() : root, insensitive ? target.toLowerCase() : target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw Object.assign(new Error('the parties file must be outside the repository'), { code: 'parties_path_inside_repo' });
  return target;
}

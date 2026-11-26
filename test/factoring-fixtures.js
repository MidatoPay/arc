// Shared fixtures for the factoring tests (not a test file: `npm test` only runs *.test.js).
// CUITs are invented: an 8-digit body with the right check digit, never a real taxpayer.
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function checkDigit(first10) {
  const sum = WEIGHTS.reduce((total, weight, i) => total + weight * Number(first10[i]), 0);
  const check = 11 - (sum % 11);
  return check === 11 ? 0 : check;
}
/** Valid invented CUIT starting with `prefix`; walks the body until the check digit is not 10. */
export function makeCuit(prefix = '30', seed = 11111111) {
  for (let body = seed; ; body += 1) {
    const first10 = prefix + String(body).padStart(8, '0').slice(-8);
    const check = checkDigit(first10);
    if (check !== 10) return first10 + check;
  }
}
/** A 10-digit prefix whose check digit computes to 10 (always invalid). */
export function cuitPrefixGivingTen(prefix = '20') {
  for (let body = 10000000; ; body += 1) {
    const first10 = prefix + String(body);
    if (checkDigit(first10) === 10) return first10;
  }
}
export function fiscalQr(fields = {}, { host = 'www.afip.gob.ar', encoding = 'base64', path = '/fe/qr/', protocol = 'https:' } = {}) {
  const payload = { ver: 1, fecha: '2026-11-20', cuit: Number(makeCuit('30', 11111111)), ptoVta: 3, tipoCmp: 1, nroCmp: 42,
    importe: 10000, moneda: 'PES', ctz: 1, tipoDocRec: 80, nroDocRec: Number(makeCuit('30', 22222222)),
    tipoCodAut: 'E', codAut: 70417054367476, ...fields };
  const json = typeof fields === 'string' ? fields : JSON.stringify(payload);
  const p = Buffer.from(json, 'utf8').toString(encoding);
  return `${protocol}//${host}${path}?p=${p}`;
}
export const cvu = n => String(n).padStart(22, '0');

export const USERS = Object.freeze({ issuer: 'did:privy:issuer1', issuer2: 'did:privy:issuer2', debtor: 'did:privy:debtor1',
  investor: 'did:privy:investor1', investor2: 'did:privy:investor2', outsider: 'did:privy:outsider', admin: 'did:privy:admin1' });
export const WALLETS = Object.freeze({ issuer: '0x' + '1a'.repeat(20), investor: '0x' + '2b'.repeat(20), investor2: '0x' + '3c'.repeat(20) });
export const CUITS = Object.freeze({ issuer: makeCuit('30', 10000001), issuer2: makeCuit('30', 10000777), debtor: makeCuit('30', 20000002),
  investor: makeCuit('30', 30000003), investor2: makeCuit('20', 30000444) });
export const CVUS = Object.freeze({ issuer: cvu('11'), issuer2: cvu('12'), investor: cvu('21'), investor2: cvu('22'), fee: cvu('99') });

/** Inserts the pilot parties used across the factoring tests; returns their ids. */
export async function seedParties(db, { investorType = 'persona_juridica', investorKyc = 'approved' } = {}) {
  const insert = async (user, role, cuit, name, extra = {}) => (await db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,
    investor_type,kyc_status,kyc_source,tw_customer_id,cvu,terms_accepted_at) VALUES($1,$2,$3,$4,$5,$6,'21millions',$7,$8,'2026-11-01') RETURNING id`,
  [user, role, cuit, name, extra.investorType || null, extra.kyc || 'approved', extra.customer || null, extra.cvu || null])).rows[0].id;
  return {
    issuer: await insert(USERS.issuer, 'issuer', CUITS.issuer, 'Emisora Piloto SA', { cvu: CVUS.issuer }),
    issuer2: await insert(USERS.issuer2, 'issuer', CUITS.issuer2, 'Otra Emisora SRL', { cvu: CVUS.issuer2 }),
    debtor: await insert(USERS.debtor, 'debtor', CUITS.debtor, 'Deudora Grande SA', { customer: 'cus_debtor' }),
    investor: await insert(USERS.investor, 'investor', CUITS.investor, 'Inversora Uno SA',
      { investorType, kyc: investorKyc, customer: 'cus_investor', cvu: CVUS.investor }),
    investor2: await insert(USERS.investor2, 'investor', CUITS.investor2, 'Inversor Dos', { investorType: 'persona_humana', customer: 'cus_investor2', cvu: CVUS.investor2 }),
  };
}

/** A controllable clock: epoch milliseconds, starting at a fixed Argentine noon. */
export function fakeClock(start = '2026-11-25T15:00:00Z') {
  let ms = Date.parse(start);
  const now = () => ms;
  now.set = text => { ms = Date.parse(text); };
  now.advance = ({ days = 0, hours = 0, minutes = 0, seconds = 0 }) => { ms += ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000; };
  return now;
}

export const FRAMEWORK_SHA256 = 'f'.repeat(64);
export const pilotEnv = (extra = {}) => ({ FACTORING_ALLOWED_USER_IDS: Object.values(USERS).filter(u => u !== USERS.outsider).join(','),
  FACTORING_ADMIN_USER_IDS: USERS.admin, FACTORING_PAYMENTS_MODE: 'simulated', FACTORING_FEE_CVU: CVUS.fee,
  FACTORING_FRAMEWORK_SHA256: FRAMEWORK_SHA256, FACTORING_NFT_ENABLED: 'false', ...extra });

export const formInvoice = (debtorId, extra = {}) => ({ source: 'form', debtorId, cbteTipo: 6, ptoVta: 1, cbteNro: 1,
  issuedOn: '2026-11-20', dueOn: '2026-12-25', nominal: '10000.00', ...extra });

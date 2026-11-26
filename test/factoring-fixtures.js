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

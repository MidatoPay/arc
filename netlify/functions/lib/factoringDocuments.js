import { createHash, randomBytes } from 'node:crypto';
// Assignment annex of each cession. The real text comes from legal counsel
// (P-10); until then this draft has no legal value. The rendered text, with
// names and CUITs, stays in Postgres: only its SHA-256 goes on chain, and a
// random reference code keeps that hash from being guessed from known data.
export const ASSIGNMENT_TEMPLATE = Object.freeze({
  version: 'borrador-v0',
  text: [
    'BORRADOR, SIN VALOR LEGAL. Anexo de cesión de factura (plantilla de prueba del piloto MidatoPay).',
    'Referencia: {{reference}}. Fecha de la cesión: {{takenOn}}.',
    'Cedente (emisor): {{issuerName}}, CUIT {{issuerCuit}}.',
    'Cesionario (inversor): {{investorName}}, CUIT {{investorCuit}}.',
    'Deudor cedido: {{debtorName}}, CUIT {{debtorCuit}}.',
    'Comprobante: tipo {{cbteTipo}}, punto de venta {{ptoVta}}, número {{cbteNro}}, emitido el {{issuedOn}}, vence el {{dueOn}}.',
    'Valor nominal: ARS {{nominal}}. Días hasta el vencimiento: {{days}}. Tasa: {{rateBps}} pb TNA, base 365.',
    'El cesionario paga ARS {{advance}} al cedente y ARS {{fee}} de comisión a MidatoPay (desembolso total ARS {{outlay}}).',
    'Desde la cesión, el deudor paga el nominal al CVU {{investorCvu}} del cesionario.',
  ].join('\n'),
});

export function newAssignmentReference() {
  return randomBytes(12).toString('hex');
}

/** Fills {{placeholders}}; any missing value is an error, never an empty string. */
export function renderAssignment(template, data) {
  const text = template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    if (value === undefined || value === null || value === '') throw new Error(`assignment: missing ${key}`);
    return String(value);
  });
  return { version: template.version, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

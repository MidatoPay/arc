import { chargeApi } from "./charges.js";
export async function reportsApi(path,getAccessToken) {return chargeApi(path,await getAccessToken());}
export const csvColumns=["Comercio Privy","Fecha","Tipo","Estado","Dirección","ARS","Comisión ARS","Comisión %","Estado comisión","USDC","Cotización","Referencia","Orden MP","Pago MP","Firma Solana","Fecha comisión"];
export function csvCell(value) {
  let text=String(value ?? "");if(/^\s*[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function csvOperation(r) {return [r.merchantId,r.createdAt,r.source,r.status,r.direction,r.ars,r.feeArs,r.feeBps/100,
  r.commissionState,r.usdc,r.fxRate,r.reference,r.orderId,r.paymentId,r.signature,r.commissionEarnedAt].map(csvCell).join(",");}

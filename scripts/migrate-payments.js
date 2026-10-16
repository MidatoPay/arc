import { readFile } from "node:fs/promises";
import { getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";

const db = getPaymentDb();
try {
  for(const file of ["20261013_mercadopago.sql","20261013_commission_history.sql","20261014_merchant_pos.sql","20261014_merchant_pos_assignments.sql","20261016_payment_payout_attempts.sql"]) {
    const sql = await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8");
    await db.query(sql);
  }
  console.log("Migración Mercado Pago aplicada.");
} catch { console.error("No se pudo aplicar la migración. Verificá PostgreSQL, TLS y el esquema base existente.");process.exitCode=1; }
finally { await db.end(); }

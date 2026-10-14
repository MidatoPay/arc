import { createHash, randomUUID } from "node:crypto";
import { PaymentError } from "./paymentCore.js";
import { getPaymentDb, getPaymentPrivy, paymentSettings, assertPaymentsEnabled } from "./paymentRuntime.js";
import { verifySeller, mpRequest } from "./mercadopago.js";

export function merchantEmail(user) {
  const email=user.email?.address || (user.linkedAccounts || []).find(a=>a.type==="email")?.address ||
    (user.linkedAccounts || []).find(a=>["google_oauth","apple_oauth"].includes(a.type) && a.email)?.email;
  if (typeof email!=="string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentError("merchant_email_required",422);
  return email.trim();
}
export function merchantPosIdentity(userId,settings,email) {
  const externalId="MID"+createHash("sha256").update(JSON.stringify([settings.environment,settings.seller,userId])).digest("hex").slice(0,36);
  const name=email.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g," ").trim().slice(0,45).trim();
  if (!name) throw new PaymentError("merchant_email_required",422);
  return {externalId,name};
}
function validatePos(pos,mapping,settings) {
  if (!pos?.id || pos.external_id!==mapping.external_id || String(pos.store_id)!==mapping.store_id ||
    (pos.user_id!=null && String(pos.user_id)!==settings.seller)) throw new PaymentError("merchant_pos_mismatch");
  if (pos.config?.qr?.operating_mode!=="pdv") throw new PaymentError("mercadopago_pos_not_pdv");
  if (pos.status==="inactive") throw new PaymentError("mercadopago_pos_inactive");
}
export async function ensureMerchantPos(userId,settings=paymentSettings(),adapters={}) {
  assertPaymentsEnabled();
  const pool=adapters.db || getPaymentDb(),request=adapters.request || mpRequest;
  await (adapters.verifySeller || verifySeller)({...settings,pos:undefined});
  const db=await pool.connect();let locked=false;
  const lock=JSON.stringify(["merchant-pos",userId,settings.environment,settings.seller]);
  try {
    // Session lock serializes external creation; the intent is committed BEFORE calling Mercado Pago.
    const result=await db.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[lock]);
    locked=result.rows[0].locked;
    if (!locked) throw new PaymentError("merchant_pos_pending",409);
    let mapping=(await db.query("SELECT * FROM merchant_payment_pos WHERE user_id=$1 AND environment=$2 AND seller_id=$3",
      [userId,settings.environment,settings.seller])).rows[0];
    if (!mapping) {
      if (!/^\d+$/.test(settings.store || "")) throw new PaymentError("missing_mp_store_id");
      const user=await (adapters.getUser || (id=>getPaymentPrivy().getUser(id)))(userId);
      const email=merchantEmail(user),{externalId,name}=merchantPosIdentity(userId,settings,email);
      const body={name,store_id:settings.store,external_id:externalId,config:{qr:{operating_mode:"pdv"}}};
      mapping=(await db.query(`INSERT INTO merchant_payment_pos(user_id,environment,seller_id,merchant_email,pos_name,store_id,external_id,creation_key,creation_body)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [userId,settings.environment,settings.seller,email,name,settings.store,externalId,randomUUID(),body])).rows[0];
    }
    if (mapping.status==="ready") return mapping;
    const found=await request(`/v2/pos?external_id=${encodeURIComponent(mapping.external_id)}&limit=30`,settings);
    const list=Array.isArray(found.data)?found.data:Array.isArray(found.results)?found.results:null;
    if (!list) throw new PaymentError("mercadopago_invalid_pos_response");
    let pos=list.find(p=>p.external_id===mapping.external_id);
    if (!pos) {
      pos=await request("/v2/pos",settings,{method:"POST",headers:{"X-Idempotency-Key":mapping.creation_key},body:JSON.stringify(mapping.creation_body)});
    }
    validatePos(pos,mapping,settings);
    mapping=(await db.query(`UPDATE merchant_payment_pos SET pos_id=$4,status='ready',updated_at=now()
      WHERE user_id=$1 AND environment=$2 AND seller_id=$3 RETURNING *`,[userId,settings.environment,settings.seller,String(pos.id)])).rows[0];
    return mapping;
  } finally {
    let discard=false;
    try {if(locked)await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lock]);}
    catch {discard=true;}
    finally {db.release(discard);}
  }
}
export function publicMerchantPos(pos) {
  return {name:pos.merchant_email,status:pos.status};
}

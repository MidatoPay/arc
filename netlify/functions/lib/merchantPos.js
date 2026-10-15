import { createHash, randomUUID } from "node:crypto";
import { PaymentError } from "./paymentCore.js";
import { getPaymentDb, getPaymentPrivy, paymentSettings, assertPaymentsEnabled } from "./paymentRuntime.js";
import { verifySeller, verifyStore, mpRequest } from "./mercadopago.js";

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
async function claimAssignedPos(db,userId,email,settings) {
  await db.query("BEGIN");
  try {
    const assignment=(await db.query(`SELECT * FROM merchant_pos_assignments
      WHERE environment=$1 AND seller_id=$2 AND merchant_email=$3 FOR UPDATE`,
      [settings.environment,settings.seller,email.toLowerCase()])).rows[0];
    if (!assignment) {await db.query("COMMIT");return null;}
    if (assignment.claimed_user_id && assignment.claimed_user_id!==userId) throw new PaymentError("merchant_pos_already_assigned",409);
    const existing=(await db.query(`SELECT user_id FROM merchant_payment_pos
      WHERE environment=$1 AND seller_id=$2 AND (external_id=$3 OR pos_id=$4)`,
      [settings.environment,settings.seller,assignment.external_id,assignment.pos_id])).rows;
    if (existing.some(row=>row.user_id!==userId)) throw new PaymentError("merchant_pos_already_assigned",409);
    const body={name:assignment.pos_name,store_id:assignment.store_id,external_id:assignment.external_id,config:{qr:{operating_mode:"pdv"}}};
    const mapping=(await db.query(`INSERT INTO merchant_payment_pos
      (user_id,environment,seller_id,merchant_email,pos_name,store_id,external_id,pos_id,creation_key,creation_body,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready')
      ON CONFLICT(user_id,environment,seller_id) DO UPDATE SET
        merchant_email=EXCLUDED.merchant_email,pos_name=EXCLUDED.pos_name,store_id=EXCLUDED.store_id,
        creation_key=CASE WHEN merchant_payment_pos.external_id=EXCLUDED.external_id THEN merchant_payment_pos.creation_key ELSE EXCLUDED.creation_key END,
        creation_body=EXCLUDED.creation_body,external_id=EXCLUDED.external_id,pos_id=EXCLUDED.pos_id,status='ready',updated_at=now()
      RETURNING *`,[userId,settings.environment,settings.seller,email,assignment.pos_name,assignment.store_id,
      assignment.external_id,assignment.pos_id,randomUUID(),body])).rows[0];
    await db.query(`UPDATE merchant_pos_assignments SET claimed_user_id=$4,claimed_at=COALESCE(claimed_at,now())
      WHERE environment=$1 AND seller_id=$2 AND merchant_email=$3`,
      [settings.environment,settings.seller,email.toLowerCase(),userId]);
    await db.query("COMMIT");return mapping;
  } catch(error){await db.query("ROLLBACK");throw error;}
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
    const user=await (adapters.getUser || (id=>getPaymentPrivy().getUser(id)))(userId);
    const email=merchantEmail(user);
    const assigned=await claimAssignedPos(db,userId,email,settings);
    if (assigned) return assigned;
    let mapping=(await db.query("SELECT * FROM merchant_payment_pos WHERE user_id=$1 AND environment=$2 AND seller_id=$3",
      [userId,settings.environment,settings.seller])).rows[0];
    if (!mapping) {
      if (!/^\d+$/.test(settings.store || "")) throw new PaymentError("missing_mp_store_id");
      await (adapters.verifyStore || verifyStore)(settings);
      const {externalId,name}=merchantPosIdentity(userId,settings,email);
      const body={name,store_id:settings.store,external_id:externalId,config:{qr:{operating_mode:"pdv"}}};
      mapping=(await db.query(`INSERT INTO merchant_payment_pos(user_id,environment,seller_id,merchant_email,pos_name,store_id,external_id,creation_key,creation_body)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [userId,settings.environment,settings.seller,email,name,settings.store,externalId,randomUUID(),body])).rows[0];
    }
    if (mapping.status==="ready") return mapping;
    let found;
    try {found=await request(`/v2/pos?external_id=${encodeURIComponent(mapping.external_id)}&limit=30`,settings);}
    catch(error){if(error.code!=="mercadopago_pos_not_found")throw error;found={data:[]};}
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

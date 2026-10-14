import { getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";
import { mpRequest } from "../netlify/functions/lib/mercadopago.js";

const [emailInput,externalId]=process.argv.slice(2);
const email=emailInput?.trim().toLowerCase();
let pool,db;
try {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") || !/^[a-zA-Z0-9]{1,40}$/.test(externalId || ""))throw new Error("invalid_assignment_input");
  const settings={token:process.env.MP_ACCESS_TOKEN,seller:process.env.MP_USER_ID};
  if(!settings.token || !settings.seller)throw new Error("missing_mp_configuration");
  const response=await fetch("https://api.mercadolibre.com/users/me",{headers:{Authorization:`Bearer ${settings.token}`},signal:AbortSignal.timeout(10000)});
  const account=await response.json();
  if(!response.ok || String(account.id)!==settings.seller || account.site_id!=="MLA")throw new Error("seller_account_mismatch");
  const environment=account.tags?.includes("test_user")?"test":"production";
  const result=await mpRequest(`/v2/pos?external_id=${encodeURIComponent(externalId)}&limit=30`,settings);
  const list=Array.isArray(result.data)?result.data:Array.isArray(result.results)?result.results:[];
  const pos=list.find(p=>p.external_id===externalId);
  if(!pos?.id || !pos.store_id || String(pos.user_id)!==settings.seller || pos.config?.qr?.operating_mode!=="pdv" || pos.status==="inactive")throw new Error("merchant_pos_mismatch");
  pool=getPaymentDb();db=await pool.connect();await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify(["pos-assignment",environment,settings.seller,externalId])]);
  const conflict=await db.query(`SELECT 1 FROM merchant_payment_pos WHERE environment=$1 AND seller_id=$2
    AND (external_id=$3 OR pos_id=$4) AND lower(merchant_email)<>$5`,[environment,settings.seller,externalId,String(pos.id),email]);
  if(conflict.rowCount)throw new Error("merchant_pos_already_assigned");
  const previous=(await db.query(`SELECT * FROM merchant_pos_assignments WHERE environment=$1 AND seller_id=$2 AND merchant_email=$3 FOR UPDATE`,[environment,settings.seller,email])).rows[0];
  if(previous && (previous.external_id!==externalId || previous.pos_id!==String(pos.id)))throw new Error("assignment_conflict");
  await db.query(`INSERT INTO merchant_pos_assignments(environment,seller_id,merchant_email,external_id,pos_id,store_id,pos_name)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,seller_id,merchant_email) DO NOTHING`,
    [environment,settings.seller,email,externalId,String(pos.id),String(pos.store_id),pos.name || externalId]);
  const saved=(await db.query(`SELECT claimed_user_id FROM merchant_pos_assignments WHERE environment=$1 AND seller_id=$2 AND merchant_email=$3`,[environment,settings.seller,email])).rows[0];
  await db.query("COMMIT");
  console.log(JSON.stringify({assignmentSaved:true,environment,externalId,linkedToPrivy:Boolean(saved.claimed_user_id),claimOnNextLogin:!saved.claimed_user_id}));
} catch(error) {
  if(db)await db.query("ROLLBACK").catch(()=>{});
  const safe=["invalid_assignment_input","missing_mp_configuration","seller_account_mismatch","merchant_pos_mismatch","merchant_pos_already_assigned","assignment_conflict"];
  console.error(error.code || (safe.includes(error.message)?error.message:"assignment_failed"));process.exitCode=1;
} finally {db?.release();if(pool)await pool.end();}

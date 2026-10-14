import { PaymentError, unitsDecimal, publicCharge } from "./paymentCore.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isPaymentAdmin(userId, configured=process.env.PAYMENTS_ADMIN_USER_IDS || "") {
  return Boolean(userId && configured.split(/[\s,]+/).filter(Boolean).includes(userId));
}
export function assertPaymentAdmin(userId) {
  if(!isPaymentAdmin(userId)) throw new PaymentError("admin_required",403);
}
function day(value,end=false) {
  if(!value) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PaymentError("invalid_report_date",400);
  const date=new Date(`${value}T00:00:00-03:00`);
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new PaymentError("invalid_report_date",400);
  return new Date(date.getTime()+(end?86400000:0)).toISOString();
}
export function reportFilters(query={}, defaultEnvironment=process.env.MP_ENVIRONMENT || "test") {
  const environment=query.environment || defaultEnvironment;
  if(!["test","production"].includes(environment)) throw new PaymentError("invalid_report_environment",400);
  const limit=Number(query.limit || 50);
  if(!Number.isInteger(limit) || limit<1 || limit>200) throw new PaymentError("invalid_report_limit",400);
  const from=day(query.from),to=day(query.to,true);
  if(from && to && from>=to) throw new PaymentError("invalid_report_date_range",400);
  if(query.merchant && (query.merchant.length>150 || !/^did:privy:[A-Za-z0-9_-]+$/.test(query.merchant))) throw new PaymentError("invalid_merchant",400);
  const statuses=["creating","awaiting_payment","paid","delivery_pending","broadcasting","delivered","cancel_pending","expired","canceled","refunded","manual_review","confirmed"];
  if(query.status && !statuses.includes(query.status)) throw new PaymentError("invalid_report_status",400);
  if(query.source && !["mercadopago","wallet"].includes(query.source)) throw new PaymentError("invalid_report_source",400);
  return {environment,network:environment==="production"?"mainnet-beta":"devnet",from,to,
    merchant:query.merchant || null,status:query.status || null,source:query.source || null,limit};
}
export function decodeCursor(value) {
  if(!value) return null;
  try {
    if(value.length>1500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const c=JSON.parse(Buffer.from(value,"base64url").toString());
    if(typeof c.date!=="string" || !/^\d{4}-\d{2}-\d{2}[ T]/.test(c.date) || !Number.isFinite(Date.parse(c.date)) ||
      typeof c.key!=="string" || c.key.length>100 || typeof c.scope!=="string") throw new Error();
    return c;
  } catch {throw new PaymentError("invalid_report_cursor",400);}
}
function cursor(date,key,scope) {return Buffer.from(JSON.stringify({date,key,scope})).toString("base64url");}
function scope(filters,type) {
  const {limit,...rest}=filters;return JSON.stringify({type,...rest});
}
function page(rows,limit,scopeValue,map) {
  const hasMore=rows.length>limit,visible=rows.slice(0,limit),last=visible.at(-1);
  return {items:visible.map(map),nextCursor:hasMore?cursor(last.cursor_date,last.sort_key,scopeValue):null};
}
export async function listOwnCharges(db,userId,settings,query={}) {
  const limit=Number(query.limit || 100);
  if(!Number.isInteger(limit) || limit<1 || limit>200) throw new PaymentError("invalid_report_limit",400);
  const scopeValue=JSON.stringify({type:"own",userId,environment:settings.environment,network:settings.network});
  const after=decodeCursor(query.cursor);
  if(after && (after.scope!==scopeValue || !uuid.test(after.key))) throw new PaymentError("invalid_report_cursor",400);
  const {rows}=await db.query(`SELECT c.*,created_at::text AS cursor_date,id::text AS sort_key FROM charges c
    WHERE user_id=$1 AND environment=$2 AND network=$3
    ${after?"AND (created_at,id)<($5::timestamptz,$6::uuid)":""}
    ORDER BY created_at DESC,id DESC LIMIT $4`,[userId,settings.environment,settings.network,limit+1,...(after?[after.date,after.key]:[])]);
  const result=page(rows,limit,scopeValue,publicCharge);
  return {charges:result.items,nextCursor:result.nextCursor};
}

// A charge and its USDC settlement are one operation; the settlement ledger row is not counted twice.
const operationsSql=`WITH operations AS (
  SELECT 'mercadopago'::text AS source,c.id,c.user_id AS merchant,c.created_at AS occurred_at,
    'mercadopago:'||c.id::text AS sort_key,c.status,c.provider_status,c.provider_detail,'in'::text AS direction,
    c.wallet_address,c.amount_cents,c.fee_cents,c.fee_bps,c.usdc_raw,c.fx_rate,c.external_reference AS reference,
    c.order_id,c.payment_id,c.signature,c.delivered_at,l.earned_at AS commission_earned_at,
    l.fee_cents AS recorded_fee_cents,
    (c.status='manual_review' OR c.provider_status LIKE '%refunded%' OR EXISTS(
      SELECT 1 FROM payment_incidents i WHERE i.charge_id=c.id AND i.resolved_at IS NULL)) AS needs_review
  FROM charges c LEFT JOIN commission_ledger l ON l.charge_id=c.id WHERE c.environment=$1 AND c.network=$2
  UNION ALL
  SELECT 'wallet',t.id,t.user_id,t.created_at,'wallet:'||t.id::text,'confirmed',NULL,NULL,t.direction,w.address,
    ROUND(t.ars*100)::bigint,0::bigint,0,ROUND(t.amt*1000000)::bigint,t.fx_rate,t.factura,NULL,NULL,t.hash,
    t.created_at,NULL,NULL,false
  FROM transactions t LEFT JOIN wallets w ON w.user_id=t.user_id AND w.network=t.network
  WHERE t.network=$2 AND t.charge_id IS NULL AND NOT EXISTS(
    SELECT 1 FROM charges c WHERE c.signature=t.hash AND c.user_id=t.user_id AND c.network=t.network)
), filtered AS (
  SELECT * FROM operations WHERE ($3::timestamptz IS NULL OR occurred_at>=$3) AND ($4::timestamptz IS NULL OR occurred_at<$4)
    AND ($5::text IS NULL OR merchant=$5) AND ($6::text IS NULL OR status=$6) AND ($7::text IS NULL OR source=$7)
)`;
const filterParams=(f)=>[f.environment,f.network,f.from,f.to,f.merchant,f.status,f.source];
export function operationFromRow(r) {
  return {id:r.id,source:r.source,merchantId:r.merchant,createdAt:r.occurred_at,status:r.status,providerStatus:r.provider_status,
    direction:r.direction,wallet:r.wallet_address,ars:unitsDecimal(r.amount_cents,2),feeArs:unitsDecimal(r.fee_cents,2),feeBps:r.fee_bps,
    usdc:unitsDecimal(r.usdc_raw,6),fxRate:String(r.fx_rate),reference:r.reference,orderId:r.order_id,paymentId:r.payment_id,
    signature:r.signature,deliveredAt:r.delivered_at,commissionEarnedAt:r.commission_earned_at,
    commissionState:r.source==="wallet"?"not_applicable":r.recorded_fee_cents!=null?(r.needs_review?"review":"recorded"):
      ["expired","canceled","refunded"].includes(r.status)?"not_earned":"estimated"};
}
export async function listReportOperations(db,filters,query={}) {
  const scopeValue=scope(filters,"operations"),after=decodeCursor(query.cursor);
  if(after && (after.scope!==scopeValue || !/^(mercadopago|wallet):[0-9a-f-]{36}$/i.test(after.key))) throw new PaymentError("invalid_report_cursor",400);
  const {rows}=await db.query(`${operationsSql} SELECT *,occurred_at::text AS cursor_date FROM filtered
    ${after?"WHERE (occurred_at,sort_key)<($9::timestamptz,$10::text)":""}
    ORDER BY occurred_at DESC,sort_key DESC LIMIT $8`,[...filterParams(filters),filters.limit+1,...(after?[after.date,after.key]:[])]);
  const result=page(rows,filters.limit,scopeValue,operationFromRow);
  return {operations:result.items,nextCursor:result.nextCursor};
}

export async function reportSummary(db,filters) {
  const operations=await db.query(`${operationsSql} SELECT merchant,COUNT(*)::text AS operation_count,
    COUNT(*) FILTER(WHERE source='mercadopago')::text AS charge_count,
    COUNT(*) FILTER(WHERE source='wallet')::text AS wallet_count,
    COALESCE(SUM(amount_cents) FILTER(WHERE source='mercadopago' AND delivered_at IS NOT NULL),0)::text AS settled_cents,
    COALESCE(SUM(fee_cents) FILTER(WHERE source='mercadopago' AND recorded_fee_cents IS NULL
      AND status NOT IN ('expired','canceled','refunded')),0)::text AS estimated_fee_cents
    FROM filtered GROUP BY merchant`,filterParams(filters));
  const fees=await db.query(`SELECT l.merchant_user_id AS merchant,COUNT(*)::text AS recorded_fee_count,
    SUM(l.fee_cents)::text AS recorded_fee_cents,
    COALESCE(SUM(l.fee_cents) FILTER(WHERE c.status='manual_review' OR c.provider_status LIKE '%refunded%' OR EXISTS(
      SELECT 1 FROM payment_incidents i WHERE i.charge_id=c.id AND i.resolved_at IS NULL)),0)::text AS review_fee_cents
    FROM commission_ledger l JOIN charges c ON c.id=l.charge_id
    WHERE l.environment=$1 AND l.network=$2 AND ($3::timestamptz IS NULL OR l.earned_at>=$3)
      AND ($4::timestamptz IS NULL OR l.earned_at<$4) AND ($5::text IS NULL OR l.merchant_user_id=$5)
      AND ($6::text IS NULL OR c.status=$6) AND ($7::text IS NULL OR $7='mercadopago') GROUP BY l.merchant_user_id`,filterParams(filters));
  const byMerchant=new Map();
  for(const r of [...operations.rows,...fees.rows]) byMerchant.set(r.merchant,{...byMerchant.get(r.merchant),...r});
  const keys=["operation_count","charge_count","wallet_count","settled_cents","estimated_fee_cents","recorded_fee_count","recorded_fee_cents","review_fee_cents"];
  const rawTotals=Object.fromEntries(keys.map((k)=>[k,0n]));
  const format=(r)=>({merchantId:r.merchant,operations:Number(r.operation_count || 0),charges:Number(r.charge_count || 0),
    walletMovements:Number(r.wallet_count || 0),settledArs:unitsDecimal(r.settled_cents || 0,2),
    estimatedFeeArs:unitsDecimal(r.estimated_fee_cents || 0,2),recordedFees:Number(r.recorded_fee_count || 0),
    recordedFeeArs:unitsDecimal(r.recorded_fee_cents || 0,2),reviewFeeArs:unitsDecimal(r.review_fee_cents || 0,2),
    feeArsWithoutReview:unitsDecimal(BigInt(r.recorded_fee_cents || 0)-BigInt(r.review_fee_cents || 0),2)});
  for(const r of byMerchant.values()) for(const k of keys) rawTotals[k]+=BigInt(r[k] || 0);
  return {environment:filters.environment,network:filters.network,totals:format(rawTotals),
    merchants:[...byMerchant.values()].map(format).sort((a,b)=>a.merchantId.localeCompare(b.merchantId)),
    operationDateBasis:"created_at",commissionDateBasis:"earned_at",currency:"ARS"};
}

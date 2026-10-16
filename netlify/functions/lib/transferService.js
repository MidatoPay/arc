import {randomUUID} from 'node:crypto';
import {isAddress} from '@solana/kit';
import {NETWORK} from '../../../src/network.js';
import {getPaymentDb,transaction,paymentQuoteSettings} from './paymentRuntime.js';
import {PaymentError,decimalUnits,unitsDecimal} from './paymentCore.js';
import {resolvePrimaryWallet} from './primaryWallet.js';
import {transferRpc,sourceBalance,prepareTransfer,validateUserSignature,signSponsoredTransfer} from './transferChain.js';
import {fetchArsQuote} from '../../../src/priceFeed.js';
import {assertTransfersEnabled} from './transferAccess.js';

export async function transferQuote(adapters={}) {
 const {rpc,maxAge}=paymentQuoteSettings(adapters.env || process.env);
 return (await (adapters.fetchQuote || fetchArsQuote)(rpc,maxAge)).rate;
}
export function transferLimits(env=process.env) {
 const daily=decimalUnits(env.TRANSFER_DAILY_SOL_BUDGET || '0.05',9),single=decimalUnits(env.TRANSFER_MAX_SOL_COST || '0.003',9);
 if(daily<=0n || single<=0n || single>daily)throw new PaymentError('invalid_transfer_limits');
 return {daily,single};
}
export function transferDay(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=type=>parts.find(part=>part.type===type).value;
 const day=`${value('year')}-${value('month')}-${value('day')}`;
 return {day,resetsAt:new Date(new Date(`${day}T00:00:00-03:00`).getTime()+86400000).toISOString()};
}
export function publicTransfer(t,includeWire=false) {
 return {id:t.id,from:t.from_address,to:t.to_address,usdc:unitsDecimal(t.usdc_raw,6),kind:t.kind,
  recipient:t.recipient_name,network:t.network,status:t.status,signature:t.signature || null,
  createdAt:t.created_at,finalizedAt:t.finalized_at,lastError:t.last_error || null,
  fxRate:t.fx_rate,ars:t.ars,block:t.block,feePayer:t.fee_payer,userFeeSol:'0',
  ...(includeWire && t.status==='awaiting_signature'?{transaction:t.unsigned_wire}: {})};
}
export async function transferQuota(db,userId,network=NETWORK.cluster,now=new Date()) {
 const date=transferDay(now);
 const {rows:[row]}=await db.query(`SELECT count(*)::int AS used FROM wallet_transfers
  WHERE user_id=$1 AND network=$2 AND sponsor_day=$3 AND signature IS NOT NULL`,[userId,network,date.day]);
 return {limit:2,used:Number(row.used),remaining:Math.max(0,2-Number(row.used)),resetsAt:date.resetsAt};
}
async function recoverPreparation(t,adapters,pool) {
 if(t.signature || t.status!=='awaiting_signature')return t;
 const rpc=adapters.rpc || transferRpc;
 if(BigInt(await rpc('getBlockHeight',[{commitment:'confirmed'}]))<=BigInt(t.last_valid_block_height))return t;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${t.network}:${t.user_id}`]);
  const current=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 FOR UPDATE',[t.id])).rows[0];
  if(current.signature || current.status!=='awaiting_signature')return current;
  const prepared=await (adapters.prepare || prepareTransfer)({from:t.from_address,to:t.to_address,raw:t.usdc_raw,memo:t.memo});
  return (await db.query(`UPDATE wallet_transfers SET unsigned_wire=$2,last_valid_block_height=$3,fee_payer=$4,cost_lamports=$5 WHERE id=$1 RETURNING *`,
   [t.id,prepared.unsigned_wire,prepared.last_valid_block_height,prepared.fee_payer,prepared.cost_lamports])).rows[0];
 },pool);
}
export async function createTransfer(userId,input,key,adapters={}) {
 assertTransfersEnabled(userId);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key || ''))throw new PaymentError('invalid_idempotency_key',400);
 if(!input || typeof input.amount!=='string' || !isAddress(input.to || '') || !isAddress(input.from || ''))throw new PaymentError('invalid_transfer',400);
 const raw=decimalUnits(input.amount,6);
 if(raw<=0n || raw>9223372036854775807n || input.to===input.from)throw new PaymentError('invalid_transfer_amount',400);
 const kind=input.kind || 'pay';if(!['pay','voice','charge_p2p'].includes(kind))throw new PaymentError('invalid_transfer_kind',400);
 const network=adapters.network || NETWORK.cluster,pool=adapters.db || getPaymentDb();
 const existing=await pool.query('SELECT * FROM wallet_transfers WHERE user_id=$1 AND network=$2 AND idempotency_key=$3',[userId,network,key]);
 if(existing.rows[0]) {
  const t=existing.rows[0];
  if(t.from_address!==input.from || t.to_address!==input.to || BigInt(t.usdc_raw)!==raw || t.kind!==kind)throw new PaymentError('idempotency_conflict',409);
  return recoverPreparation(t,adapters,pool);
 }
 const primary=await (adapters.primary || resolvePrimaryWallet)(userId);
 if(primary.address!==input.from)throw new PaymentError('primary_wallet_required',403);
 if((await transferQuota(pool,userId,network)).remaining===0)throw new PaymentError('transfer_daily_limit',429);
 if(await (adapters.balance || sourceBalance)(input.from)<raw)throw new PaymentError('insufficient_usdc',409);
 const id=randomUUID(),memo=`MIDATO|v1|inv:transfer_${id}|kind:${kind}|usdc:${unitsDecimal(raw,6)}`;
 const prepared=await (adapters.prepare || prepareTransfer)({from:input.from,to:input.to,raw:String(raw),memo});
 if(BigInt(prepared.cost_lamports)>transferLimits().single)throw new PaymentError('transfer_cost_limit',409);
 const contact=(await pool.query('SELECT name FROM contacts WHERE user_id=$1 AND address=$2 ORDER BY created_at LIMIT 1',[userId,input.to])).rows[0];
 const rate=await (adapters.quote || transferQuote)();
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-create:${network}:${userId}:${key}`]);
  const duplicate=(await db.query('SELECT * FROM wallet_transfers WHERE user_id=$1 AND network=$2 AND idempotency_key=$3',[userId,network,key])).rows[0];
  if(duplicate) {
   if(duplicate.from_address!==input.from || duplicate.to_address!==input.to || BigInt(duplicate.usdc_raw)!==raw || duplicate.kind!==kind)throw new PaymentError('idempotency_conflict',409);
   return duplicate;
  }
  return (await db.query(`INSERT INTO wallet_transfers(id,user_id,network,from_address,to_address,usdc_raw,kind,recipient_name,
   idempotency_key,unsigned_wire,last_valid_block_height,memo,fee_payer,cost_lamports,fx_rate,ars)
   VALUES($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,$11,$12,$13,$14,$15,($6::bigint::numeric/1000000)*$15::numeric) RETURNING *`,
   [id,userId,network,input.from,input.to,String(raw),kind,contact?.name || input.to,key,prepared.unsigned_wire,
    prepared.last_valid_block_height,memo,prepared.fee_payer,prepared.cost_lamports,rate])).rows[0];
 },pool);
}

export async function cancelUnsignedTransfer(userId,id,adapters={}) {
 const pool=adapters.db || getPaymentDb(),network=adapters.network || NETWORK.cluster;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${network}:${userId}`]);
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND user_id=$2 AND network=$3 FOR UPDATE',[id,userId,network])).rows[0];
  if(!t)throw new PaymentError('transfer_not_found',404);
  if(t.signature)throw new PaymentError('transfer_already_submitted',409);
  return (await db.query("UPDATE wallet_transfers SET status='canceled' WHERE id=$1 RETURNING *",[id])).rows[0];
 },pool);
}

export async function submitTransfer(userId,id,wire,adapters={}) {
 const pool=adapters.db || getPaymentDb(),rpc=adapters.rpc || transferRpc,network=adapters.network || NETWORK.cluster;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${network}:${userId}`]);
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND user_id=$2 AND network=$3 FOR UPDATE',[id,userId,network])).rows[0];
  if(!t)throw new PaymentError('transfer_not_found',404);
  // Recovery does not sign again, consume quota, or depend on the current signer.
  if(t.signature)return t;
  assertTransfersEnabled(userId);
  if(t.status!=='awaiting_signature')throw new PaymentError('transfer_not_signable',409);
  const primary=await (adapters.primary || resolvePrimaryWallet)(userId);
  if(primary.address!==t.from_address)throw new PaymentError('primary_wallet_required',403);
  const signedByUser=await (adapters.validate || validateUserSignature)(t,wire);
  if(BigInt(await rpc('getBlockHeight',[{commitment:'confirmed'}]))>BigInt(t.last_valid_block_height))throw new PaymentError('transfer_blockhash_expired',409);
  if((await transferQuota(db,userId,network)).remaining===0)throw new PaymentError('transfer_daily_limit',429);
  const raw=await (adapters.balance || sourceBalance)(t.from_address);
  const reserves=(await db.query(`SELECT COALESCE(sum(usdc_raw),0)::text AS raw FROM wallet_transfers
    WHERE user_id=$1 AND network=$2 AND signature IS NOT NULL AND status IN ('broadcasting','confirmed','manual_review')`,[userId,network])).rows[0];
  if(raw-BigInt(reserves.raw)<BigInt(t.usdc_raw))throw new PaymentError('insufficient_usdc',409);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-budget:${network}`]);
  const decisionTime=new Date(),day=transferDay(decisionTime).day,limits=transferLimits();
  if((await transferQuota(db,userId,network,decisionTime)).remaining===0)throw new PaymentError('transfer_daily_limit',429);
  const spent=(await db.query('SELECT COALESCE(sum(cost_lamports),0)::text AS cost FROM wallet_transfers WHERE network=$1 AND sponsor_day=$2 AND signature IS NOT NULL',[network,day])).rows[0];
  if(BigInt(t.cost_lamports)>limits.single || BigInt(spent.cost)+BigInt(t.cost_lamports)>limits.daily)throw new PaymentError('transfer_budget_exhausted',429);
  const pending=(await db.query(`SELECT COALESCE(sum(cost_lamports),0)::text AS cost FROM wallet_transfers WHERE network=$1 AND fee_payer=$2 AND signature IS NOT NULL AND status IN ('broadcasting','confirmed','manual_review')`,[network,t.fee_payer])).rows[0];
  const sol=await rpc('getBalance',[t.fee_payer,{commitment:'finalized'}]);
  if(BigInt(sol.value)-BigInt(pending.cost)<BigInt(t.cost_lamports))throw new PaymentError('transfer_sponsor_unavailable',503);
  // The user's signature was verified locally. Simulate without a treasury signature;
  // never expose a fully authorized wire to an RPC before its durable commit.
  const simulation=await rpc('simulateTransaction',[wire,{encoding:'base64',sigVerify:false,commitment:'confirmed'}]);
  if(simulation.value?.err)throw new PaymentError('transfer_simulation_failed',409);
  const signed=await (adapters.sign || signSponsoredTransfer)(t,signedByUser);
  return (await db.query(`UPDATE wallet_transfers SET signature=$2,signed_wire=$3,status='broadcasting',sponsor_day=$4,
    submitted_at=now(),next_attempt_at=now(),last_error=NULL WHERE id=$1 RETURNING *`,[id,signed.signature,signed.signed_wire,day])).rows[0];
 },pool);
}

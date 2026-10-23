import {randomUUID} from 'node:crypto';
import {NETWORK} from '../../../src/network.js';
import {NATIVE_PER_USDC_UNIT,TRANSFER_GAS_ESTIMATE,feeFields,isAddress,normalizeAddress,sameAddress,weiToUsdc} from '../../../src/arc.js';
import {getPaymentDb,transaction,paymentQuoteSettings} from './paymentRuntime.js';
import {PaymentError,decimalUnits,unitsDecimal} from './paymentCore.js';
import {resolvePrimaryWallet} from './primaryWallet.js';
import {transferRpc,sourceBalance,prepareTransfer,signingRequest,validateUserSignature} from './transferChain.js';
import {fetchArsQuote} from '../../../src/priceFeed.js';
import {assertTransfersEnabled} from './transferAccess.js';
import {ArcRpcRejected} from './arcRpc.js';

// The user pays the network fee in USDC from the same balance: an amount is
// sendable only if `amount + max gas` fits after in-flight transfers.
const IN_FLIGHT=`('broadcasting','manual_review')`;

export async function transferQuote(adapters={}) {
 const {rpc,maxAge}=paymentQuoteSettings(adapters.env || process.env);
 return (await (adapters.fetchQuote || fetchArsQuote)(rpc,maxAge)).rate;
}
export function publicTransfer(t,includeTransaction=false) {
 return {id:t.id,from:t.from_address,to:t.to_address,usdc:unitsDecimal(t.usdc_raw,6),kind:t.kind,
  recipient:t.recipient_name,network:t.network,status:t.status,txHash:t.tx_hash || null,
  createdAt:t.created_at,finalizedAt:t.finalized_at,lastError:t.last_error || null,
  fxRate:t.fx_rate,ars:t.ars,block:t.block,maxNetworkFeeUsdc:t.max_gas_wei==null?null:weiToUsdc(t.max_gas_wei),
  ...(includeTransaction && t.status==='awaiting_signature'?{transaction:signingRequest(t)}: {})};
}
/** Wei committed by the user's in-flight transfers (amount + max gas each). */
async function inFlightWei(db,userId,network) {
 const {rows:[row]}=await db.query(`SELECT COALESCE(sum(usdc_raw::numeric*${NATIVE_PER_USDC_UNIT}+max_gas_wei),0)::text AS wei
  FROM wallet_transfers WHERE user_id=$1 AND network=$2 AND tx_hash IS NOT NULL AND status IN ${IN_FLIGHT}`,[userId,network]);
 return BigInt(row.wei.split('.')[0]);
}
async function assertSendable(db,t,adapters,network) {
 const balance=await (adapters.balance || sourceBalance)(t.from_address);
 const required=BigInt(t.usdc_raw)*NATIVE_PER_USDC_UNIT+BigInt(t.max_gas_wei)+await inFlightWei(db,t.user_id,network);
 if(balance<required)throw new PaymentError('insufficient_usdc',409);
}
/** The prepared nonce was taken by another transaction from the same account. */
async function nonceTaken(t,rpc,tag='pending') {
 return BigInt(await rpc('eth_getTransactionCount',[t.from_address,tag]))>BigInt(t.nonce);
}
async function recoverPreparation(t,adapters,pool) {
 if(t.tx_hash || t.status!=='awaiting_signature')return t;
 const rpc=adapters.rpc || transferRpc;
 if(!await nonceTaken(t,rpc))return t;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${t.network}:${t.user_id}`]);
  const current=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 FOR UPDATE',[t.id])).rows[0];
  if(current.tx_hash || current.status!=='awaiting_signature')return current;
  const prepared=await (adapters.prepare || prepareTransfer)({from:t.from_address,to:t.to_address,raw:t.usdc_raw,memo:t.memo,reference:`transfer_${t.id}`});
  return (await db.query(`UPDATE wallet_transfers SET unsigned_tx=$2,nonce=$3,max_gas_wei=$4 WHERE id=$1 RETURNING *`,
   [t.id,prepared.unsigned_tx,prepared.nonce,prepared.max_gas_wei])).rows[0];
 },pool);
}
export async function createTransfer(userId,input,key,adapters={}) {
 assertTransfersEnabled(userId);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key || ''))throw new PaymentError('invalid_idempotency_key',400);
 if(!input || typeof input.amount!=='string' || !isAddress(input.to || '') || !isAddress(input.from || ''))throw new PaymentError('invalid_transfer',400);
 const from=normalizeAddress(input.from),to=normalizeAddress(input.to);
 const raw=decimalUnits(input.amount,6);
 if(raw<=0n || raw>9223372036854775807n || sameAddress(to,from))throw new PaymentError('invalid_transfer_amount',400);
 const kind=input.kind || 'pay';if(!['pay','voice','charge_p2p'].includes(kind))throw new PaymentError('invalid_transfer_kind',400);
 const network=adapters.network || NETWORK.network,pool=adapters.db || getPaymentDb();
 const existing=await pool.query('SELECT * FROM wallet_transfers WHERE user_id=$1 AND network=$2 AND idempotency_key=$3',[userId,network,key]);
 if(existing.rows[0]) {
  const t=existing.rows[0];
  if(t.from_address!==from || t.to_address!==to || BigInt(t.usdc_raw)!==raw || t.kind!==kind)throw new PaymentError('idempotency_conflict',409);
  return recoverPreparation(t,adapters,pool);
 }
 const primary=await (adapters.primary || resolvePrimaryWallet)(userId);
 if(!sameAddress(primary.address,from))throw new PaymentError('primary_wallet_required',403);
 const id=randomUUID(),memo=`MIDATO|v1|inv:transfer_${id}|kind:${kind}|usdc:${unitsDecimal(raw,6)}`;
 const prepared=await (adapters.prepare || prepareTransfer)({from,to,raw:String(raw),memo,reference:`transfer_${id}`});
 await assertSendable(pool,{from_address:from,usdc_raw:raw,max_gas_wei:prepared.max_gas_wei,user_id:userId},adapters,network);
 const contact=(await pool.query('SELECT name FROM contacts WHERE user_id=$1 AND lower(address)=lower($2) ORDER BY created_at LIMIT 1',[userId,to])).rows[0];
 const rate=await (adapters.quote || transferQuote)();
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-create:${network}:${userId}:${key}`]);
  const duplicate=(await db.query('SELECT * FROM wallet_transfers WHERE user_id=$1 AND network=$2 AND idempotency_key=$3',[userId,network,key])).rows[0];
  if(duplicate) {
   if(duplicate.from_address!==from || duplicate.to_address!==to || BigInt(duplicate.usdc_raw)!==raw || duplicate.kind!==kind)throw new PaymentError('idempotency_conflict',409);
   return duplicate;
  }
  return (await db.query(`INSERT INTO wallet_transfers(id,user_id,network,from_address,to_address,usdc_raw,kind,recipient_name,
   idempotency_key,unsigned_tx,nonce,memo,max_gas_wei,fx_rate,ars)
   VALUES($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,$11,$12,$13,$14,($6::bigint::numeric/1000000)*$14::numeric) RETURNING *`,
   [id,userId,network,from,to,String(raw),kind,contact?.name || to,key,prepared.unsigned_tx,
    prepared.nonce,memo,prepared.max_gas_wei,rate])).rows[0];
 },pool);
}

export async function cancelUnsignedTransfer(userId,id,adapters={}) {
 const pool=adapters.db || getPaymentDb(),network=adapters.network || NETWORK.network;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${network}:${userId}`]);
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND user_id=$2 AND network=$3 FOR UPDATE',[id,userId,network])).rows[0];
  if(!t)throw new PaymentError('transfer_not_found',404);
  if(t.tx_hash)throw new PaymentError('transfer_already_submitted',409);
  return (await db.query("UPDATE wallet_transfers SET status='canceled' WHERE id=$1 RETURNING *",[id])).rows[0];
 },pool);
}

export async function submitTransfer(userId,id,signedTx,adapters={}) {
 const pool=adapters.db || getPaymentDb(),rpc=adapters.rpc || transferRpc,network=adapters.network || NETWORK.network;
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${network}:${userId}`]);
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND user_id=$2 AND network=$3 FOR UPDATE',[id,userId,network])).rows[0];
  if(!t)throw new PaymentError('transfer_not_found',404);
  // Recovery never signs again and does not depend on the current wallet state.
  if(t.tx_hash)return t;
  assertTransfersEnabled(userId);
  if(t.status!=='awaiting_signature')throw new PaymentError('transfer_not_signable',409);
  const primary=await (adapters.primary || resolvePrimaryWallet)(userId);
  if(!sameAddress(primary.address,t.from_address))throw new PaymentError('primary_wallet_required',403);
  const signed=(adapters.validate || validateUserSignature)(t,signedTx);
  if(await nonceTaken(t,rpc))throw new PaymentError('transfer_nonce_expired',409);
  await assertSendable(db,t,adapters,network);
  // Simulate the exact call (covers USDC blocklist and balance) before the durable commit.
  try {await rpc('eth_call',[signed.request,'latest']);}
  catch(error){if(error instanceof ArcRpcRejected)throw new PaymentError('transfer_simulation_failed',409);throw error;}
  return (await db.query(`UPDATE wallet_transfers SET tx_hash=$2,signed_tx=$3,status='broadcasting',
    submitted_at=now(),next_attempt_at=now(),last_error=NULL WHERE id=$1 RETURNING *`,[id,signed.hash,signed.signed_tx])).rows[0];
 },pool);
}

/** Network fee estimate (USDC) shown before the user approves a transfer. */
export async function networkFeeEstimate(adapters={}) {
 const rpc=adapters.rpc || transferRpc;
 const gasPrice=BigInt(await rpc('eth_gasPrice',[]));
 return weiToUsdc(TRANSFER_GAS_ESTIMATE*feeFields({gasPrice}).maxFeePerGas);
}

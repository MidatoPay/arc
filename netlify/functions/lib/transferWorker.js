import {NETWORK} from '../../../src/network.js';
import {getPaymentDb} from './paymentRuntime.js';
import {transferRpc,tokenAddress} from './transferChain.js';
import {unitsDecimal} from './paymentCore.js';

export async function processTransfer(id,adapters={}) {
 const pool=adapters.db || getPaymentDb(),rpc=adapters.rpc || transferRpc,db=await pool.connect();
 const network=adapters.network || NETWORK;
 let locked=false;
 try {
  locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`transfer:${id}`])).rows[0].locked;
  if(!locked)return;
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND network=$2',[id,network.cluster])).rows[0];
  if(!t?.signature || !['broadcasting','confirmed','manual_review'].includes(t.status))return t;
  if(await rpc('getGenesisHash',[])!==network.genesis)throw new Error('solana_rpc_network_mismatch');
  const status=(await rpc('getSignatureStatuses',[[t.signature],{searchTransactionHistory:true}])).value?.[0];
  if(status?.err && status.confirmationStatus==='finalized') {
   await db.query("UPDATE wallet_transfers SET status='failed',last_error='transfer_onchain_failed' WHERE id=$1",[id]);
  } else if(status?.err) {
   await db.query("UPDATE wallet_transfers SET status='confirmed',last_error='transfer_waiting_finality',next_attempt_at=now()+interval '3 seconds' WHERE id=$1",[id]);
  } else if(status?.confirmationStatus==='finalized') {
   const tx=await rpc('getTransaction',[t.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:1}]);
   if(!tx || tx.meta?.err)throw new Error('transfer_finalization_unavailable');
   const destination=await tokenAddress(t.to_address,network),source=await tokenAddress(t.from_address,network);
   const matching=tx.transaction?.message?.instructions?.filter(ix=>ix.programId==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ix.parsed?.type==='transferChecked');
   const info=matching?.[0]?.parsed.info;
   if(matching?.length!==1 || info?.source!==source || info?.destination!==destination || info?.authority!==t.from_address ||
      info?.mint!==network.mint || info?.tokenAmount?.decimals!==6 || String(info?.tokenAmount?.amount)!==String(t.usdc_raw)) {
    await db.query("UPDATE wallet_transfers SET status='manual_review',last_error='transfer_chain_mismatch' WHERE id=$1",[id]);
    return;
   }
   await db.query('BEGIN');
   try {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${t.network}:${t.user_id}`]);
    await db.query(`INSERT INTO transactions(user_id,network,hash,kind,direction,who,amt,fx_rate,ars,factura,block,fee,memo,transfer_id)
      VALUES($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,0,$11,$12)
      ON CONFLICT(user_id,network,hash) DO UPDATE SET transfer_id=EXCLUDED.transfer_id,kind=EXCLUDED.kind,
       direction='out',who=EXCLUDED.who,amt=EXCLUDED.amt,fx_rate=EXCLUDED.fx_rate,ars=EXCLUDED.ars,
       factura=EXCLUDED.factura,block=EXCLUDED.block,fee=0,memo=EXCLUDED.memo`,
     [t.user_id,t.network,t.signature,t.kind,t.recipient_name,unitsDecimal(t.usdc_raw,6),t.fx_rate,t.ars,`transfer_${t.id}`,String(status.slot),t.memo,t.id]);
    await db.query("UPDATE wallet_transfers SET status='completed',block=$2,finalized_at=now(),last_error=NULL WHERE id=$1",[id,String(status.slot)]);
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}
  } else if(status?.confirmationStatus==='confirmed') {
   await db.query("UPDATE wallet_transfers SET status='confirmed',last_error=NULL,next_attempt_at=now()+interval '3 seconds' WHERE id=$1",[id]);
  } else {
   const height=await rpc('getBlockHeight',[{commitment:'finalized'}]);
   if(BigInt(height)>BigInt(t.last_valid_block_height) && !status) {
    // One RPC's absence cannot authorize replacement or release ambiguous funds.
    await db.query("UPDATE wallet_transfers SET status='manual_review',last_error='transfer_expired_requires_review',next_attempt_at=now()+interval '1 minute' WHERE id=$1",[id]);
   } else {
    if(process.env.TRANSFERS_ENABLED==='true' && t.status!=='manual_review' && t.signed_wire)
     await rpc('sendTransaction',[t.signed_wire,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed'}]);
    await db.query("UPDATE wallet_transfers SET next_attempt_at=now()+interval '3 seconds' WHERE id=$1",[id]);
   }
  }
  return (await db.query('SELECT * FROM wallet_transfers WHERE id=$1',[id])).rows[0];
 }catch(error) {
  if(locked)await db.query("UPDATE wallet_transfers SET last_error='transfer_tracking_unavailable',next_attempt_at=now()+interval '15 seconds' WHERE id=$1 AND status IN ('broadcasting','confirmed','manual_review')",[id]);
  // Never return RPC internals, signed transactions or signer information in logs.
  return null;
 }finally {
  let discard=false;
  try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`transfer:${id}`]);}catch{discard=true;}
  db.release(discard);
 }
}
export async function runTransferWorker({budgetMs=50000,...adapters}={}) {
 const pool=adapters.db || getPaymentDb(),deadline=Date.now()+budgetMs;
 const ids=(await pool.query(`SELECT id FROM wallet_transfers WHERE network=$1 AND signature IS NOT NULL
  AND status IN ('broadcasting','confirmed','manual_review') AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 25`,[NETWORK.cluster])).rows;
 let checked=0;
 for(const {id} of ids){if(Date.now()>=deadline)break;await processTransfer(id,adapters);checked++;}
 return {checked};
}

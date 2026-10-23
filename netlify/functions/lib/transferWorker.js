import {NETWORK} from '../../../src/network.js';
import {sameAddress,usdcTransfers,weiToUsdc} from '../../../src/arc.js';
import {getPaymentDb} from './paymentRuntime.js';
import {transferRpc} from './transferChain.js';
import {unitsDecimal} from './paymentCore.js';
import {transfersEnabledFor} from './transferAccess.js';
import {alreadySubmitted,assertArcNetwork} from './arcRpc.js';

export async function processTransfer(id,adapters={}) {
 const pool=adapters.db || getPaymentDb(),rpc=adapters.rpc || transferRpc,db=await pool.connect();
 const network=adapters.network || NETWORK;
 let locked=false;
 try {
  locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`transfer:${id}`])).rows[0].locked;
  if(!locked)return;
  const t=(await db.query('SELECT * FROM wallet_transfers WHERE id=$1 AND network=$2',[id,network.network])).rows[0];
  if(!t?.tx_hash || !['broadcasting','manual_review'].includes(t.status))return t;
  await assertArcNetwork(rpc,network);
  const receipt=await rpc('eth_getTransactionReceipt',[t.tx_hash]);
  if(receipt && receipt.status!=='0x1') {
   // Final but reverted (e.g. USDC blocklist): no USDC moved.
   await db.query("UPDATE wallet_transfers SET status='failed',last_error='transfer_onchain_failed' WHERE id=$1",[id]);
  } else if(receipt) {
   // Arc finality is deterministic: a successful receipt is final. Verify what actually moved.
   const moved=usdcTransfers(receipt.logs,network);
   const ok=moved.length===1 && sameAddress(moved[0].from,t.from_address) && sameAddress(moved[0].to,t.to_address) &&
     moved[0].value===BigInt(t.usdc_raw);
   if(!ok) {
    await db.query("UPDATE wallet_transfers SET status='manual_review',last_error='transfer_chain_mismatch' WHERE id=$1",[id]);
    return;
   }
   const block=String(BigInt(receipt.blockNumber));
   const fee=weiToUsdc(BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice));
   await db.query('BEGIN');
   try {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`transfer-user:${t.network}:${t.user_id}`]);
    await db.query(`INSERT INTO transactions(user_id,network,hash,kind,direction,who,amt,fx_rate,ars,factura,block,fee,memo,transfer_id)
      VALUES($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(user_id,network,hash) DO UPDATE SET transfer_id=EXCLUDED.transfer_id,kind=EXCLUDED.kind,
       direction='out',who=EXCLUDED.who,amt=EXCLUDED.amt,fx_rate=EXCLUDED.fx_rate,ars=EXCLUDED.ars,
       factura=EXCLUDED.factura,block=EXCLUDED.block,fee=EXCLUDED.fee,memo=EXCLUDED.memo`,
     [t.user_id,t.network,t.tx_hash,t.kind,t.recipient_name,unitsDecimal(t.usdc_raw,6),t.fx_rate,t.ars,`transfer_${t.id}`,block,fee,t.memo,t.id]);
    await db.query("UPDATE wallet_transfers SET status='completed',block=$2,finalized_at=now(),last_error=NULL WHERE id=$1",[id,block]);
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}
  } else if(BigInt(await rpc('eth_getTransactionCount',[t.from_address,'latest']))>BigInt(t.nonce)) {
   // Another transaction used this nonce, so this one can never land. Never release ambiguous funds automatically.
   await db.query("UPDATE wallet_transfers SET status='manual_review',last_error='transfer_not_landed_requires_review',next_attempt_at=now()+interval '1 minute' WHERE id=$1",[id]);
  } else {
   if(transfersEnabledFor(t.user_id) && t.status!=='manual_review' && t.signed_tx) {
    try {await rpc('eth_sendRawTransaction',[t.signed_tx]);}
    catch(error){if(!alreadySubmitted(error))throw error;}
   }
   await db.query("UPDATE wallet_transfers SET next_attempt_at=now()+interval '3 seconds' WHERE id=$1",[id]);
  }
  return (await db.query('SELECT * FROM wallet_transfers WHERE id=$1',[id])).rows[0];
 }catch(error) {
  if(locked)await db.query("UPDATE wallet_transfers SET last_error='transfer_tracking_unavailable',next_attempt_at=now()+interval '15 seconds' WHERE id=$1 AND status IN ('broadcasting','manual_review')",[id]);
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
 const ids=(await pool.query(`SELECT id FROM wallet_transfers WHERE network=$1 AND tx_hash IS NOT NULL
  AND status IN ('broadcasting','manual_review') AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 25`,[NETWORK.network])).rows;
 let checked=0;
 for(const {id} of ids){if(Date.now()>=deadline)break;await processTransfer(id,adapters);checked++;}
 return {checked};
}

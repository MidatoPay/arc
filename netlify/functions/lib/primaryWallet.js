import { primarySolanaWallet } from '../../../src/primaryWallet.js';
import { NETWORK } from '../../../src/network.js';
import { getPaymentDb,getPaymentPrivy,transaction } from './paymentRuntime.js';
import { PaymentError } from './paymentCore.js';

export async function resolvePrimaryWallet(userId,adapters={}) {
  const user=await (adapters.getUser || (id=>getPaymentPrivy().getUser(id)))(userId);
  const primary=primarySolanaWallet(user);
  if(!primary || !primary.id)throw new PaymentError('primary_wallet_unavailable',409);
  return primary;
}

export async function syncPrimaryWallet(userId,adapters={}) {
  const primary=await resolvePrimaryWallet(userId,adapters),network=adapters.network || NETWORK.cluster;
  await transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`primary-wallet:${network}:${userId}`]);
    const previous=(await db.query('SELECT address FROM wallets WHERE user_id=$1 AND network=$2 FOR UPDATE',[userId,network])).rows[0];
    if(previous && previous.address!==primary.address)
      await db.query('INSERT INTO wallet_identity_audit(user_id,network,previous_address,primary_address) VALUES($1,$2,$3,$4)',[userId,network,previous.address,primary.address]);
    await db.query(`INSERT INTO wallets(user_id,network,address,privy_wallet_id,hd_wallet_index,updated_at)
      VALUES($1,$2,$3,$4,0,now()) ON CONFLICT(user_id,network) DO UPDATE SET
      address=EXCLUDED.address,privy_wallet_id=EXCLUDED.privy_wallet_id,hd_wallet_index=0,
      last_synced_block=CASE WHEN wallets.address=EXCLUDED.address THEN wallets.last_synced_block ELSE NULL END,updated_at=now()`,
      [userId,network,primary.address,primary.id]);
  },adapters.db || getPaymentDb());
  return {address:primary.address,id:primary.id,hdWalletIndex:0,network};
}

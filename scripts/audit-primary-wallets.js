// Read-only by default. --sync records verified mapping changes, never moves funds or creates wallets.
import {getPaymentDb,getPaymentPrivy} from '../netlify/functions/lib/paymentRuntime.js';
import {primaryArcWallet} from '../src/primaryWallet.js';
import {sameAddress} from '../src/arc.js';
import {syncPrimaryWallet} from '../netlify/functions/lib/primaryWallet.js';
const db=getPaymentDb(),apply=process.argv.includes('--sync');
try {
 const users=(await db.query('SELECT DISTINCT user_id FROM wallets UNION SELECT DISTINCT user_id FROM charges')).rows;
 for(const {user_id:userId} of users) {
  const user=await getPaymentPrivy().getUser(userId),primary=primaryArcWallet(user);
  const accounts=user.linkedAccounts.filter(a=>a.type==='wallet' && a.chainType==='ethereum' && ['privy','privy-v2'].includes(a.walletClientType));
  const mappings=(await db.query('SELECT network,address FROM wallets WHERE user_id=$1',[userId])).rows;
  if(apply && primary)await syncPrimaryWallet(userId,{getUser:async()=>user});
  console.log(JSON.stringify({userId,primary:primary?.address || null,
   wallets:accounts.map(a=>({id:a.id,address:a.address,index:a.hdWalletIndex,firstVerifiedAt:a.firstVerifiedAt})),
   mismatches:mappings.filter(row=>!sameAddress(row.address,primary?.address)),synchronized:apply && Boolean(primary)}));
 }
}catch(error){console.error(JSON.stringify({error:error.code || 'wallet_audit_failed'}));process.exitCode=1;}
finally{await db.end();}

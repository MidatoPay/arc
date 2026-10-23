import { NETWORK } from '../../src/network.js';
import { rawToUsdc, weiToUsdcRaw } from '../../src/arc.js';
import { authenticatePayment,getPaymentDb,json,errorResponse } from './lib/paymentRuntime.js';
import { createReadCache } from './lib/readCache.js';
import { PaymentError } from './lib/paymentCore.js';
import { asFetchHandler } from './lib/fetchAdapter.js';
import { assertArcNetwork,createArcRpc } from './lib/arcRpc.js';

const rpc=createArcRpc();
async function walletFor(userId) {
  return (await getPaymentDb().query('SELECT address FROM wallets WHERE user_id=$1 AND network=$2',[userId,NETWORK.network])).rows[0]?.address;
}
/** USDC the wallet can move through the ERC-20 interface (6 decimals, truncated). */
async function chainBalance(owner) {
  await assertArcNetwork(rpc);
  return rawToUsdc(weiToUsdcRaw(BigInt(await rpc('eth_getBalance',[owner,'latest']))));
}
export function createBalanceHandler({authenticate=authenticatePayment,wallet=walletFor,balance=chainBalance,read=createReadCache(),now=Date.now}={}) {
  return async event=>{
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'};
    try {
      const userId=await authenticate(event);
      if(event.httpMethod!=='GET')throw new PaymentError('method_not_allowed',405);
      const owner=await wallet(userId);
      if(!owner)throw new PaymentError('primary_wallet_unavailable',409);
      const value=await read(`balance:${NETWORK.network}:${owner}`,10000,async()=>({
        address:owner,network:NETWORK.network,usdc:await balance(owner),updatedAt:now(),
      }),{fresh:event.queryStringParameters?.refresh==='1'});
      return {...json(200,value),headers};
    }catch(error){return {...errorResponse(error),headers};}
  };
}
export default asFetchHandler(createBalanceHandler());
export const config={path:'/balance',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};

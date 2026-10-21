import { address,createSolanaRpc } from '@solana/kit';
import { findAssociatedTokenPda,fetchMaybeToken,TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { NETWORK } from '../../src/network.js';
import { authenticatePayment,getPaymentDb,json,errorResponse } from './lib/paymentRuntime.js';
import { createReadCache } from './lib/readCache.js';
import { PaymentError } from './lib/paymentCore.js';
import { asFetchHandler } from './lib/fetchAdapter.js';

async function walletFor(userId) {
  return (await getPaymentDb().query('SELECT address FROM wallets WHERE user_id=$1 AND network=$2',[userId,NETWORK.cluster])).rows[0]?.address;
}
async function chainBalance(owner) {
  const rpc=createSolanaRpc(process.env.SOLANA_RPC || process.env.VITE_SOLANA_RPC || NETWORK.rpc);
  const [ata]=await findAssociatedTokenPda({owner:address(owner),mint:address(NETWORK.mint),tokenProgram:TOKEN_PROGRAM_ADDRESS});
  const token=await fetchMaybeToken(rpc,ata,{commitment:'finalized',abortSignal:AbortSignal.timeout(10000)});
  return token.exists ? Number(token.data.amount)/1e6 : 0;
}
export function createBalanceHandler({authenticate=authenticatePayment,wallet=walletFor,balance=chainBalance,read=createReadCache(),now=Date.now}={}) {
  return async event=>{
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'};
    try {
      const userId=await authenticate(event);
      if(event.httpMethod!=='GET')throw new PaymentError('method_not_allowed',405);
      const owner=await wallet(userId);
      if(!owner)throw new PaymentError('primary_wallet_unavailable',409);
      const value=await read(`balance:${NETWORK.cluster}:${owner}`,10000,async()=>({
        address:owner,network:NETWORK.cluster,usdc:await balance(owner),updatedAt:now(),
      }),{fresh:event.queryStringParameters?.refresh==='1'});
      return {...json(200,value),headers};
    }catch(error){return {...errorResponse(error),headers};}
  };
}
export default asFetchHandler(createBalanceHandler());
export const config={path:'/balance',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};

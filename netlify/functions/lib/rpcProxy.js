import { authenticatePayment,errorResponse } from './paymentRuntime.js';
import { PaymentError } from './paymentCore.js';
import { CHAINLINK_USD_ARS_FEED } from '../../../src/chainlinkConfig.js';
import { NETWORK } from '../../../src/network.js';

// Browser reads on Arc. Writes (eth_sendRawTransaction) go through /transfers,
// never through this proxy. eth_getLogs is bounded to avoid expensive scans.
const arcMethods=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_call','eth_estimateGas','eth_gasPrice',
  'eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getTransactionCount',
  'eth_getCode','eth_getBlockByNumber']);
const feedCalls=new Set(['0x50d25bcd','0x313ce567','0x7284e416','0xfeaf968c']);
const callTargets=new Set([NETWORK.usdc.toLowerCase(),NETWORK.memo.toLowerCase()]);
export function createRpcHandler({target,chain,authenticate=authenticatePayment,request=fetch,now=Date.now}={}) {
  const limits=new Map();
  const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'};
  const response=(statusCode,body,extra={})=>({statusCode,headers:{...headers,...extra},body:JSON.stringify(body)});
  return async event=>{
    try {
      const userId=await authenticate(event);
      if(event.httpMethod!=='POST')throw new PaymentError('method_not_allowed',405);
      if(event.isBase64Encoded || typeof event.body!=='string' || Buffer.byteLength(event.body)>65536)throw new PaymentError('rpc_payload_too_large',413);
      let payload;
      try {payload=JSON.parse(event.body);}catch{throw new PaymentError('invalid_json',400);}
      const calls=Array.isArray(payload)?payload:[payload];
      if(!calls.length || calls.length>10)throw new PaymentError('rpc_batch_limit',400);
      for(const call of calls) {
        if(!call || call.jsonrpc!=='2.0' || !['string','number'].includes(typeof call.id) || !Array.isArray(call.params || []))throw new PaymentError('rpc_invalid_request',400);
        if(chain==='arc') {
          if(!arcMethods.has(call.method))throw new PaymentError('rpc_method_not_allowed',403);
          if(call.method==='eth_call' && !callTargets.has(String(call.params?.[0]?.to || '').toLowerCase()))throw new PaymentError('rpc_method_not_allowed',403);
          if(call.method==='eth_getBlockByNumber' && call.params?.[1]!==false)throw new PaymentError('rpc_method_not_allowed',403);
          if(call.method==='eth_feeHistory' && Number(call.params?.[0])>100)throw new PaymentError('rpc_batch_limit',400);
        } else if(call.method!=='eth_chainId') {
          const tx=call.params?.[0];
          if(call.method!=='eth_call' || tx?.to?.toLowerCase()!==CHAINLINK_USD_ARS_FEED.toLowerCase() || !feedCalls.has(tx?.data?.toLowerCase()) || call.params?.[1]!=='latest')throw new PaymentError('rpc_method_not_allowed',403);
        }
      }
      const bucket=Math.floor(now()/60000),previous=limits.get(userId);
      const entry=previous?.bucket===bucket?previous:{bucket,count:0};
      entry.count+=calls.length;
      limits.delete(userId);limits.set(userId,entry);
      if(limits.size>2048)limits.delete(limits.keys().next().value);
      if(entry.count>120)return response(429,{error:'rpc_rate_limited'},{'Retry-After':String(60-Math.floor(now()/1000)%60)});
      const upstream=await request(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
      const body=await upstream.json();
      return response(upstream.status,body);
    }catch(error) {
      if(error instanceof PaymentError)return {...errorResponse(error),headers};
      return response(502,{error:'rpc_unavailable'});
    }
  };
}

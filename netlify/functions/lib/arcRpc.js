// Server-side JSON-RPC client for Arc. RPC internals never reach API responses.
import { NETWORK } from '../../../src/network.js';
import { PaymentError } from './paymentCore.js';

export function arcRpcUrl(env=process.env,network=NETWORK) {
  return env.ARC_RPC?.trim() || env.VITE_ARC_RPC?.trim() || network.rpc;
}

/** JSON-RPC error returned by the node (revert, nonce, underpriced, ...). */
export class ArcRpcRejected extends PaymentError {
  constructor(code,rpcError) {
    super(code,502);
    this.rpcCode=rpcError?.code;
    this.rpcMessage=String(rpcError?.message || '');
  }
}

/**
 * @param {{url?:string,unavailable?:string,timeout?:string,rejected?:string,request?:typeof fetch}} options
 */
export function createArcRpc({url,unavailable='arc_rpc_unavailable',timeout='arc_rpc_timeout',rejected='arc_rpc_rejected',request=(...args)=>fetch(...args)}={}) {
  let id=0;
  return async(method,params=[])=>{
    let body;
    try {
      const response=await request(url || arcRpcUrl(),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(10000)});
      body=await response.json();
      if(!response.ok && !body?.error)throw new PaymentError(unavailable);
    }catch(error) {
      if(error instanceof PaymentError)throw error;
      throw new PaymentError(['TimeoutError','AbortError'].includes(error?.name)?timeout:unavailable);
    }
    if(body?.error)throw new ArcRpcRejected(rejected,body.error);
    if(!Object.hasOwn(body || {},'result'))throw new PaymentError(unavailable);
    return body.result;
  };
}

/** Wrong-network protection: the RPC must serve the configured chain. */
export async function assertArcNetwork(rpc,network=NETWORK) {
  const chainId=await rpc('eth_chainId',[]);
  if(BigInt(chainId)!==BigInt(network.chainId))throw new PaymentError('arc_rpc_network_mismatch');
}

/** A node reporting the tx as already known (or already mined) is not a failure. */
export function alreadySubmitted(error) {
  const message=String(error?.rpcMessage || '').toLowerCase();
  return message.includes('already known') || message.includes('known transaction') ||
    message.includes('already imported') || message.includes('nonce too low');
}

export const hex=value=>`0x${BigInt(value).toString(16)}`;

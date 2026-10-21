import { NETWORK } from '../../src/network.js';
import { createRpcHandler } from './lib/rpcProxy.js';
import { asFetchHandler } from './lib/fetchAdapter.js';
export default asFetchHandler(createRpcHandler({chain:'solana',target:process.env.SOLANA_RPC || process.env.VITE_SOLANA_RPC || NETWORK.rpc}));
export const config={path:'/rpc',rateLimit:{windowLimit:300,windowSize:60,aggregateBy:['ip','domain']}};

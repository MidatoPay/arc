import { createRpcHandler } from './lib/rpcProxy.js';
import { asFetchHandler } from './lib/fetchAdapter.js';
export default asFetchHandler(createRpcHandler({chain:'ethereum',target:process.env.ETH_RPC_URL || process.env.VITE_ETH_RPC || 'https://ethereum.publicnode.com'}));
export const config={path:'/eth-rpc',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};

import { createRpcHandler } from './lib/rpcProxy.js';
import { arcRpcUrl } from './lib/arcRpc.js';
import { asFetchHandler } from './lib/fetchAdapter.js';
export default asFetchHandler(createRpcHandler({chain:'arc',target:arcRpcUrl()}));
export const config={path:'/rpc',rateLimit:{windowLimit:300,windowSize:60,aggregateBy:['ip','domain']}};

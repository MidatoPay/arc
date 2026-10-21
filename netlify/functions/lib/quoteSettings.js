import { PaymentError } from './paymentCore.js';
// Pure configuration shared by the public read model and strict charge path.
export function paymentQuoteSettings(env=process.env) {
  const rpc=env.ETH_RPC_URL?.trim();
  if (!rpc) throw new PaymentError('missing_eth_rpc_url');
  try {if(!['http:','https:'].includes(new URL(rpc).protocol))throw new Error();}
  catch {throw new PaymentError('invalid_eth_rpc_url');}
  const age=env.CHAINLINK_MAX_AGE_SECONDS?.trim();
  if (!age) throw new PaymentError('missing_chainlink_max_age_seconds');
  const maxAge=Number(age);
  if (!/^\d+$/.test(age) || !Number.isSafeInteger(maxAge) || maxAge<=0) throw new PaymentError('invalid_chainlink_max_age_seconds');
  return {rpc,maxAge};
}

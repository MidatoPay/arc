import { FALLBACK_FX_ARS_USD } from "./chainlinkConfig.js";

export { FALLBACK_FX_ARS_USD };

export function createDisplayQuoteClient({request=(...args)=>fetch(...args),now=Date.now}={}) {
  let cached,pending;
  return async ()=>{
    if(cached?.until>now())return cached.rate;
    if(pending)return pending;
    pending=(async()=>{
      try {
        const response=await request('/quote',{signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('quote_unavailable');
        const body=await response.json(),rate=Number(body.rate);
        if(body.displayOnly!==true || !Number.isFinite(rate) || rate<=0)throw new Error('invalid_quote');
        cached={rate,until:now()+60000};
        return rate;
      }catch{
        // Display only. Charge creation always validates the feed server-side.
        cached={rate:FALLBACK_FX_ARS_USD,until:now()+10000};
        return FALLBACK_FX_ARS_USD;
      }
    })();
    try{return await pending;}finally{pending=null;}
  };
}
/** Shared display quote; browsers never query Ethereum directly. */
export const getArsPerUsdc=createDisplayQuoteClient();

/** ARS → USDC usando cotización (ARS por 1 USDC). */
export function arsToUsdc(arsAmount, arsPerUsdc) {
  const rate = Number(arsPerUsdc);
  const ars = Number(arsAmount);
  if (!Number.isFinite(ars) || ars <= 0) throw new Error("Monto ARS inválido");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Cotización inválida");
  return ars / rate;
}

/** USDC → ARS usando cotización (ARS por 1 USDC). */
export function usdcToArs(usdcAmount, arsPerUsdc) {
  const rate = Number(arsPerUsdc);
  const usdc = Number(usdcAmount);
  if (!Number.isFinite(usdc) || usdc <= 0) throw new Error("Monto USDC inválido");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Cotización inválida");
  return usdc * rate;
}

export function quoteArsToUsdc(arsAmount, arsPerUsdc) {
  const usdc = arsToUsdc(arsAmount, arsPerUsdc);
  return { ars: Number(arsAmount), usdc, fxRate: Number(arsPerUsdc) };
}

export function quoteUsdcToArs(usdcAmount, arsPerUsdc) {
  const ars = usdcToArs(usdcAmount, arsPerUsdc);
  return { usdc: Number(usdcAmount), ars, fxRate: Number(arsPerUsdc) };
}

import { fetchArsQuote } from '../../src/priceFeed.js';
import { paymentQuoteSettings } from './lib/quoteSettings.js';
import { createReadCache } from './lib/readCache.js';
import { asFetchHandler } from './lib/fetchAdapter.js';

export function createQuoteHandler({read=createReadCache(),quote=fetchArsQuote,settings=paymentQuoteSettings,now=Date.now}={}) {
  return async event=>{
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(event.httpMethod!=='GET')return {statusCode:405,headers,body:JSON.stringify({error:'method_not_allowed'})};
    try {
      const {rpc,maxAge}=settings();
      const value=await read(`quote:ethereum:usd-ars:${maxAge}`,60000,async()=>({
        ...await quote(rpc,maxAge),fetchedAt:now(),source:'chainlink',displayOnly:true,
      }));
      // Do not serve a cached round past its validity boundary at the CDN.
      const ttl=Math.min(Math.floor(60-(now()-value.fetchedAt)/1000),Math.floor(value.updatedAt+maxAge-now()/1000));
      if(ttl<=0)throw new Error('quote_stale');
      return {statusCode:200,headers:{...headers,
        'Netlify-CDN-Cache-Control':`public, s-maxage=${ttl}, durable`,
        'Netlify-Cache-Tag':'display-usd-ars-v1',
      },body:JSON.stringify(value)};
    }catch{return {statusCode:503,headers,body:JSON.stringify({error:'quote_unavailable'})};}
  };
}
export default asFetchHandler(createQuoteHandler());
export const config={path:'/quote',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};

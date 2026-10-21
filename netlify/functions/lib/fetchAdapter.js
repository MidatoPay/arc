// Reuse the tested event handlers with Netlify's Request/Response runtime.
// This runtime enables native routing, rate limits and the platform Cache API.
export function asFetchHandler(handle) {
  return async request=>{
    const url=new URL(request.url);
    const event={httpMethod:request.method,headers:Object.fromEntries(request.headers),path:url.pathname,
      queryStringParameters:Object.fromEntries(url.searchParams),
      body:['GET','HEAD'].includes(request.method)?null:await request.text(),isBase64Encoded:false};
    const result=await handle(event);
    return new Response(result.body,{status:result.statusCode,headers:result.headers});
  };
}

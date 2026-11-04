import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.mjs';
import { queryCatalog } from './query-catalog.js';
test('local proxy protects credentials and only calls allowed staging routes',async()=>{
 const calls=[];
 const server=createServer({key:'nx_test_fixture',upstream:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({customer_id:'cus_test'}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
 const base=`http://127.0.0.1:${server.address().port}`;
 const config=await fetch(base+'/config').then(r=>r.json());assert.equal(config.ready,true);assert.equal(JSON.stringify(config).includes('nx_test_fixture'),false);
 const post=(payload,headers={})=>fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});
 assert.equal((await post({action:'create'})).status,403);assert.equal(calls.length,0);
 const headers={'x-local-token':config.token,origin:base};
 assert.equal((await post({action:'create',body:{verification_type:'individual',fiscal_id:'fixture'}},headers)).status,200);
 assert.equal(calls[0].url,'https://api.staging.21millions.com/v1/partner/customers');assert.equal(calls[0].options.headers['x-api-key'],'nx_test_fixture');
 assert.equal((await post({action:'arbitrary'},headers)).status,400);assert.equal(calls.length,1);
 const html=await fetch(base).then(r=>r.text());assert.match(html,/Alta de cliente/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('all financial queries call only allowed staging GET routes and preserve decimal strings', async () => {
 const calls=[];
 const server=createServer({key:'nx_test_fixture',upstream:async(url,options)=>{
  calls.push({url,options});
  return Response.json({balances:[{currency:'USDC',balance:'9007199254740993.12345678'}],orders:[],movements:[],deposits:[],destinations:[],total:0});
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base=`http://127.0.0.1:${server.address().port}`;
  const config=await fetch(base+'/config').then(r=>r.json());
  const headers={'content-type':'application/json','x-local-token':config.token,origin:base};
  const post=payload=>fetch(base+'/api',{method:'POST',headers,body:JSON.stringify(payload)});
  for(const [queryName,definition] of Object.entries(queryCatalog)) {
   const response=await post({action:'query',queryName,customerId:'customer_a',orderId:'order_a',body:{amount:'100'},filters:definition.windowRequired?{from:'2026-11-01T00:00:00Z',to:'2026-11-04T00:00:00Z'}:{}});
   assert.equal(response.status,200,queryName);
   assert.equal((await response.json()).balances[0].balance,'9007199254740993.12345678');
   const {url,options}=calls.at(-1);
   assert.equal(new URL(url).origin,'https://api.staging.21millions.com');
   assert.equal(options.method,'GET');assert.equal(options.body,undefined);
   assert.equal(options.headers['x-api-key'],'nx_test_fixture');
   if(definition.fixed)assert.equal(new URL(url).searchParams.get('type'),definition.fixed.type);
  }
  const count=calls.length;
  for(const payload of [
   {queryName:'constructor'}, {queryName:'depositAccounts'},
   {queryName:'deposits',filters:{from:'invalid',to:'invalid'}},
   {queryName:'swaps',customerId:'customer_a',filters:{type:'bank_withdrawal'}},
   {queryName:'swaps',customerId:'../bad'},
  ]) assert.equal((await post({action:'query',...payload})).status,400);
  assert.equal(calls.length,count);
  assert.equal((await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'query',queryName:'portfolioBalances'})})).status,403);
  assert.equal(calls.length,count);
  for(const path of ['/queries.js','/query-catalog.js'])assert.match((await fetch(base+path)).headers.get('content-type'),/javascript/);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('read queries preserve provider errors and reject non-staging credentials', async () => {
 let calls=0;
 const provider=createServer({key:'nx_test_fixture',upstream:async()=>{calls++;return Response.json({error:'INSUFFICIENT_SCOPE',message:'No habilitado'}, {status:403});}});
 const noKey=createServer({key:'nx_live_fixture',upstream:async()=>{throw new Error('must not call');}});
 for(const server of [provider,noKey]) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
   const base=`http://127.0.0.1:${server.address().port}`;
   const config=await fetch(base+'/config').then(r=>r.json());
   const response=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json','x-local-token':config.token,origin:base},body:JSON.stringify({action:'query',queryName:'portfolioBalances'})});
   assert.equal(response.status,server===provider?403:400);
   if(server===provider)assert.equal((await response.json()).error,'INSUFFICIENT_SCOPE');
  } finally { await new Promise(resolve=>server.close(resolve)); }
 }
 assert.equal(calls,1);
});
test('push routes require local CSRF token and never expose private push material',async()=>{
 const calls=[];const pushService={publicKey:'public-fixture',subscribe:async(...args)=>{calls.push(args);return {active:true};}};
 const server=createServer({key:'nx_test_fixture',pushService});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  const config=await fetch(base+'/config').then(r=>r.json());assert.equal(config.pushPublicKey,'public-fixture');
  const payload={action:'push-subscribe',customerId:'customer_a',body:{subscription:{endpoint:'fixture'}}};
  const post=headers=>fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});
  assert.equal((await post({})).status,403);
  assert.equal((await post({'x-local-token':config.token,origin:base})).status,200);assert.equal(calls[0][0],'customer_a');
  const sw=await fetch(base+'/sw.js');assert.match(sw.headers.get('content-type'),/javascript/);assert.match(await sw.text(),/showNotification/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

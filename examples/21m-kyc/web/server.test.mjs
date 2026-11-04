import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.mjs';
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

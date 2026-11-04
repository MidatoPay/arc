import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPushService, validateSubscription } from './push-service.mjs';

const sub = suffix => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys:{p256dh:Buffer.alloc(65,4).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')} });
const deposit = (id,customer,when) => ({ id,customer_id:customer,created_at:new Date(when).toISOString(),currency:'ARS',amount:'25000.00000000',type:'bank' });
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(),'21m-push-test-'));
  let time = Date.parse('2026-11-03T12:00:00Z');
  const deliveries=[]; const queries=[]; let deposits=[];
  const options={directory,key:'nx_test_fixture',now:()=>time,
    upstream:async url=>{const q=new URL(url);queries.push(q);const offset=Number(q.searchParams.get('offset'));return Response.json({deposits:deposits.slice(offset,offset+100),total:deposits.length});},
    transport:async (subscription,payload)=>{deliveries.push({subscription,payload});},...overrides};
  let service=await createPushService(options);
  t.after(async()=>{await service.stop();await rm(directory,{recursive:true,force:true});});
  return {get service(){return service;},deliveries,queries,setDeposits:d=>{deposits=d;},advance:ms=>{time+=ms;},get time(){return time;},restart:async()=>{await service.stop();service=await createPushService(options);return service;}};
}
test('deduplicates overlapping windows, routes customers, preserves checkpoint and delivery across restart',async t=>{
  const f=await fixture(t);const a=sub('a'),b=sub('b');
  await f.service.subscribe('customer_a',a);await f.service.subscribe('customer_b',b);f.advance(30000);
  f.setDeposits([deposit('old','customer_a',f.time-60000),deposit('new-a','customer_a',f.time),deposit('new-b','customer_b',f.time),deposit('other','customer_c',f.time)]);
  await f.service.poll();assert.equal(f.deliveries.length,2);
  assert.equal(f.deliveries[0].subscription.endpoint,a.endpoint);assert.equal(f.deliveries[0].payload.customerId,'customer_a');
  assert.equal(f.deliveries[1].subscription.endpoint,b.endpoint);
  const publicKey=f.service.publicKey;await f.restart();assert.equal(f.service.publicKey,publicKey);
  f.advance(30000);await f.service.poll();assert.equal(f.deliveries.length,2);
  assert.equal(f.queries.at(-1).searchParams.get('from'),'2026-11-03T11:50:30.000Z');
  assert.equal((await f.service.status('customer_a',a.endpoint)).deposits.length,1);
});
test('paginates all deposits before advancing checkpoint',async t=>{
  const f=await fixture(t);await f.service.subscribe('customer_a',sub('a'));f.advance(30000);
  f.setDeposits(Array.from({length:101},(_,i)=>deposit(`d${i}`,'customer_a',f.time)));
  await f.service.poll();assert.equal(f.queries.length,2);assert.equal(f.deliveries.length,101);
  assert.equal(f.queries[0].searchParams.get('to'),f.queries[1].searchParams.get('to'));
  assert.equal(f.queries[1].searchParams.get('offset'),'100');
});
test('failed second page does not commit any deposits and is recovered on next poll',async t=>{
  let fail=true;
  const f=await fixture(t,{upstream:async url=>{const offset=Number(new URL(url).searchParams.get('offset'));if(offset===100&&fail)return new Response('',{status:503});return Response.json({deposits:Array.from({length:offset===0?100:1},(_,i)=>deposit(`p${offset+i}`,'customer_a',Date.parse('2026-11-03T12:00:20Z'))),total:101});}});
  await f.service.subscribe('customer_a',sub('a'));f.advance(30000);await f.service.poll();
  assert.equal(f.deliveries.length,0);assert.match((await f.service.status('customer_a')).lastError,/503/);
  fail=false;await f.service.poll();assert.equal(f.deliveries.length,101);
});
test('retries failed push after restart and removes expired subscriptions',async t=>{
  let attempts=0;
  const f=await fixture(t,{transport:async()=>{attempts++;if(attempts===1)throw {statusCode:503};}});
  const a=sub('a');await f.service.subscribe('customer_a',a);f.advance(30000);f.setDeposits([deposit('retry','customer_a',f.time)]);
  await f.service.poll();assert.equal((await f.service.status('customer_a',a.endpoint)).pending,1);
  await f.restart();f.advance(60000);await f.service.poll();assert.equal(attempts,2);assert.equal((await f.service.status('customer_a',a.endpoint)).pending,0);
  const expired=await fixture(t,{transport:async()=>{throw {statusCode:410};}});
  await expired.service.subscribe('customer_a',a);expired.advance(30000);expired.setDeposits([deposit('expired','customer_a',expired.time)]);await expired.service.poll();
  assert.equal((await expired.service.status('customer_a',a.endpoint)).active,false);
});
test('a browser can be rebound to another customer without sending queued deposits to the wrong customer',async t=>{
  let fail=true;const delivered=[];
  const f=await fixture(t,{transport:async(s,p)=>{if(fail)throw {statusCode:503};delivered.push(p);}});
  const a=sub('a');await f.service.subscribe('customer_a',a);f.advance(30000);f.setDeposits([deposit('a','customer_a',f.time)]);await f.service.poll();
  await f.service.subscribe('customer_b',a);fail=false;f.advance(60000);await f.service.poll();assert.equal(delivered.length,0);
  await f.service.test('customer_b',a.endpoint);assert.equal(delivered[0].kind,'test');
});
test('rejects arbitrary outbound destinations and invalid encryption keys',()=>{
  for(const endpoint of ['https://127.0.0.1/private','http://fcm.googleapis.com/path','https://fcm.googleapis.com.evil.example/path'])assert.throws(()=>validateSubscription({...sub('x'),endpoint}));
  assert.throws(()=>validateSubscription({...sub('x'),keys:{auth:'x',p256dh:'x'}}));
});

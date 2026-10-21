import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreasuryHandler } from '../netlify/functions/treasury.js';
import { setTreasurySession, refreshTreasuryStatus, getTreasuryAddress } from '../src/treasury.js';

test('anonymous and invalid sessions cannot inspect treasury configuration or query its RPC', async () => {
  const handler=createTreasuryHandler({isConfigured:()=>assert.fail('Must authenticate before accessing treasury')});
  for(const headers of [{},{authorization:'Bearer invalid'}]) {
    const response=await handler({httpMethod:'GET',headers});
    assert.equal(response.statusCode,401);
    assert.deepEqual(JSON.parse(response.body),{error:'unauthorized'});
    assert.match(response.headers['Cache-Control'],/no-store/);
    assert.equal(response.headers.Vary,'Authorization');
  }
});

test('merchants receive operational configuration without reading or revealing the treasury balance',async()=>{
  const handler=createTreasuryHandler({authenticate:async()=> 'merchant',isAdmin:()=>false,isConfigured:()=>true,
    getAddress:async()=> 'treasury',getBalance:()=>assert.fail('Balance is internal')});
  const response=await handler({httpMethod:'GET'});
  assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(response.body),{configured:true,address:'treasury',balance:null});
});

test('admins can read the balance and internal failures do not leak diagnostics',async()=>{
  const adapters={authenticate:async()=> 'admin',isAdmin:()=>true,isConfigured:()=>true,getAddress:async()=> 'treasury',getBalance:async()=>42};
  const response=await createTreasuryHandler(adapters)({httpMethod:'GET'});
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).balance,42);
  const failed=await createTreasuryHandler({...adapters,getBalance:()=>{throw new Error('private RPC credential');}})({httpMethod:'GET'});
  assert.equal(failed.statusCode,503);
  assert.deepEqual(JSON.parse(failed.body),{error:'treasury_unavailable'});
  const unconfigured=await createTreasuryHandler({...adapters,isConfigured:()=>false})({httpMethod:'GET'});
  assert.deepEqual(JSON.parse(unconfigured.body),{configured:false,address:null,balance:null});
});

test('treasury client requires a session, sends fresh tokens, and discards late responses after logout',async t=>{
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;setTreasurySession(null);});
  setTreasurySession(null);
  globalThis.fetch=()=>assert.fail('Guests must not request treasury');
  assert.equal((await refreshTreasuryStatus()).configured,false);
  let token='first',resolve;
  const cleanup=setTreasurySession('admin',async()=>token);
  const headers=[];
  globalThis.fetch=async(path,options)=>{
    assert.equal(path,'/treasury');assert.equal(options.cache,'no-store');
    headers.push(options.headers.Authorization);
    return {ok:true,json:async()=>({configured:true,address:'treasury',balance:42})};
  };
  assert.equal((await refreshTreasuryStatus()).balance,42);
  token='renewed';await refreshTreasuryStatus();
  assert.deepEqual(headers,['Bearer first','Bearer renewed']);
  const started=new Promise(r=>{resolve=r;});
  let complete;
  globalThis.fetch=async()=>{resolve();return new Promise(r=>{complete=r;});};
  const pending=refreshTreasuryStatus();await started;
  cleanup();assert.equal(getTreasuryAddress(),null);
  setTreasurySession('merchant',async()=> 'merchant-token');
  complete({ok:true,json:async()=>({configured:true,address:'old-treasury',balance:42})});
  assert.equal((await pending).balance,null);
  assert.equal(getTreasuryAddress(),null);
  cleanup(); // An old effect cleanup must not clear the new session.
  globalThis.fetch=async()=>({ok:true,json:async()=>({configured:true,address:'treasury',balance:null})});
  assert.equal((await refreshTreasuryStatus()).configured,true);
});

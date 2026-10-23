import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadCache } from '../netlify/functions/lib/readCache.js';
import { createQuoteHandler } from '../netlify/functions/quote.js';
import { createBalanceHandler } from '../netlify/functions/balance.js';
import { createRpcHandler } from '../netlify/functions/lib/rpcProxy.js';
import { PaymentError } from '../netlify/functions/lib/paymentCore.js';
import { CHAINLINK_USD_ARS_FEED } from '../src/priceFeed.js';
import { createDisplayQuoteClient } from '../src/fx.js';
import { createWalletBalanceClient } from '../src/walletBalance.js';
import { ARC } from '../src/chain.js';
import { NETWORK } from '../src/network.js';
import { startVisibleRefresh } from '../src/visibleRefresh.js';
import { setRpcSession,rpcAccessToken } from '../src/rpcSession.js';

test('read cache shares entries across instances, expires, coalesces calls and never caches failures',async()=>{
  let time=0,calls=0;
  const saved=new Map(),storage=()=>({open:async()=>({match:async key=>saved.get(key)?.clone(),put:async(key,value)=>saved.set(key,value.clone())})});
  const first=createReadCache({now:()=>time,storage}),second=createReadCache({now:()=>time,storage});
  const load=async()=>++calls;
  assert.deepEqual(await Promise.all([first('a',10000,load),first('a',10000,load)]),[1,1]);
  assert.equal(await second('a',10000,load),1);assert.equal(calls,1);
  time=10001;assert.equal(await second('a',10000,load),2);
  assert.equal(await second('b',10000,load),3);
  assert.equal(await second('a',10000,load,{fresh:true}),4);
  const fail=()=>{throw new Error('offline');};
  await assert.rejects(()=>first('bad',10000,fail));
  assert.equal(await first('bad',10000,load),5);
});

test('forced balance reads supersede pending snapshots without being overwritten by late responses',async()=>{
  const read=createReadCache({storage:()=>null});let finish,started;
  const ready=new Promise(resolve=>started=resolve);
  const old=read('wallet',10000,()=>{started();return new Promise(resolve=>finish=resolve);});
  await ready;
  assert.equal(await read('wallet',10000,async()=>20,{fresh:true}),20);
  finish(10);assert.equal(await old,10);
  assert.equal(await read('wallet',10000,()=>assert.fail('Must use fresh snapshot')),20);
});

test('quote endpoint caches only validated public display data, bounds CDN freshness and never caches failures',async()=>{
  let calls=0,time=1000000;
  const handler=createQuoteHandler({now:()=>time,read:createReadCache({now:()=>time,storage:()=>null}),
    settings:()=>({rpc:'private-rpc',maxAge:100}),quote:async()=>{calls++;return {rate:'1650',updatedAt:950,roundId:'1'};}});
  const first=await handler({httpMethod:'GET'});
  assert.equal(first.statusCode,200);assert.match(first.headers['Netlify-CDN-Cache-Control'],/s-maxage=50, durable/);
  assert.equal(JSON.parse(first.body).displayOnly,true);assert.ok(!first.body.includes('private-rpc'));
  await handler({httpMethod:'GET'});assert.equal(calls,1);
  time=1050000;const stale=await handler({httpMethod:'GET'});
  assert.equal(stale.statusCode,503);assert.equal(stale.headers['Netlify-CDN-Cache-Control'],undefined);
  assert.equal((await handler({httpMethod:'POST'})).statusCode,405);
  const failed=await createQuoteHandler({settings:()=>{throw new Error('credential');}})({httpMethod:'GET'});
  assert.deepEqual(JSON.parse(failed.body),{error:'quote_unavailable'});
});

test('balance endpoint authorizes before reading, selects the session wallet and keeps cached responses private',async()=>{
  let user='alice',reads=0;
  const handler=createBalanceHandler({authenticate:async()=>{if(!user)throw new PaymentError('unauthorized',401);return user;},
    wallet:async id=>id==='alice'?'wallet-a':'wallet-b',balance:async owner=>{reads++;return owner==='wallet-a'?1:2;},read:createReadCache({storage:()=>null})});
  const event={httpMethod:'GET',queryStringParameters:{address:'victim'}};
  let response=await handler(event);
  assert.deepEqual([JSON.parse(response.body).address,JSON.parse(response.body).usdc],['wallet-a',1]);
  await handler(event);assert.equal(reads,1);
  await handler({...event,queryStringParameters:{refresh:'1'}});assert.equal(reads,2);
  user='bob';response=await handler(event);assert.equal(JSON.parse(response.body).usdc,2);
  assert.match(response.headers['Cache-Control'],/private, no-store/);
  assert.equal(response.headers['Netlify-CDN-Cache-Control'],undefined);
  user=null;assert.equal((await handler(event)).statusCode,401);assert.equal(reads,3);
});

const rpcEvent=method=>({httpMethod:'POST',headers:{},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
test('RPC gateway rejects unauthenticated traffic, expensive methods, oversized payloads and abusive batches before forwarding',async()=>{
  let calls=0,time=0;
  const options={chain:'arc',target:'https://private.invalid',now:()=>time,request:async()=>{calls++;return {status:200,json:async()=>({result:'ok'})};}};
  const anonymous=createRpcHandler({...options,authenticate:async()=>{throw new PaymentError('unauthorized',401);}});
  assert.equal((await anonymous(rpcEvent('eth_chainId'))).statusCode,401);
  const handler=createRpcHandler({...options,authenticate:async()=> 'user'});
  const call=(method,params)=>({...rpcEvent(method),body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  // Writes, scans and arbitrary contract calls never reach the upstream RPC.
  for(const method of ['eth_sendRawTransaction','eth_getLogs','eth_getProof','debug_traceTransaction','eth_sign'])
    assert.equal((await handler(rpcEvent(method))).statusCode,403,method);
  assert.equal((await handler(call('eth_call',[{to:'0x'+'1'.repeat(40),data:'0x'},'latest']))).statusCode,403);
  assert.equal((await handler(call('eth_getBlockByNumber',['latest',true]))).statusCode,403);
  assert.equal((await handler(call('eth_feeHistory',[1000,'latest',[]]))).statusCode,400);
  assert.equal((await handler({...rpcEvent('eth_chainId'),body:'x'.repeat(65537)})).statusCode,413);
  assert.equal((await handler({...rpcEvent('eth_chainId'),body:'['})).statusCode,400);
  assert.equal((await handler({...rpcEvent('eth_chainId'),body:JSON.stringify(Array(11).fill(JSON.parse(rpcEvent('eth_chainId').body)))})).statusCode,400);
  assert.equal(calls,0);
  assert.equal((await handler(call('eth_call',[{to:NETWORK.usdc,data:'0x70a08231'},'latest']))).statusCode,200);
  assert.equal((await handler(call('eth_call',[{to:NETWORK.memo.toLowerCase(),data:'0x'},'latest']))).statusCode,200);
  assert.equal((await handler(call('eth_getBlockByNumber',['latest',false]))).statusCode,200);
  for(let i=0;i<117;i++)assert.equal((await handler(rpcEvent('eth_blockNumber'))).statusCode,200);
  const limited=await handler(rpcEvent('eth_chainId'));assert.equal(limited.statusCode,429);assert.equal(limited.headers['Retry-After'],'60');
  time=60000;assert.equal((await handler(rpcEvent('eth_chainId'))).statusCode,200);
});

test('Ethereum gateway accepts only Chainlink reads, and never exposes transport errors',async()=>{
  const request=async()=>({status:200,json:async()=>({result:'0x1'})});
  const handler=createRpcHandler({chain:'ethereum',authenticate:async()=> 'user',target:'private',request});
  const event=to=>({...rpcEvent('eth_call'),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data:'0x50d25bcd'},'latest']})});
  assert.equal((await handler(event(CHAINLINK_USD_ARS_FEED))).statusCode,200);
  assert.equal((await handler(event('0x'+'0'.repeat(40)))).statusCode,403);
  const failed=await createRpcHandler({chain:'ethereum',authenticate:async()=> 'user',request:()=>{throw new Error('private key');}})(rpcEvent('eth_chainId'));
  assert.deepEqual(JSON.parse(failed.body),{error:'rpc_unavailable'});
});

test('display quotes deduplicate requests and fallback briefly without moving money',async()=>{
  let requests=0,time=0;
  const read=createDisplayQuoteClient({now:()=>time,request:async path=>{assert.equal(path,'/quote');requests++;return {ok:true,json:async()=>({rate:'1700',displayOnly:true})};}});
  assert.deepEqual(await Promise.all([read(),read()]),[1700,1700]);assert.equal(requests,1);
  await read();assert.equal(requests,1);time=60000;await read();assert.equal(requests,2);
  const fallback=createDisplayQuoteClient({request:()=>{throw new Error('unavailable');}});assert.equal(await fallback(),1650);
});

test('balance client coalesces reads, supports post-operation refresh, sends auth and rejects another wallet',async()=>{
  let requests=0;
  const read=createWalletBalanceClient({getToken:async()=> 'token',request:async(path,options)=>{
    requests++;assert.equal(options.headers.Authorization,'Bearer token');
    return {ok:true,json:async()=>({address:wallet,network:ARC.network,usdc:requests})};
  }});
  const wallet='0x8ba1f109551bD432803012645Ac136ddd64DBA72',victim='0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  assert.deepEqual(await Promise.all([read(wallet.toLowerCase()),read(wallet.toLowerCase())]),[1,1]);assert.equal(requests,1);
  assert.equal(await read(wallet.toLowerCase(),{fresh:true}),2);
  await assert.rejects(()=>read(victim),/balance_mismatch/);
});

test('visible refresh pauses hidden tabs, deduplicates wakeups and stops cleanly',async()=>{
  let time=0,calls=0,timerId=0;
  const callbacks=new Map(),listeners=new Map();
  const surface={visibilityState:'hidden',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
  const stop=startVisibleRefresh(async()=>{calls++;},{document:surface,window:surface,now:()=>time,
    schedule:fn=>{callbacks.set(++timerId,fn);return timerId;},cancel:id=>callbacks.delete(id)});
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  assert.equal(calls,0);
  surface.visibilityState='visible';listeners.get('visibilitychange')();await flush();assert.equal(calls,1);
  listeners.get('focus')();assert.equal(calls,1);assert.equal(callbacks.size,1);
  surface.visibilityState='hidden';listeners.get('visibilitychange')();assert.equal(callbacks.size,0);
  time=20000;surface.visibilityState='visible';listeners.get('visibilitychange')();await flush();assert.equal(calls,2);
  stop();assert.equal(callbacks.size,0);assert.equal(listeners.size,0);
});

test('RPC tokens are refreshed per request and pending authentication cannot survive logout',async()=>{
  let token='first';const cleanup=setRpcSession('user',async()=>token);
  assert.equal(await rpcAccessToken(),'first');token='renewed';assert.equal(await rpcAccessToken(),'renewed');cleanup();
  await assert.rejects(()=>rpcAccessToken(),/session_required/);
  let finish;setRpcSession('old',()=>new Promise(resolve=>finish=resolve));const pending=rpcAccessToken();
  setRpcSession('new',async()=> 'new-token');finish('old-token');await assert.rejects(()=>pending,/session_required/);
  assert.equal(await rpcAccessToken(),'new-token');setRpcSession(null);
});

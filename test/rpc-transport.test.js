import test from 'node:test';
import assert from 'node:assert/strict';
import { setRpcSession } from '../src/rpcSession.js';

test('the app JSON-RPC client attaches renewed session tokens and returns raw hex results',async t=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  t.after(()=>{globalThis.window=previousWindow;globalThis.fetch=previousFetch;setRpcSession(null);});
  globalThis.window={location:{origin:'http://localhost:5173'}};
  let token='first';setRpcSession('user',async()=>token);
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    requests.push({url:String(url),authorization:new Headers(options.headers).get('authorization'),method:body.method,params:body.params});
    if(body.method==='eth_call')return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:3,message:'execution reverted'}}),{headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:'0x7b'}),{headers:{'Content-Type':'application/json'}});
  };
  const {createAppRpc}=await import('../src/chain.js?browser-transport-test');
  const rpc=createAppRpc();
  const owner='0x8ba1f109551bD432803012645Ac136ddd64DBA72';
  assert.equal(await rpc('eth_getBalance',[owner,'latest']),'0x7b');
  token='renewed';
  assert.equal(BigInt(await rpc('eth_getBalance',[owner,'latest'])),123n);
  assert.deepEqual(requests,[
    {url:'http://localhost:5173/rpc',authorization:'Bearer first',method:'eth_getBalance',params:[owner,'latest']},
    {url:'http://localhost:5173/rpc',authorization:'Bearer renewed',method:'eth_getBalance',params:[owner,'latest']},
  ]);
  await assert.rejects(()=>rpc('eth_call',[{to:owner,data:'0x'},'latest']),error=>error.code===3 && /execution reverted/.test(error.message));
  setRpcSession(null);
  await assert.rejects(()=>rpc('eth_blockNumber'),/session_required/);
  assert.equal(requests.length,3);
});

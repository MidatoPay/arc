import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Transaction,Wallet,keccak256,toUtf8Bytes,toUtf8String} from 'ethers';
import {NETWORK} from '../src/network.js';
import {ERC20,MEMO} from '../src/arc.js';
import {exactUsdc} from '../src/transfers.js';
import {prepareTransfer,validateUserSignature,signingRequest,sourceBalance} from '../netlify/functions/lib/transferChain.js';
import {createTransfer,submitTransfer,cancelUnsignedTransfer,publicTransfer,transferQuote,networkFeeEstimate} from '../netlify/functions/lib/transferService.js';
import {transfersEnabledFor,assertTransfersEnabled} from '../netlify/functions/lib/transferAccess.js';
import {processTransfer} from '../netlify/functions/lib/transferWorker.js';
import {listUserActivity} from '../netlify/functions/lib/paymentActivity.js';
import {createTransfersHandler} from '../netlify/functions/transfers.js';
import {PaymentError} from '../netlify/functions/lib/paymentCore.js';
import {ArcRpcRejected,hex} from '../netlify/functions/lib/arcRpc.js';

// 20 gwei gas price → 40 gwei max fee; 90k estimated gas → 113k limit with margin.
const GAS_PRICE=20_000_000_000n,MAX_GAS_WEI=113_000n*40_000_000_000n,USDC=10n**12n;

test('amounts use exact six-decimal units',()=>{
 assert.equal(exactUsdc('0,000001'),'0.000001');assert.equal(exactUsdc('0.123031'),'0.123031');
 for(const value of ['0','0.0000001','1e-6','-1','NaN'])assert.throws(()=>exactUsdc(value));
});
test('transfer endpoint authenticates before any database or signing operation',async()=>{
 const handler=createTransfersHandler({authenticate:async()=>{throw new PaymentError('unauthorized',401);},create:()=>assert.fail('Must not create')});
 assert.equal((await handler({httpMethod:'POST',path:'/transfers'})).statusCode,401);
});
test('production pilot requires an exact authenticated user ID and preserves Chainlink freshness configuration',async()=>{
 const env={TRANSFERS_ENABLED:'false',TRANSFERS_ALLOWED_USER_IDS:'did:privy:pilot, did:privy:second',ETH_RPC_URL:'https://example.com/rpc',CHAINLINK_MAX_AGE_SECONDS:'90000'};
 assert.equal(transfersEnabledFor('did:privy:pilot',env),true);
 for(const user of ['did:privy:pilo','did:privy:pilot-extra','',null,'other']) {
  assert.equal(transfersEnabledFor(user,env),false);
  assert.throws(()=>assertTransfersEnabled(user,env),/transfers_disabled/);
 }
 assert.equal(transfersEnabledFor('other',{...env,TRANSFERS_ENABLED:'true'}),true);
 assert.equal(transfersEnabledFor('did:privy:pilot',{...env,TRANSFERS_ALLOWED_USER_IDS:''}),false);
 assert.equal(await transferQuote({env,fetchQuote:async(rpc,maxAge)=>{assert.equal(rpc,env.ETH_RPC_URL);assert.equal(maxAge,90000);return {rate:'1600'};}}),'1600');
 await assert.rejects(()=>transferQuote({env:{...env,CHAINLINK_MAX_AGE_SECONDS:''}}),/missing_chainlink_max_age_seconds/);
});
test('the network fee estimate is a USDC amount above the Arc fee floor',async()=>{
 const fee=await networkFeeEstimate({rpc:async method=>{assert.equal(method,'eth_gasPrice');return hex(GAS_PRICE);}});
 assert.equal(fee,'0.006');
 assert.equal(await networkFeeEstimate({rpc:async()=>'0x1'}),'0.003');
});

test('user-signed USDC transfers pay gas from the same balance and complete only on a verified receipt',async t=>{
 const engine=new PGlite();await engine.waitReady;t.after(()=>engine.close());
 const base=(await readFile('db/schema.sql','utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;','');await engine.exec(base);
 for(const file of ['20261013_mercadopago.sql','20261016_charge_paid_at.sql','20261016_merchant_profiles.sql','20261016_wallet_transfers.sql'])
  await engine.exec(await readFile(`db/migrations/${file}`,'utf8'));
 await engine.exec(await readFile('db/migrations/20261016_wallet_transfers.sql','utf8'));
 let tail=Promise.resolve();
 const query=async(sql,params)=>{const r=await engine.query(sql,params);return {...r,rowCount:r.affectedRows ?? r.rows.length};};
 const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};}};
 const user=Wallet.createRandom(),attacker=Wallet.createRandom(),recipient=Wallet.createRandom().address;
 const old={enabled:process.env.TRANSFERS_ENABLED,allowed:process.env.TRANSFERS_ALLOWED_USER_IDS};
 process.env.TRANSFERS_ENABLED='true';delete process.env.TRANSFERS_ALLOWED_USER_IDS;
 t.after(()=>{for(const [key,value] of Object.entries({TRANSFERS_ENABLED:old.enabled,TRANSFERS_ALLOWED_USER_IDS:old.allowed}))if(value===undefined)delete process.env[key];else process.env[key]=value;});

 // In-memory Arc node: only the methods the transfer flow is allowed to use.
 const chain={chainId:hex(NETWORK.chainId),balance:10n*10n**18n,pending:0,latest:0,codes:{},estimateError:false,callError:false,receipts:{}};
 const broadcasts=[],calls=[];
 const rejected=message=>new ArcRpcRejected('transfer_rpc_rejected',{code:3,message});
 const rpc=async(method,params)=>{
  switch(method) {
   case 'eth_chainId':return chain.chainId;
   case 'eth_getCode':return chain.codes[params[0].toLowerCase()] || '0x';
   case 'eth_estimateGas':if(chain.estimateError)throw rejected('execution reverted');return '0x15f90';
   case 'eth_gasPrice':return hex(GAS_PRICE);
   case 'eth_getTransactionCount':assert.ok(['pending','latest'].includes(params[1]));return hex(params[1]==='latest'?chain.latest:chain.pending);
   case 'eth_getBalance':return hex(chain.balance);
   case 'eth_call':calls.push(params[0]);if(chain.callError)throw rejected('execution reverted: blacklisted');return '0x';
   case 'eth_getTransactionReceipt':return chain.receipts[params[0]] ?? null;
   case 'eth_sendRawTransaction': {
    const saved=(await query('SELECT id FROM wallet_transfers WHERE signed_tx=$1',[params[0]])).rows;
    assert.equal(saved.length,1,'Durable commit before broadcast');broadcasts.push(params[0]);return Transaction.from(params[0]).hash;
   }
  }
  throw new Error(`Unexpected RPC ${method}`);
 };
 const adapters={db,rpc,primary:async()=>({address:user.address}),balance:owner=>sourceBalance(owner,rpc),quote:async()=>'1600',
  prepare:input=>prepareTransfer(input,{rpc})};
 const input={from:user.address,to:recipient,amount:'0.123031',kind:'pay'};
 // What the Privy embedded wallet does with the request returned by the API.
 const sign=(wallet,prepared)=>wallet.signTransaction(signingRequest(prepared));
 const receipt=(t,{status='0x1',value=BigInt(t.usdc_raw),to=t.to_address}={})=>({status,blockNumber:'0x63',gasUsed:'0x15f90',effectiveGasPrice:hex(GAS_PRICE),
  logs:[{address:NETWORK.usdc,...ERC20.encodeEventLog(ERC20.getEvent('Transfer'),[t.from_address,to,value])}]});
 const row=async id=>(await query('SELECT * FROM wallet_transfers WHERE id=$1',[id])).rows[0];
 let first;

 await t.test('preparation builds an exact memo-wrapped USDC transfer on Arc and is idempotent',async()=>{
  const key=randomUUID();first=await createTransfer('owner',input,key,adapters);
  assert.equal(String(first.usdc_raw),'123031');assert.equal(String(first.max_gas_wei),String(MAX_GAS_WEI));assert.equal(String(first.nonce),'0');
  const tx=Transaction.from(first.unsigned_tx);
  assert.equal(tx.type,2);assert.equal(tx.chainId,BigInt(NETWORK.chainId));assert.equal(tx.to,NETWORK.memo);assert.equal(tx.value,0n);
  assert.equal(tx.gasLimit,113000n);assert.equal(tx.maxFeePerGas,40_000_000_000n);
  const [target,inner,memoId,memoData]=MEMO.decodeFunctionData('memo',tx.data);
  assert.equal(target,NETWORK.usdc);assert.equal(memoId,keccak256(toUtf8Bytes(`transfer_${first.id}`)));
  assert.equal(toUtf8String(memoData),`MIDATO|v1|inv:transfer_${first.id}|kind:pay|usdc:0.123031`);
  const [to,value]=ERC20.decodeFunctionData('transfer',inner);
  // The recipient receives exactly the requested amount; gas is paid on top.
  assert.equal(to,recipient);assert.equal(value,123031n);
  const api=publicTransfer(first,true);
  assert.deepEqual(api.transaction,signingRequest(first));assert.equal(api.transaction.from,user.address);
  assert.equal(api.maxNetworkFeeUsdc,'0.00452');assert.equal(api.network,'arc-mainnet');
  assert.equal((await createTransfer('owner',input,key,adapters)).id,first.id);
  await assert.rejects(async()=>createTransfer('owner',{...input,amount:'1'},key,adapters),/idempotency_conflict/);
  await assert.rejects(async()=>createTransfer('owner',{...input,from:attacker.address},randomUUID(),adapters),/primary_wallet_required/);
  await assert.rejects(async()=>createTransfer('owner',{...input,to:'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'},randomUUID(),adapters),/invalid_transfer/);
  await assert.rejects(async()=>createTransfer('owner',{...input,to:user.address},randomUUID(),adapters),/invalid_transfer_amount/);
  assert.equal(broadcasts.length,0);
 });
 await t.test('contract recipients are rejected while EIP-7702 delegated wallets are accepted',async()=>{
  const contract=Wallet.createRandom().address,delegated=Wallet.createRandom().address;
  chain.codes[contract.toLowerCase()]='0x6080604052';chain.codes[delegated.toLowerCase()]=`0xef0100${'11'.repeat(20)}`;
  await assert.rejects(()=>createTransfer('owner',{...input,to:contract},randomUUID(),adapters),/recipient_not_wallet/);
  const ok=await createTransfer('owner',{...input,to:delegated},randomUUID(),adapters);
  await cancelUnsignedTransfer('owner',ok.id,adapters);
  chain.estimateError=true;
  await assert.rejects(()=>createTransfer('owner',input,randomUUID(),adapters),/transfer_simulation_failed/);
  chain.estimateError=false;
 });
 await t.test('unsigned, tampered, foreign-signed and failing transactions are never stored or broadcast',async()=>{
  await assert.rejects(async()=>validateUserSignature(first,first.unsigned_tx),/invalid_signed_transaction/);
  await assert.rejects(async()=>validateUserSignature(first,'not-hex'),/invalid_signed_transaction/);
  const {from:_ignored,...foreign}=signingRequest(first);
  await assert.rejects(async()=>validateUserSignature(first,await attacker.signTransaction(foreign)),/invalid_user_signature/);
  const altered=await prepareTransfer({from:user.address,to:recipient,raw:'2',memo:'changed',reference:'changed'},{rpc});
  await assert.rejects(async()=>validateUserSignature(first,await sign(user,{...altered,from_address:user.address})),/transfer_message_changed/);
  await assert.rejects(async()=>submitTransfer('another',first.id,await sign(user,first),adapters),/transfer_not_found/);
  chain.callError=true;
  await assert.rejects(async()=>submitTransfer('owner',first.id,await sign(user,first),adapters),/transfer_simulation_failed/);
  chain.callError=false;
  assert.equal((await row(first.id)).tx_hash,null);assert.equal(broadcasts.length,0);
 });
 await t.test('submission stores the signed transaction before the worker rebroadcasts identical bytes',async()=>{
  const signed=await sign(user,first);
  first=await submitTransfer('owner',first.id,signed,adapters);
  assert.equal(first.status,'broadcasting');assert.equal(first.tx_hash,Transaction.from(signed).hash);assert.equal(first.signed_tx,signed);
  assert.equal(calls.at(-1).from,user.address);assert.equal(calls.at(-1).to,NETWORK.memo);
  assert.equal(broadcasts.length,0);
  const repeated=await submitTransfer('owner',first.id,'ignored-on-recovery',adapters);assert.equal(repeated.tx_hash,first.tx_hash);
  await processTransfer(first.id,{db,rpc});await processTransfer(first.id,{db,rpc});
  assert.deepEqual(broadcasts,[signed,signed]);
  const api=JSON.stringify(publicTransfer(first));assert.ok(!api.includes(first.signed_tx));assert.ok(api.includes(first.tx_hash));
  const activity=await listUserActivity(db,'owner',NETWORK.network);assert.equal(activity[0].source,'transfer');assert.equal(activity[0].settled,false);
 });
 await t.test('a successful receipt that matches the USDC transfer creates one ledger row with the gas fee',async()=>{
  chain.receipts[first.tx_hash]=receipt(first);
  await processTransfer(first.id,{db,rpc});await processTransfer(first.id,{db,rpc});
  const stored=await row(first.id);assert.equal(stored.status,'completed');assert.equal(String(stored.block),'99');
  const ledger=(await query('SELECT * FROM transactions')).rows;assert.equal(ledger.length,1);
  assert.equal(Number(ledger[0].amt),0.123031);assert.equal(Number(ledger[0].fee),0.0018);assert.equal(ledger[0].hash,first.tx_hash);
  const activity=await listUserActivity(db,'owner',NETWORK.network);assert.equal(activity.length,1);assert.equal(activity[0].settled,true);
 });
 await t.test('reverted or mismatched receipts never complete a transfer',async()=>{
  const failing=await createTransfer('owner',input,randomUUID(),adapters);
  // A transaction signed for another transfer is never accepted for this one.
  await assert.rejects(async()=>submitTransfer('owner',failing.id,await sign(user,first),adapters),/transfer_message_changed/);
  const failed=await submitTransfer('owner',failing.id,await sign(user,failing),adapters);
  chain.receipts[failed.tx_hash]=receipt(failed,{status:'0x0'});
  await processTransfer(failed.id,{db,rpc});
  assert.equal((await row(failed.id)).status,'failed');assert.equal((await row(failed.id)).last_error,'transfer_onchain_failed');
  const mismatchDraft=await createTransfer('owner',input,randomUUID(),adapters);
  const mismatch=await submitTransfer('owner',mismatchDraft.id,await sign(user,mismatchDraft),adapters);
  chain.receipts[mismatch.tx_hash]=receipt(mismatch,{value:1n});
  await processTransfer(mismatch.id,{db,rpc});
  assert.equal((await row(mismatch.id)).status,'manual_review');assert.equal((await row(mismatch.id)).last_error,'transfer_chain_mismatch');
  assert.equal((await query('SELECT * FROM transactions')).rows.length,1);
 });
 await t.test('the amount plus maximum gas must fit after in-flight transfers',async()=>{
  const amount=10n**18n;chain.balance=amount+MAX_GAS_WEI-1n;
  await assert.rejects(()=>createTransfer('sendable-user',{...input,amount:'1'},randomUUID(),adapters),/insufficient_usdc/);
  chain.balance=amount+MAX_GAS_WEI;
  const all=await createTransfer('sendable-user',{...input,amount:'1'},randomUUID(),adapters);
  const [,inner]=MEMO.decodeFunctionData('memo',Transaction.from(all.unsigned_tx).data);
  assert.equal(ERC20.decodeFunctionData('transfer',inner)[1],1_000_000n);
  await submitTransfer('sendable-user',all.id,await sign(user,all),adapters);
  // The submitted transfer still holds its amount and gas until its receipt arrives.
  await assert.rejects(()=>createTransfer('sendable-user',{...input,amount:'0.000001'},randomUUID(),adapters),/insufficient_usdc/);
  chain.balance=10n*10n**18n;
 });
 await t.test('parallel submissions serialize the spendable balance and never overspend',async()=>{
  chain.balance=2n*(USDC+MAX_GAS_WEI);
  const drafts=await Promise.all(Array.from({length:3},()=>createTransfer('parallel-user',{...input,amount:'0.000001'},randomUUID(),adapters)));
  const signed=await Promise.all(drafts.map(draft=>sign(user,draft)));
  const outcomes=await Promise.allSettled(drafts.map((draft,index)=>submitTransfer('parallel-user',draft.id,signed[index],adapters)));
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,2);
  assert.equal(outcomes.find(outcome=>outcome.status==='rejected').reason.code,'insufficient_usdc');
  chain.balance=10n*10n**18n;
 });
 await t.test('a used nonce expires the unsigned transaction and the same intent is prepared again',async()=>{
  const key=randomUUID(),draft=await createTransfer('nonce-user',input,key,adapters);
  const stale=await sign(user,draft);chain.pending=1;
  await assert.rejects(()=>submitTransfer('nonce-user',draft.id,stale,adapters),/transfer_nonce_expired/);
  const refreshed=await createTransfer('nonce-user',input,key,adapters);
  assert.equal(refreshed.id,draft.id);assert.equal(String(refreshed.nonce),'1');assert.notEqual(refreshed.unsigned_tx,draft.unsigned_tx);
  await assert.rejects(()=>submitTransfer('nonce-user',draft.id,stale,adapters),/transfer_message_changed/);
  const accepted=await submitTransfer('nonce-user',draft.id,await sign(user,refreshed),adapters);
  assert.equal(accepted.status,'broadcasting');chain.pending=0;
 });
 await t.test('a transaction whose nonce was consumed elsewhere stays reserved for review and is not rebroadcast',async()=>{
  const draft=await createTransfer('review-user',input,randomUUID(),adapters);
  const submitted=await submitTransfer('review-user',draft.id,await sign(user,draft),adapters);
  const count=broadcasts.length;chain.latest=1;
  await processTransfer(submitted.id,{db,rpc});
  const stored=await row(submitted.id);
  assert.equal(stored.status,'manual_review');assert.equal(stored.last_error,'transfer_not_landed_requires_review');
  assert.equal(stored.tx_hash,submitted.tx_hash);assert.equal(broadcasts.length,count);
  chain.latest=0;await processTransfer(submitted.id,{db,rpc});assert.equal(broadcasts.length,count,'manual review never rebroadcasts');
  // A late receipt still settles it.
  chain.receipts[submitted.tx_hash]=receipt(submitted);await processTransfer(submitted.id,{db,rpc});
  assert.equal((await row(submitted.id)).status,'completed');
 });
 await t.test('cancellation and disabled transfers prevent signing, and paused workers never broadcast',async()=>{
  const draft=await createTransfer('fresh-user',input,randomUUID(),adapters);
  await cancelUnsignedTransfer('fresh-user',draft.id,adapters);
  await assert.rejects(async()=>submitTransfer('fresh-user',draft.id,await sign(user,draft),adapters),/transfer_not_signable/);
  const pending=await createTransfer('fresh-user',input,randomUUID(),adapters);
  process.env.TRANSFERS_ENABLED='false';
  await assert.rejects(async()=>submitTransfer('fresh-user',pending.id,await sign(user,pending),adapters),/transfers_disabled/);
  process.env.TRANSFERS_ENABLED='true';
  const submitted=await submitTransfer('fresh-user',pending.id,await sign(user,pending),adapters);
  const count=broadcasts.length;process.env.TRANSFERS_ENABLED='false';
  await processTransfer(submitted.id,{db,rpc});assert.equal(broadcasts.length,count);process.env.TRANSFERS_ENABLED='true';
  await assert.rejects(()=>cancelUnsignedTransfer('fresh-user',submitted.id,adapters),/transfer_already_submitted/);
 });
 await t.test('RPC network checks reject the wrong chain before reading balances or preparing',async()=>{
  chain.chainId='0x1';
  await assert.rejects(async()=>sourceBalance(user.address,rpc),/arc_rpc_network_mismatch/);
  await assert.rejects(async()=>createTransfer('owner',input,randomUUID(),adapters),/arc_rpc_network_mismatch/);
  chain.chainId=hex(NETWORK.chainId);
 });
 await t.test('a failed durable commit never transmits, while transport failures reuse the saved transaction',async()=>{
  const draft=await createTransfer('disk-user',input,randomUUID(),adapters);
  const faulty={...db,connect:async()=>{const client=await db.connect();return {...client,query:(sql,args)=>{
   if(sql.includes('SET tx_hash=$2'))throw new Error('disk_unavailable');return client.query(sql,args);
  }};}};
  const count=broadcasts.length;
  await assert.rejects(async()=>submitTransfer('disk-user',draft.id,await sign(user,draft),{...adapters,db:faulty}),/disk_unavailable/);
  assert.equal((await row(draft.id)).tx_hash,null);assert.equal(broadcasts.length,count);
  const accepted=await submitTransfer('disk-user',draft.id,await sign(user,draft),adapters);
  const failAfterBroadcast=async(method,args)=>{const result=await rpc(method,args);if(method==='eth_sendRawTransaction')throw new Error('response_lost');return result;};
  await processTransfer(accepted.id,{db,rpc:failAfterBroadcast});
  assert.equal((await row(accepted.id)).last_error,'transfer_tracking_unavailable');
  const alreadyKnown=async(method,args)=>{if(method==='eth_sendRawTransaction'){await rpc(method,args);throw rejected('already known');}return rpc(method,args);};
  await query('UPDATE wallet_transfers SET last_error=NULL WHERE id=$1',[accepted.id]);
  await processTransfer(accepted.id,{db,rpc:alreadyKnown});
  assert.equal((await row(accepted.id)).last_error,null);
  assert.equal(broadcasts.at(-1),accepted.signed_tx);assert.equal(broadcasts.at(-2),accepted.signed_tx);
 });
 await t.test('production pilot enables only its owner through preparation, submit, availability and worker broadcast',async()=>{
  const outsider=await createTransfer('outside-pilot',input,randomUUID(),adapters);
  const owner='did:privy:pilot';process.env.TRANSFERS_ENABLED='false';process.env.TRANSFERS_ALLOWED_USER_IDS=owner;
  try {
   await assert.rejects(()=>createTransfer('outside-pilot',input,randomUUID(),adapters),/transfers_disabled/);
   await assert.rejects(async()=>submitTransfer('outside-pilot',outsider.id,await sign(user,outsider),adapters),/transfers_disabled/);
   const draft=await createTransfer(owner,{...input,amount:'0.000001'},randomUUID(),adapters);
   const accepted=await submitTransfer(owner,draft.id,await sign(user,draft),adapters);
   const count=broadcasts.length;
   await processTransfer(accepted.id,{db,rpc});assert.equal(broadcasts.length,count+1);
   const list=async userId=>JSON.parse((await createTransfersHandler({db,authenticate:async()=>userId,networkFee:async()=>'0.006'})({httpMethod:'GET',path:'/transfers'})).body);
   const ownerList=await list(owner);
   assert.equal(ownerList.enabled,true);assert.equal(ownerList.networkFeeUsdc,'0.006');assert.equal(ownerList.quota,undefined);
   assert.equal((await list('outside-pilot')).enabled,false);
   delete process.env.TRANSFERS_ALLOWED_USER_IDS;
   await processTransfer(accepted.id,{db,rpc});assert.equal(broadcasts.length,count+1);
  }finally{process.env.TRANSFERS_ENABLED='true';delete process.env.TRANSFERS_ALLOWED_USER_IDS;}
 });
});

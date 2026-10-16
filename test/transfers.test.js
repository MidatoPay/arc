import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {generateKeyPairSigner,getTransactionDecoder,getTransactionEncoder,partiallySignTransaction,getPublicKeyFromAddress,verifySignature} from '@solana/kit';
import {NETWORK} from '../src/network.js';
import {exactUsdc} from '../src/transfers.js';
import {prepareTransfer,validateUserSignature,signSponsoredTransfer,sourceBalance,tokenAddress} from '../netlify/functions/lib/transferChain.js';
import {createTransfer,submitTransfer,cancelUnsignedTransfer,transferQuota,transferDay,publicTransfer,transferQuote} from '../netlify/functions/lib/transferService.js';
import {transfersEnabledFor,assertTransfersEnabled} from '../netlify/functions/lib/transferAccess.js';
import {processTransfer} from '../netlify/functions/lib/transferWorker.js';
import {listUserActivity} from '../netlify/functions/lib/paymentActivity.js';
import {createTransfersHandler} from '../netlify/functions/transfers.js';
import {PaymentError} from '../netlify/functions/lib/paymentCore.js';

test('amounts use exact six-decimal units and Argentina days reset at 03:00 UTC',()=>{
 assert.equal(exactUsdc('0,000001'),'0.000001');assert.equal(exactUsdc('0.123031'),'0.123031');
 for(const value of ['0','0.0000001','1e-6','-1','NaN'])assert.throws(()=>exactUsdc(value));
 assert.deepEqual(transferDay(new Date('2026-10-16T02:59:59Z')),{day:'2026-10-15',resetsAt:'2026-10-16T03:00:00.000Z'});
 assert.equal(transferDay(new Date('2026-10-16T03:00:00Z')).day,'2026-10-16');
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
test('primary USDC transfers preserve signatures, reserve quota/budget and complete only on verified finalization',async t=>{
 const engine=new PGlite();await engine.waitReady;t.after(()=>engine.close());
 const base=(await readFile('db/schema.sql','utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;','');await engine.exec(base);
 for(const file of ['20261013_mercadopago.sql','20261016_charge_paid_at.sql','20261016_merchant_profiles.sql','20261016_wallet_transfers.sql'])
  await engine.exec(await readFile(`db/migrations/${file}`,'utf8'));
 await engine.exec(await readFile('db/migrations/20261016_wallet_transfers.sql','utf8'));
 let tail=Promise.resolve();
 const query=async(sql,params)=>{const r=await engine.query(sql,params);return {...r,rowCount:r.affectedRows ?? r.rows.length};};
 const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};}};
 const user=await generateKeyPairSigner(),treasury=await generateKeyPairSigner(),recipient=await generateKeyPairSigner();
 const old={enabled:process.env.TRANSFERS_ENABLED,allowed:process.env.TRANSFERS_ALLOWED_USER_IDS,budget:process.env.TRANSFER_DAILY_SOL_BUDGET,max:process.env.TRANSFER_MAX_SOL_COST};
 process.env.TRANSFERS_ENABLED='true';delete process.env.TRANSFERS_ALLOWED_USER_IDS;delete process.env.TRANSFER_DAILY_SOL_BUDGET;delete process.env.TRANSFER_MAX_SOL_COST;
 t.after(()=>{for(const [key,value] of Object.entries({TRANSFERS_ENABLED:old.enabled,TRANSFERS_ALLOWED_USER_IDS:old.allowed,TRANSFER_DAILY_SOL_BUDGET:old.budget,TRANSFER_MAX_SOL_COST:old.max}))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 let height=10,balance=10000000n,simulationError=null,status=null,transaction=null,networkGenesis=NETWORK.genesis;
 const broadcasts=[];
 const rpc=async(method,params)=>{
  if(method==='getGenesisHash')return networkGenesis;
  if(method==='getLatestBlockhash')return {value:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:height+100}};
  if(method==='getAccountInfo')return {value:null};
  if(method==='getFeeForMessage')return {value:10000};
  if(method==='getMinimumBalanceForRentExemption')return 2039280;
  if(method==='getBlockHeight')return height;
  if(method==='getBalance'){assert.equal(params[0],treasury.address,'Only the treasury needs SOL');return {value:1000000000};}
  if(method==='simulateTransaction')return {value:{err:simulationError}};
  if(method==='getSignatureStatuses')return {value:[status]};
  if(method==='getTransaction')return transaction;
  if(method==='sendTransaction'){
   const saved=(await query('SELECT signed_wire FROM wallet_transfers WHERE signed_wire=$1',[params[0]])).rows;
   assert.equal(saved.length,1,'Durable commit before broadcast');broadcasts.push(params[0]);return 'accepted';
  }
  throw new Error(`Unexpected RPC ${method}`);
 };
 const adapters={db,rpc,primary:async()=>({address:user.address}),balance:async()=>balance,quote:async()=> '1600',
  prepare:input=>prepareTransfer(input,{rpc,signer:async()=>treasury}),
  sign:(prepared,tx)=>signSponsoredTransfer(prepared,tx,{signer:async()=>treasury})};
 const input={from:user.address,to:recipient.address,amount:'0.123031',kind:'pay'};
 const userSigned=async prepared=>Buffer.from(getTransactionEncoder().encode(await partiallySignTransaction([user.keyPair],getTransactionDecoder().decode(Buffer.from(prepared.unsigned_wire,'base64'))))).toString('base64');
 let first;
 await t.test('preparation is exact, user-owned and idempotent without consuming quota',async()=>{
  const key=randomUUID();first=await createTransfer('owner',input,key,adapters);
  assert.equal(String(first.usdc_raw),'123031');assert.equal(String(first.cost_lamports),'2049280');
  assert.equal((await createTransfer('owner',input,key,adapters)).id,first.id);
  await assert.rejects(async()=>createTransfer('owner',{...input,amount:'1'},key,adapters),/idempotency_conflict/);
  await assert.rejects(async()=>createTransfer('owner',{...input,from:treasury.address},randomUUID(),adapters),/primary_wallet_required/);
  assert.equal((await transferQuota(db,'owner')).remaining,2);
  assert.equal(broadcasts.length,0);
 });
 await t.test('message tampering, wrong signatures, ownership and failed simulation cannot consume quota or broadcast',async()=>{
  const unsigned=first.unsigned_wire;
  await assert.rejects(async()=>validateUserSignature(first,unsigned),/invalid_user_signature/);
  const altered=await prepareTransfer({...input,raw:'2',memo:'changed'},{rpc,signer:async()=>treasury});
  await assert.rejects(async()=>validateUserSignature(first,await userSigned(altered)),/transfer_message_changed/);
  await assert.rejects(async()=>submitTransfer('another',first.id,await userSigned(first),adapters),/transfer_not_found/);
  simulationError={InstructionError:[1,'InsufficientFunds']};
  await assert.rejects(async()=>submitTransfer('owner',first.id,await userSigned(first),adapters),/transfer_simulation_failed/);
  simulationError=null;
  assert.equal((await transferQuota(db,'owner')).remaining,2);assert.equal(broadcasts.length,0);
 });
 await t.test('submission stores both signatures before worker broadcast and retries consume no extra quota',async()=>{
  first=await submitTransfer('owner',first.id,await userSigned(first),adapters);
  assert.equal(first.status,'broadcasting');assert.ok(first.signature);
  const full=getTransactionDecoder().decode(Buffer.from(first.signed_wire,'base64'));
  assert.equal(await verifySignature(await getPublicKeyFromAddress(treasury.address),full.signatures[treasury.address],full.messageBytes),true);
  assert.equal(broadcasts.length,0);assert.equal((await transferQuota(db,'owner')).remaining,1);
  const repeated=await submitTransfer('owner',first.id,'ignored-on-recovery',adapters);assert.equal(repeated.signature,first.signature);
  await processTransfer(first.id,{db,rpc});await processTransfer(first.id,{db,rpc});
  assert.equal(broadcasts.length,2);assert.equal(broadcasts[0],broadcasts[1]);
  assert.equal((await transferQuota(db,'owner')).remaining,1);
  assert.ok(!JSON.stringify(publicTransfer(first)).includes(first.signed_wire));
  const activity=await listUserActivity(db,'owner',NETWORK.cluster);assert.equal(activity[0].source,'transfer');assert.equal(activity[0].settled,false);
 });
 await t.test('confirmed is not completed; finalized chain proof creates one ledger row and one Activity row',async()=>{
  status={confirmationStatus:'confirmed',slot:99,err:null};await processTransfer(first.id,{db,rpc});
  assert.equal((await query('SELECT status FROM wallet_transfers WHERE id=$1',[first.id])).rows[0].status,'confirmed');
  assert.equal((await query('SELECT * FROM transactions')).rows.length,0);
  status={confirmationStatus:'finalized',slot:99,err:null};
  transaction={meta:{err:null},transaction:{message:{instructions:[{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',parsed:{type:'transferChecked',info:{
   source:await tokenAddress(user.address),destination:await tokenAddress(recipient.address),authority:user.address,mint:NETWORK.mint,tokenAmount:{amount:'123031',decimals:6}}}}]}}};
  await processTransfer(first.id,{db,rpc});await processTransfer(first.id,{db,rpc});
  assert.equal((await query('SELECT status FROM wallet_transfers WHERE id=$1',[first.id])).rows[0].status,'completed');
  const ledger=(await query('SELECT * FROM transactions')).rows;assert.equal(ledger.length,1);assert.equal(Number(ledger[0].amt),0.123031);assert.equal(Number(ledger[0].fee),0);
  const activity=await listUserActivity(db,'owner',NETWORK.cluster);assert.equal(activity.length,1);assert.equal(activity[0].settled,true);
 });
 await t.test('two accepted attempts block the third across modalities, and on-chain failures still consume a sponsored attempt',async()=>{
  const second=await createTransfer('owner',{...input,amount:'0.000001',kind:'voice'},randomUUID(),adapters);
  await submitTransfer('owner',second.id,await userSigned(second),adapters);
  assert.equal((await transferQuota(db,'owner')).remaining,0);
  await assert.rejects(async()=>createTransfer('owner',{...input,kind:'charge_p2p'},randomUUID(),adapters),/transfer_daily_limit/);
  status={confirmationStatus:'finalized',err:{InstructionError:[1,'Error']}};await processTransfer(second.id,{db,rpc});
  assert.equal((await query('SELECT status FROM wallet_transfers WHERE id=$1',[second.id])).rows[0].status,'failed');
  assert.equal((await transferQuota(db,'owner')).remaining,0);
 });
 await t.test('cancellation, refreshed unsigned messages and budget caps prevent unauthorized or excessive sponsorship',async()=>{
  const draft=await createTransfer('fresh-user',input,randomUUID(),adapters);
  await cancelUnsignedTransfer('fresh-user',draft.id,adapters);
  await assert.rejects(async()=>submitTransfer('fresh-user',draft.id,await userSigned(draft),adapters),/transfer_not_signable/);
  const key=randomUUID(),expired=await createTransfer('fresh-user',input,key,adapters);height=200;
  const refreshed=await createTransfer('fresh-user',input,key,adapters);assert.equal(refreshed.id,expired.id);assert.equal(String(refreshed.last_valid_block_height),'300');
  process.env.TRANSFER_DAILY_SOL_BUDGET='0.003';
  await assert.rejects(async()=>submitTransfer('fresh-user',refreshed.id,await userSigned(refreshed),adapters),/transfer_budget_exhausted/);
  delete process.env.TRANSFER_DAILY_SOL_BUDGET;
  balance=0n;await assert.rejects(async()=>submitTransfer('fresh-user',refreshed.id,await userSigned(refreshed),adapters),/insufficient_usdc/);balance=10000000n;
  const previousEnabled=process.env.TRANSFERS_ENABLED;process.env.TRANSFERS_ENABLED='false';
  await assert.rejects(async()=>submitTransfer('fresh-user',refreshed.id,await userSigned(refreshed),adapters),/transfers_disabled/);process.env.TRANSFERS_ENABLED=previousEnabled;
 });
 await t.test('expired ambiguous wires remain reserved and paused workers never broadcast',async()=>{
  const draft=await createTransfer('third-user',input,randomUUID(),adapters);
  const submitted=await submitTransfer('third-user',draft.id,await userSigned(draft),adapters);
  status=null;height=1000;const count=broadcasts.length;
  await processTransfer(submitted.id,{db,rpc});
  const stored=(await query('SELECT * FROM wallet_transfers WHERE id=$1',[submitted.id])).rows[0];
  assert.equal(stored.status,'manual_review');assert.equal(stored.signature,submitted.signature);assert.equal(broadcasts.length,count);
  process.env.TRANSFERS_ENABLED='false';await processTransfer(submitted.id,{db,rpc});assert.equal(broadcasts.length,count);process.env.TRANSFERS_ENABLED='true';
 });
 await t.test('RPC network checks reject the wrong chain before reading spendable balances',async()=>{
  networkGenesis='wrong';await assert.rejects(async()=>sourceBalance(user.address,rpc),/solana_rpc_network_mismatch/);networkGenesis=NETWORK.genesis;
 });
 await t.test('parallel submissions serialize daily quota and never authorize a third transfer',async()=>{
  height=2000;status=null;
  const drafts=await Promise.all(Array.from({length:3},()=>createTransfer('parallel-user',{...input,amount:'0.000001'},randomUUID(),adapters)));
  const signed=await Promise.all(drafts.map(userSigned));
  const outcomes=await Promise.allSettled(drafts.map((draft,index)=>submitTransfer('parallel-user',draft.id,signed[index],adapters)));
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,2);
  assert.equal(outcomes.find(outcome=>outcome.status==='rejected').reason.code,'transfer_daily_limit');
  assert.equal((await transferQuota(db,'parallel-user')).used,2);
 });
 await t.test('a failed durable commit never transmits and rolls back quota, while transport failures reuse the saved wire',async()=>{
  const draft=await createTransfer('disk-user',input,randomUUID(),adapters);
  const faulty={...db,connect:async()=>{const client=await db.connect();return {...client,query:(sql,args)=>{
   if(sql.includes('SET signature=$2'))throw new Error('disk_unavailable');return client.query(sql,args);
  }};}};
  const count=broadcasts.length;
  await assert.rejects(async()=>submitTransfer('disk-user',draft.id,await userSigned(draft),{...adapters,db:faulty}),/disk_unavailable/);
  assert.equal((await transferQuota(db,'disk-user')).used,0);assert.equal(broadcasts.length,count);
  const accepted=await submitTransfer('disk-user',draft.id,await userSigned(draft),adapters);
  const failAfterBroadcast=async(method,args)=>{const result=await rpc(method,args);if(method==='sendTransaction')throw new Error('response_lost');return result;};
  await processTransfer(accepted.id,{db,rpc:failAfterBroadcast});await processTransfer(accepted.id,{db,rpc});
  assert.equal(broadcasts.at(-1),accepted.signed_wire);assert.equal(broadcasts.at(-2),accepted.signed_wire);
  assert.equal((await transferQuota(db,'disk-user')).used,1);
 });
 await t.test('production pilot enables only its owner through preparation, submit, availability and worker broadcast',async()=>{
  const outsider=await createTransfer('outside-pilot',input,randomUUID(),adapters);
  const owner='did:privy:pilot';process.env.TRANSFERS_ENABLED='false';process.env.TRANSFERS_ALLOWED_USER_IDS=owner;
  try {
   await assert.rejects(()=>createTransfer('outside-pilot',input,randomUUID(),adapters),/transfers_disabled/);
   await assert.rejects(async()=>submitTransfer('outside-pilot',outsider.id,await userSigned(outsider),adapters),/transfers_disabled/);
   const draft=await createTransfer(owner,{...input,amount:'0.000001'},randomUUID(),adapters);
   const accepted=await submitTransfer(owner,draft.id,await userSigned(draft),adapters);
   const count=broadcasts.length;status=null;
   await processTransfer(accepted.id,{db,rpc});assert.equal(broadcasts.length,count+1);
   const availability=async userId=>JSON.parse((await createTransfersHandler({db,authenticate:async()=>userId})({httpMethod:'GET',path:'/transfers'})).body).enabled;
   assert.equal(await availability(owner),true);assert.equal(await availability('outside-pilot'),false);
   delete process.env.TRANSFERS_ALLOWED_USER_IDS;
   await processTransfer(accepted.id,{db,rpc});assert.equal(broadcasts.length,count+1);
  }finally{process.env.TRANSFERS_ENABLED='true';delete process.env.TRANSFERS_ALLOWED_USER_IDS;}
 });
 await t.test('token account checks enforce owner, program, mint, decimals and state without requiring user SOL',async()=>{
  const valid={owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{info:{owner:user.address,mint:NETWORK.mint,state:'initialized',tokenAmount:{amount:'123031',decimals:6}}}}};
  const tokenRpc=account=>async(method)=>{if(method==='getGenesisHash')return NETWORK.genesis;if(method==='getAccountInfo')return {value:account};assert.fail('Must not request user SOL');};
  assert.equal(await sourceBalance(user.address,tokenRpc(valid)),123031n);
  for(const property of [{mint:recipient.address},{owner:recipient.address},{state:'frozen'},{tokenAmount:{amount:'1',decimals:9}}]) {
   const invalid=structuredClone(valid);Object.assign(invalid.data.parsed.info,property);
   await assert.rejects(()=>sourceBalance(user.address,tokenRpc(invalid)),/invalid_usdc_account/);
  }
 });
});

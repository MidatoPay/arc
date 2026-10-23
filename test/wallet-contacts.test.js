import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {primaryArcWallet} from '../src/primaryWallet.js';
import {resolveRecipient,findByAlias,recipientCandidates} from '../src/contacts.js';
import {createContactsHandler} from '../netlify/functions/contacts.js';
import {createTreasuryExportAccessHandler} from '../netlify/functions/treasury-export-access.js';
import {syncPrimaryWallet} from '../netlify/functions/lib/primaryWallet.js';
import {PaymentError} from '../netlify/functions/lib/paymentCore.js';
const main='0x8ba1f109551bD432803012645Ac136ddd64DBA72',other='0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const legacy='25uPNxXCXSDRAct1tFGFBtEWQr3xUL9pdEmBzWSXwHGd';
const account=(address,index)=>({id:`wallet-${index}`,type:'wallet',walletClientType:'privy',chainType:'ethereum',address,hdWalletIndex:index});
test('primary identity is HD zero, never the first, external, unknown or ambiguous wallet',()=>{
 assert.equal(primaryArcWallet({linkedAccounts:[account(other,1),account(main,0)]}).address,main);
 assert.equal(primaryArcWallet({linkedAccounts:[{...account(main,0),hdWalletIndex:undefined,walletIndex:0}]}).address,main);
 assert.equal(primaryArcWallet({linkedAccounts:[{...account(main,0),walletIndex:1}]}),null);
 assert.equal(primaryArcWallet({linkedAccounts:[account(other,1)]}),null);
 assert.equal(primaryArcWallet({linkedAccounts:[{...account(main,0),hdWalletIndex:undefined}]}),null);
 assert.equal(primaryArcWallet({linkedAccounts:[account(main,0),account(other,0)]}),null);
 assert.equal(primaryArcWallet({linkedAccounts:[{...account(main,0),walletClientType:'phantom'}]}),null);
});
test('a pasted address always wins over an alias substring and voice ambiguity never selects a wallet',()=>{
 const list=[{alias:'p',name:'Pedro',addr:other},{alias:'ana',name:'Ana',addr:main},
  {alias:'legacy',name:'Old',addr:legacy}];
 assert.equal(resolveRecipient(list,main).addr,main);
 assert.equal(findByAlias(list,'anabela'),null);
 assert.equal(findByAlias(list,'@ANA').addr,main);
 assert.equal(findByAlias(list,'legacy'),null);
 assert.equal(findByAlias([...list,{alias:'another',name:'Ana',addr:other}],'Ana').addr,main);
 const ambiguous=[{alias:'a1',name:'Duplicado',addr:main},{alias:'a2',name:'Duplicado',addr:other}];
 assert.equal(findByAlias(ambiguous,'Duplicado'),null);assert.equal(recipientCandidates(ambiguous,'Duplicado').length,2);
});
test('contacts persist per owner, reject malformed input and retain legacy addresses as incompatible',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 const base=(await readFile('db/schema.sql','utf8')).split('-- Historial de transacciones')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;','');
 await db.exec(base);
 let user='alice';const handler=createContactsHandler({db,authenticate:async()=>user});
 const request=async(method,body)=>{const response=await handler({httpMethod:method,body:JSON.stringify(body)});return {status:response.statusCode,...JSON.parse(response.body)};};
 const data={name:'Ana',alias:'Ana',address:main};
 const created=await request('POST',data);assert.equal(created.status,200);
 assert.equal((await request('POST',{...data,alias:'ANA'})).error,'alias_duplicate');
 for(const invalid of [{...data,address:'bad'},{...data,name:13},{...data,alias:[]},null])assert.equal((await request('POST',invalid)).status,400);
 user='bob';assert.equal((await request('GET')).contacts.length,0);
 assert.equal((await request('PUT',{...data,id:created.contact.id})).status,404);
 assert.equal((await request('DELETE',{id:created.contact.id})).status,404);
 user='alice';assert.equal((await request('PUT',{...data,id:created.contact.id,name:'Edited'})).contact.name,'Edited');
 await db.query("INSERT INTO contacts(user_id,name,alias,address) VALUES('alice','Legacy','legacy',$1)",[legacy]);
 const list=(await request('GET')).contacts;assert.equal(list.find(c=>c.alias==='legacy').arcCompatible,false);
 assert.equal((await request('DELETE',{id:created.contact.id})).status,200);
});
test('treasury export access is denied by role before querying primary or treasury',async()=>{
 const handler=createTreasuryExportAccessHandler({authenticate:async()=> 'ordinary',assertAdmin:()=>{throw new PaymentError('admin_required',403);},
  primary:()=>assert.fail('Must not resolve'),treasury:()=>assert.fail('Must not query')});
 assert.equal((await handler({httpMethod:'GET'})).statusCode,403);
 for(const address of [main,other]) {
  const admin=createTreasuryExportAccessHandler({authenticate:async()=> 'admin',assertAdmin:()=>{},primary:async()=>({address:main}),treasury:async()=>address});
  const response=await admin({httpMethod:'GET'});assert.equal(JSON.parse(response.body).authorized,address===main);
 }
});
test('primary synchronization audits the changed mapping and resets the checkpoint without touching charges',async t=>{
 const engine=new PGlite();await engine.waitReady;t.after(()=>engine.close());
 await engine.exec(`CREATE TABLE wallets(user_id text,network text,address text,last_synced_block bigint,updated_at timestamptz,PRIMARY KEY(user_id,network));
 CREATE TABLE wallet_identity_audit(user_id text,network text,previous_address text,primary_address text);
 ALTER TABLE wallets ADD COLUMN privy_wallet_id text; ALTER TABLE wallets ADD COLUMN hd_wallet_index int;`);
 const db={query:(...args)=>engine.query(...args),connect:async()=>({query:(...args)=>engine.query(...args),release(){}})};
 await db.query("INSERT INTO wallets(user_id,network,address,last_synced_block) VALUES('owner','arc-mainnet',$1,10)",[other]);
 const adapters={db,network:'arc-mainnet',getUser:async()=>({linkedAccounts:[account(other,1),account(main,0)]})};
 await syncPrimaryWallet('owner',adapters);await syncPrimaryWallet('owner',adapters);
 const row=(await db.query('SELECT * FROM wallets')).rows[0];assert.equal(row.address,main);assert.equal(row.last_synced_block,null);
 assert.equal((await db.query('SELECT * FROM wallet_identity_audit')).rows.length,1);
});

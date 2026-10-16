import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createMerchantProfileHandler } from '../netlify/functions/merchant-profile.js';
import { PaymentError } from '../netlify/functions/lib/paymentCore.js';
import { userDisplayName, merchantDisplayName } from '../src/merchantIdentity.js';

test('merchant name prefers a business name and falls back to the Privy user name', () => {
  assert.equal(userDisplayName({email:{address:'juan.perez@example.com'}}),'Juan');
  assert.equal(userDisplayName({google:{name:'Juan Pérez'}}),'Juan Pérez');
  assert.equal(userDisplayName({linkedAccounts:[{type:'google_oauth',name:'Ana'}]}),'Ana');
  assert.equal(userDisplayName(null),'Usuario');
  assert.equal(merchantDisplayName('  Mi tienda  ','Juan'),'Mi tienda');
  assert.equal(merchantDisplayName(null,'Juan'),'Juan');
  assert.equal(merchantDisplayName('  ','Juan'),'Juan');
});

test('profile authentication rejects access before reading Privy or the database', async () => {
  const handler = createMerchantProfileHandler({authenticate:async()=>{throw new PaymentError('unauthorized',401);},
    getUser:()=>assert.fail('Must not query Privy'),db:{query:()=>assert.fail('Must not query DB')}});
  assert.equal((await handler({httpMethod:'GET'})).statusCode,401);
});

test('business profiles persist per authenticated Privy user and clearing restores the user name', async t => {
  const engine = new PGlite();await engine.waitReady;t.after(()=>engine.close());
  const migration = await readFile(new URL('../db/migrations/20261016_merchant_profiles.sql',import.meta.url),'utf8');
  await engine.exec(migration);await engine.exec(migration);
  let currentUser='did:privy:alice';
  const handler = createMerchantProfileHandler({db:engine,authenticate:async()=>currentUser,
    getUser:async id=>({email:{address:id==='did:privy:alice'?'alice@example.com':'bob@example.com'}})});
  const request = async (httpMethod,body) => {
    const response = await handler({httpMethod,body:JSON.stringify(body)});
    return {status:response.statusCode,...JSON.parse(response.body)};
  };
  assert.deepEqual((await request('GET')).profile,{userName:'Alice',businessName:null,displayName:'Alice'});
  assert.equal((await request('PATCH',{businessName:'  Café Ámbar  '})).profile.displayName,'Café Ámbar');
  assert.equal((await request('GET')).profile.businessName,'Café Ámbar');
  currentUser='did:privy:bob';
  assert.equal((await request('GET')).profile.businessName,null);
  assert.equal((await request('PATCH',{businessName:'Bob Shop'})).profile.userName,'Bob');
  assert.equal((await request('PATCH',{businessName:'Injected',user_id:'did:privy:alice'})).status,400);
  currentUser='did:privy:alice';
  assert.equal((await request('GET')).profile.businessName,'Café Ámbar');
  assert.equal((await request('PATCH',{businessName:'   '})).profile.displayName,'Alice');
  assert.equal((await request('GET')).profile.businessName,null);
  assert.equal((await request('PATCH',{businessName:null})).profile.displayName,'Alice');
  for (const body of [null,[],{}, {businessName:12},{businessName:'x'.repeat(101)},
    {businessName:'name\u0000'}, {businessName:'x',userName:'Forged'}])
    assert.equal((await request('PATCH',body)).status,400);
  assert.equal((await handler({httpMethod:'PATCH',body:'{'})).statusCode,400);
  assert.equal((await request('DELETE')).status,405);
  assert.equal((await engine.query('SELECT count(*)::int AS count FROM merchant_profiles')).rows[0].count,2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ensureMerchantPos,merchantEmail,merchantPosIdentity } from "../netlify/functions/lib/merchantPos.js";
import { assertChargeConfig } from "../netlify/functions/lib/paymentService.js";

const settings={environment:"production",network:"mainnet-beta",seller:"123",store:"456",token:"test-only"};
test("POS identities isolate Privy users and environments; email labels comply with provider restrictions",()=>{
  assert.equal(merchantEmail({linkedAccounts:[{type:"email",address:"user@example.com"}]}),"user@example.com");
  assert.throws(()=>merchantEmail({linkedAccounts:[]}),{code:"merchant_email_required"});
  const first=merchantPosIdentity("u1",settings,"user@example.com");
  assert.equal(first.name,"user example com");assert.match(first.externalId,/^[A-Za-z0-9]{1,40}$/);
  assert.equal(first.externalId,merchantPosIdentity("u1",settings,"changed@example.com").externalId);
  assert.notEqual(first.externalId,merchantPosIdentity("u2",settings,"user@example.com").externalId);
  assert.notEqual(first.externalId,merchantPosIdentity("u1",{...settings,environment:"test"},"user@example.com").externalId);
  assert.ok(merchantPosIdentity("u1",settings,"a".repeat(100)+"@example.com").name.length<=45);
});
test("reconciliation preserves the POS saved on each charge, including legacy operations",()=>{
  const charge={environment:"production",network:"mainnet-beta",seller_id:"123",pos_id:"OWNPOS",treasury_address:"wallet",
    order_body:{config:{qr:{external_pos_id:"OWNPOS"}}}};
  assert.doesNotThrow(()=>assertChargeConfig(charge,{...settings,pos:"OTHER"},"wallet"));
  assert.throws(()=>assertChargeConfig({...charge,seller_id:"other"},settings),{code:"charge_configuration_changed"});
  assert.throws(()=>assertChargeConfig({...charge,pos_id:"OTHER"},settings),{code:"charge_configuration_changed"});
});
test("durable per-merchant creation handles concurrency, timeouts and changed profiles without duplicate POS",async(t)=>{
  const engine=new PGlite();await engine.waitReady;t.after(()=>engine.close());
  const sql=await readFile(new URL("../db/migrations/20261014_merchant_pos.sql",import.meta.url),"utf8");
  await engine.exec(sql);await engine.exec(sql);
  const assignmentSql=await readFile(new URL("../db/migrations/20261014_merchant_pos_assignments.sql",import.meta.url),"utf8");
  await engine.exec(assignmentSql);await engine.exec(assignmentSql);
  const query=async(sql,params=[])=>{const r=await engine.query(sql,params);return {...r,rowCount:r.affectedRows || r.rows.length};};
  let tail=Promise.resolve();
  const pool={query,connect:async()=>{const prior=tail;let release;tail=new Promise(r=>release=r);await prior;return {query,release};}};
  const before=process.env.PAYMENTS_ENABLED;process.env.PAYMENTS_ENABLED="true";
  t.after(()=>{if(before===undefined)delete process.env.PAYMENTS_ENABLED;else process.env.PAYMENTS_ENABLED=before;});
  let posts=0,timeout=false,email="user@example.com";const remote=new Map(),bodies=[];
  const adapters={db:pool,verifySeller:async()=>{},verifyStore:async()=>{},getUser:async()=>({email:{address:email}}),request:async(path,s,options={})=>{
    if(!options.method){const ext=new URL("https://example.invalid"+path).searchParams.get("external_id");return {data:remote.has(ext)?[remote.get(ext)]:[]};}
    posts++;const body=JSON.parse(options.body);bodies.push({body,key:options.headers["X-Idempotency-Key"]});
    const intent=(await query("SELECT * FROM merchant_payment_pos WHERE external_id=$1",[body.external_id])).rows[0];
    assert.ok(intent);assert.equal(intent.creation_key,options.headers["X-Idempotency-Key"]);
    const pos={id:100+posts,user_id:123,store_id:body.store_id,external_id:body.external_id,config:body.config,status:"active"};
    remote.set(body.external_id,pos);
    if(timeout){timeout=false;throw new Error("timeout-after-create");}return pos;
  }};
  await t.test("concurrent first login creates and persists exactly one POS",async()=>{
    const results=await Promise.all([ensureMerchantPos("u1",settings,adapters),ensureMerchantPos("u1",settings,adapters)]);
    assert.equal(results[0].pos_id,results[1].pos_id);assert.equal(posts,1);assert.equal(results[0].merchant_email,email);
  });
  await t.test("two merchants get distinct POS and ready mappings survive profile changes",async()=>{
    const second=await ensureMerchantPos("u2",settings,adapters);email="changed@example.com";
    const first=await ensureMerchantPos("u1",settings,adapters);
    assert.notEqual(second.external_id,first.external_id);assert.equal(posts,2);assert.equal(first.merchant_email,"user@example.com");
  });
  await t.test("timeout after external creation recovers the existing POS without another POST",async()=>{
    timeout=true;await assert.rejects(()=>ensureMerchantPos("u3",settings,adapters),/timeout-after-create/);
    const pending=(await query("SELECT * FROM merchant_payment_pos WHERE user_id='u3'")).rows[0];
    assert.equal(pending.status,"creating");const count=posts;
    const recovered=await ensureMerchantPos("u3",settings,adapters);
    assert.equal(recovered.status,"ready");assert.equal(posts,count);assert.equal(recovered.creation_key,pending.creation_key);
  });
  await t.test("retry retains creation key and payload when a lost response is not yet searchable",async()=>{
    timeout=true;await assert.rejects(()=>ensureMerchantPos("u4",settings,adapters));
    const last=bodies.at(-1);remote.delete(last.body.external_id);email="another@example.com";
    await ensureMerchantPos("u4",settings,adapters);
    assert.deepEqual(bodies.at(-1),last);
  });
  await t.test("missing email or store cannot create a provider POS",async()=>{
    const count=posts;
    await assert.rejects(()=>ensureMerchantPos("u5",{...settings,store:undefined},adapters),{code:"missing_mp_store_id"});
    await assert.rejects(()=>ensureMerchantPos("u6",settings,{...adapters,getUser:async()=>({})}),{code:"merchant_email_required"});
    assert.equal(posts,count);
  });
  await t.test("a recovered POS from a different store cannot become ready",async()=>{
    const bad={...adapters,request:async(path,s,options={})=>{
      assert.ok(!options.method);
      const external_id=new URL("https://example.invalid"+path).searchParams.get("external_id");
      return {data:[{id:999,user_id:123,store_id:"OTHER",external_id,config:{qr:{operating_mode:"pdv"}}}]};
    }};
    await assert.rejects(()=>ensureMerchantPos("u7",settings,bad),{code:"merchant_pos_mismatch"});
    assert.equal((await query("SELECT status FROM merchant_payment_pos WHERE user_id='u7'")).rows[0].status,"creating");
  });
  await t.test("a legacy POS reserved by email binds to the server-verified Privy user and never creates a new POS",async()=>{
    email="reserved@example.com";
    await query(`INSERT INTO merchant_pos_assignments(environment,seller_id,merchant_email,external_id,pos_id,store_id,pos_name)
      VALUES('production','123','reserved@example.com','LEGACYPOS','999','456','Legacy')`);
    const count=posts;
    const mapped=await ensureMerchantPos("legacy-user",settings,adapters);
    assert.equal(mapped.external_id,"LEGACYPOS");assert.equal(mapped.status,"ready");assert.equal(posts,count);
    const saved=(await query("SELECT * FROM merchant_pos_assignments WHERE external_id='LEGACYPOS'")).rows[0];
    assert.equal(saved.claimed_user_id,"legacy-user");assert.ok(saved.claimed_at);
    await ensureMerchantPos("legacy-user",settings,adapters);assert.equal(posts,count);
    await assert.rejects(()=>ensureMerchantPos("other-user",settings,adapters),{code:"merchant_pos_already_assigned"});
    assert.equal((await query("SELECT * FROM merchant_payment_pos WHERE user_id='other-user'")).rowCount,0);
  });
  await t.test("an assignment can replace a merchant default without changing historical orders",async()=>{
    email="user@example.com";
    await query(`INSERT INTO merchant_pos_assignments(environment,seller_id,merchant_email,external_id,pos_id,store_id,pos_name)
      VALUES('production','123','user@example.com','REUSEPOS','1000','456','Existing')`);
    const count=posts;
    const mapped=await ensureMerchantPos("u1",settings,adapters);
    assert.equal(mapped.external_id,"REUSEPOS");assert.equal(mapped.order_body,undefined);
    assert.equal(mapped.creation_body.external_id,"REUSEPOS");assert.equal(posts,count);
  });
});

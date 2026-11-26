import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFactoringDb } from './factoring-db.js';
import { makeCuit, cvu } from './factoring-fixtures.js';
import { inspectFactoringDatabase, inspectPaymentDatabase } from '../netlify/functions/lib/paymentDatabase.js';

const hex64 = c => c.repeat(64);

async function seed(db) {
  const party = async (role, extra = {}) => (await db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,investor_type,
    kyc_status,tw_customer_id,cvu,terms_accepted_at) VALUES($1,$2,$3,$4,$5,'approved',$6,$7,now()) RETURNING id`,
  [extra.user || `did:privy:${role}`, role, extra.cuit || makeCuit('30', role.length * 1000000), `${role} SA`,
    role === 'investor' ? 'persona_juridica' : null, role === 'issuer' ? null : `cus_${role}`, role === 'debtor' ? null : cvu(role.length)])).rows[0].id;
  const issuer = await party('issuer'), debtor = await party('debtor'), investor = await party('investor');
  const invoice = randomUUID();
  await db.query(`INSERT INTO invoices(id,issuer_user_id,issuer_party_id,debtor_party_id,idempotency_key,source,simulated,is_fce,
    issuer_cuit,debtor_cuit,cbte_tipo,pto_vta,cbte_nro,issued_on,due_on,nominal_cents,invoice_salt,invoice_hash)
    VALUES($1,'did:privy:issuer',$2,$3,$4,'form',true,false,$5,$6,6,1,1,'2026-11-20','2026-12-20',1000000,$7,$8)`,
  [invoice, issuer, debtor, randomUUID(), makeCuit('30', 6000000), makeCuit('30', 5000000), hex64('a'), '0x' + hex64('b')]);
  return { issuer, debtor, investor, invoice };
}

async function take(db, { invoice, investor }, offer, overrides = {}) {
  const values = { advance: 972037, fee: 699, gain: 27264, ...overrides };
  const id = randomUUID();
  await db.query(`INSERT INTO invoice_takes(id,invoice_id,offer_id,investor_user_id,investor_party_id,investor_wallet,investor_cvu,
    issuer_cvu,fee_cvu,idempotency_key,taken_on,days,rate_bps,fee_bps,nominal_cents,discount_cents,advance_cents,fee_cents,
    investor_outlay_cents,investor_gain_cents,terms_hash,assignment_version,assignment_text,assignment_sha256,status)
    VALUES($1,$2,$3,'did:privy:investor',$4,$5,$6,$6,$6,$7,'2026-11-20',30,3500,250,1000000,$8,$9,$10,$11,$12,$13,'v0','x',$14,$15)`,
  [id, invoice, offer, investor, '0x' + '1'.repeat(40), cvu(9), randomUUID(), 1000000 - values.advance, values.advance, values.fee,
    values.advance + values.fee, values.gain, '0x' + hex64('c'), hex64('d'), overrides.status || 'paying']);
  return id;
}

test('the factoring migration is idempotent and its constraints hold the plan invariants', async t => {
  const { db, close } = await createFactoringDb();
  t.after(close);
  const ids = await seed(db);
  const { invoice } = ids;

  await t.test('inspection reports ready, then detects a missing table', async () => {
    assert.equal((await inspectFactoringDatabase(db)).ready, true);
    await db.query('ALTER TABLE factoring_chain_events RENAME TO factoring_chain_events_off');
    const missing = await inspectFactoringDatabase(db);
    assert.equal(missing.ready, false);
    assert.equal(missing.tables.find(row => row.table === 'factoring_chain_events').missingTable, true);
    await db.query('ALTER TABLE factoring_chain_events_off RENAME TO factoring_chain_events');
    assert.equal((await inspectPaymentDatabase(db)).ready, true);
  });

  await t.test('one active offer per invoice', async () => {
    const open = `INSERT INTO invoice_offers(invoice_id,status,rate_bps,fee_bps,opened_at,expires_at)
      VALUES($1,$2,3500,250,now(),now()+interval '72 hours') RETURNING id`;
    const first = (await db.query(open, [invoice, 'open'])).rows[0].id;
    await assert.rejects(() => db.query(open, [invoice, 'open']));
    await assert.rejects(() => db.query(open, [invoice, 'taken']));
    await db.query(open, [invoice, 'expired']);
    ids.offer = first;
  });

  await t.test('one active take per invoice and amounts that add up to the nominal', async () => {
    ids.take = await take(db, ids, ids.offer);
    await assert.rejects(() => take(db, ids, ids.offer), /invoice_takes_active_uidx|unique/i);
    await db.query("UPDATE invoice_takes SET status='failed_net' WHERE id=$1", [ids.take]);
    await assert.rejects(() => take(db, ids, ids.offer, { gain: 27265 }), /check/i);
    ids.take = await take(db, ids, ids.offer);
  });

  await t.test('orders are unique per environment, payer and idempotency key, and one live payment per invoice', async () => {
    const order = (purpose, key, extra = {}) => db.query(`INSERT INTO factoring_orders(id,invoice_id,take_id,purpose,environment,
      payer_customer_id,destination_cvu,amount_cents,idempotency_key,requested_by,client_key,status)
      VALUES($1,$2,$3,$4,'simulated','cus_investor',$5,100,$6,$7,$8,$9)`,
    [randomUUID(), invoice, ids.take, purpose, cvu(1), key, extra.by || null, extra.clientKey || null, extra.status || 'pending']);
    await order('net_to_issuer', 'midatopay-factoring-a');
    await assert.rejects(() => order('fee_to_midatopay', 'midatopay-factoring-a'));
    await assert.rejects(() => order('net_to_issuer', 'midatopay-factoring-b'));
    await order('fee_to_midatopay', 'midatopay-factoring-c');
    await assert.rejects(() => order('nominal_to_investor', 'midatopay-factoring-d'), /check/i);
    await order('nominal_to_investor', 'midatopay-factoring-d', { by: 'did:privy:debtor', clientKey: randomUUID() });
    await assert.rejects(() => order('nominal_to_investor', 'midatopay-factoring-e', { by: 'did:privy:debtor', clientKey: randomUUID() }));
    await db.query("UPDATE factoring_orders SET status='failed' WHERE idempotency_key='midatopay-factoring-d'");
    await order('nominal_to_investor', 'midatopay-factoring-e', { by: 'did:privy:debtor', clientKey: randomUUID() });
  });

  await t.test('duplicated invoices, debtors and invoices sent without a token are rejected', async () => {
    const row = (await db.query('SELECT * FROM invoices WHERE id=$1', [invoice])).rows[0];
    await assert.rejects(() => db.query(`INSERT INTO invoices(id,issuer_user_id,issuer_party_id,debtor_party_id,idempotency_key,source,
      simulated,is_fce,issuer_cuit,debtor_cuit,cbte_tipo,pto_vta,cbte_nro,issued_on,due_on,nominal_cents,invoice_salt,invoice_hash)
      VALUES($1,'did:privy:other',$2,$3,$4,'form',true,false,$5,$6,6,1,1,'2026-11-20','2026-12-20',5,$7,$8)`,
    [randomUUID(), row.issuer_party_id, row.debtor_party_id, randomUUID(), row.issuer_cuit, row.debtor_cuit, hex64('a'), '0x' + hex64('b')]),
    /unique|duplicate/i);
    await assert.rejects(() => db.query("UPDATE invoices SET status='enviada' WHERE id=$1", [invoice]), /check/i);
    await assert.rejects(() => db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,tw_customer_id,terms_accepted_at)
      SELECT 'did:privy:debtor2','debtor',cuit,'Otro','cus_x',now() FROM factoring_parties WHERE role='debtor'`));
    await assert.rejects(() => db.query(`INSERT INTO factoring_parties(user_id,role,cuit,legal_name,tw_customer_id,cvu,terms_accepted_at)
      VALUES('did:privy:inv2','investor',$1,'Inversor',$2,$3,now())`, [makeCuit('20', 3333333), 'cus_y', cvu(3)]), /check/i);
  });
});

test('payments inspection stays ready without the factoring migration', async t => {
  const { db, close } = await createFactoringDb({ factoring: false });
  t.after(close);
  assert.equal((await inspectPaymentDatabase(db)).ready, true);
  assert.equal((await inspectFactoringDatabase(db)).ready, false);
});

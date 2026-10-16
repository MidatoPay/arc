const columns={
  charges:["id","user_id","environment","network","seller_id","pos_id","amount_cents","fee_cents","usdc_raw","idempotency_key","order_body","order_id","signature","signed_wire","status","paid_at"],
  payment_inbox:["id","environment","event_key","order_id","payload","processed_at","quarantined"],
  payment_incidents:["id","charge_id","reason","resolved_at"],
  payment_user_blocks:["user_id","environment","reason"],
  commission_ledger:["charge_id","merchant_user_id","environment","network","fee_cents","earned_at"],
  merchant_payment_pos:["user_id","environment","seller_id","merchant_email","store_id","external_id","pos_id","creation_key","creation_body","status"],
  merchant_pos_assignments:["environment","seller_id","merchant_email","external_id","pos_id","store_id","pos_name","claimed_user_id","claimed_at"],
  transactions:["id","user_id","network","hash","charge_id","amt","fx_rate","ars","created_at"],
  wallets:["user_id","network","address","last_synced_block"],
};
const indexes=["transactions_user_network_hash_uidx","transactions_charge_uidx","charges_user_idx",
  "charges_jobs_idx","payment_inbox_pending_idx","commission_ledger_period_idx","charges_history_idx","transactions_history_idx"];

// Only catalog/permission reads; never reads transactions, emails, balances or secrets.
export async function inspectPaymentDatabase(db) {
  const checks=[];
  for(const [table,required] of Object.entries(columns)) {
    const info=await db.query(`SELECT to_regclass($1)::text AS name`,[table]);
    if(!info.rows[0].name){checks.push({table,ready:false,missingTable:true});continue;}
    const actual=await db.query(`SELECT a.attname AS name FROM pg_attribute a
      WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped`,[table]);
    const names=new Set(actual.rows.map(r=>r.name));
    const missingColumns=required.filter(name=>!names.has(name));
    const permissions=(await db.query(`SELECT has_table_privilege(current_user,to_regclass($1),'SELECT') AS can_select,
      has_table_privilege(current_user,to_regclass($1),'INSERT') AS can_insert,
      has_table_privilege(current_user,to_regclass($1),'UPDATE') AS can_update`,[table])).rows[0];
    const missingPermissions=Object.entries(permissions).filter(([,value])=>!value).map(([key])=>key.slice(4).toUpperCase());
    checks.push({table,ready:!missingColumns.length && !missingPermissions.length,missingColumns,missingPermissions});
  }
  const missingIndexes=[];
  for(const name of indexes) {
    const result=await db.query("SELECT to_regclass($1)::text AS name",[name]);
    if(!result.rows[0].name)missingIndexes.push(name);
  }
  return {ready:checks.every(c=>c.ready) && !missingIndexes.length,readOnly:true,tables:checks,missingIndexes};
}

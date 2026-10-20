// Activity includes charge intentions without inventing completed Solana transfers.
export async function listUserActivity(db,userId,network) {
  const {rows}=await db.query(`
    SELECT t.id,t.hash,t.kind,t.direction,
      CASE WHEN c.id IS NOT NULL THEN COALESCE(p.business_name,p.user_name,'Usuario') ELSE t.who END AS who,
      t.amt,t.fx_rate,t.ars,t.factura,t.block,t.fee,COALESCE(c.fee_cents::numeric/100,t.fee) AS fee_ars,t.memo,t.created_at,
      c.id AS charge_id,c.order_id,c.provider_status,c.provider_detail,
      COALESCE(c.status,w.status,'confirmed') AS status,t.hash AS signature,true AS settled,c.paid_at,COALESCE(c.last_error,w.last_error) AS last_error,
      CASE WHEN c.id IS NOT NULL THEN 'mercadopago' WHEN w.id IS NOT NULL THEN 'transfer' ELSE 'wallet' END AS source,
      w.id AS transfer_id
    FROM transactions t LEFT JOIN charges c ON c.user_id=t.user_id AND c.network=t.network
      AND (c.id=t.charge_id OR c.signature=t.hash)
    LEFT JOIN merchant_profiles p ON p.user_id=t.user_id
    LEFT JOIN wallet_transfers w ON w.id=t.transfer_id AND w.user_id=t.user_id AND w.network=t.network
    WHERE t.user_id=$1 AND t.network=$2
    UNION ALL
    SELECT c.id,COALESCE(c.signature,'charge:'||c.id::text),'charge_mercadopago','in',COALESCE(p.business_name,p.user_name,'Usuario'),
      c.usdc_raw::numeric/1000000,c.fx_rate,c.amount_cents::numeric/100,c.external_reference,
      NULL::bigint,NULL::numeric,c.fee_cents::numeric/100,c.payout_memo,c.created_at,c.id,c.order_id,c.provider_status,c.provider_detail,
      c.status,c.signature,false,c.paid_at,c.last_error,'mercadopago',NULL::uuid
    FROM charges c LEFT JOIN merchant_profiles p ON p.user_id=c.user_id
    WHERE c.user_id=$1 AND c.network=$2 AND NOT EXISTS (
      SELECT 1 FROM transactions t WHERE t.user_id=c.user_id AND t.network=c.network
        AND (t.charge_id=c.id OR t.hash=c.signature))
    UNION ALL
    SELECT w.id,COALESCE(w.signature,'transfer:'||w.id::text),w.kind,'out',w.recipient_name,
      w.usdc_raw::numeric/1000000,w.fx_rate,w.ars,'transfer_'||w.id::text,w.block,0::numeric,w.memo,w.created_at,
      NULL::uuid,NULL::text,NULL::text,NULL::text,w.status,w.signature,false,NULL::timestamptz,w.last_error,'transfer',w.id
    FROM wallet_transfers w WHERE w.user_id=$1 AND w.network=$2 AND w.signature IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM transactions t WHERE t.user_id=w.user_id AND t.network=w.network AND (t.transfer_id=w.id OR t.hash=w.signature))
    ORDER BY created_at DESC,id DESC`,[userId,network]);
  return rows;
}

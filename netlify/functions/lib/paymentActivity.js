// Activity includes charge intentions without inventing completed Solana transfers.
export async function listUserActivity(db,userId,network) {
  const {rows}=await db.query(`
    SELECT t.id,t.hash,t.kind,t.direction,
      CASE WHEN c.id IS NOT NULL THEN COALESCE(p.business_name,p.user_name,'Usuario') ELSE t.who END AS who,
      t.amt,t.fx_rate,t.ars,t.factura,t.block,t.fee,t.memo,t.created_at,
      c.id AS charge_id,c.order_id,c.provider_status,c.provider_detail,
      COALESCE(c.status,'confirmed') AS status,t.hash AS signature,true AS settled,c.paid_at,c.last_error,
      CASE WHEN c.id IS NULL THEN 'wallet' ELSE 'mercadopago' END AS source
    FROM transactions t LEFT JOIN charges c ON c.user_id=t.user_id AND c.network=t.network
      AND (c.id=t.charge_id OR c.signature=t.hash)
    LEFT JOIN merchant_profiles p ON p.user_id=t.user_id
    WHERE t.user_id=$1 AND t.network=$2
    UNION ALL
    SELECT c.id,COALESCE(c.signature,'charge:'||c.id::text),'charge_mercadopago','in',COALESCE(p.business_name,p.user_name,'Usuario'),
      c.usdc_raw::numeric/1000000,c.fx_rate,c.amount_cents::numeric/100,c.external_reference,
      NULL::bigint,NULL::numeric,c.payout_memo,c.created_at,c.id,c.order_id,c.provider_status,c.provider_detail,
      c.status,c.signature,false,c.paid_at,c.last_error,'mercadopago'
    FROM charges c LEFT JOIN merchant_profiles p ON p.user_id=c.user_id
    WHERE c.user_id=$1 AND c.network=$2 AND NOT EXISTS (
      SELECT 1 FROM transactions t WHERE t.user_id=c.user_id AND t.network=c.network
        AND (t.charge_id=c.id OR t.hash=c.signature))
    ORDER BY created_at DESC,id DESC`,[userId,network]);
  return rows;
}

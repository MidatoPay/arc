import { getPaymentDb } from '../netlify/functions/lib/paymentRuntime.js';
import { mpRequest } from '../netlify/functions/lib/mercadopago.js';
import { validateOrder } from '../netlify/functions/lib/paymentCore.js';
import { treasuryRpc, treasuryLiquidity, getTreasuryAddress } from '../netlify/functions/lib/treasuryPayout.js';

const reference = process.argv[2];
if (!/^mp_[a-f0-9]{32}$/.test(reference || '')) throw new Error('Expected exact payment reference');
const db = getPaymentDb();
try {
  const { rows } = await db.query(`SELECT id,external_reference,order_id,status,last_error,signature,
    last_valid_block_height,amount_cents,usdc_raw,network,environment,treasury_address,wallet_address,
    seller_id,pos_id,payment_id,paid_at,delivered_at,reserved FROM charges WHERE external_reference=$1`, [reference]);
  if (rows.length !== 1) throw new Error('Charge not found');
  const charge = rows[0];
  console.log(JSON.stringify({ charge }));
  const settings = {environment:process.env.MP_ENVIRONMENT, network:process.env.VITE_SOLANA_CLUSTER,
    seller:process.env.MP_USER_ID, token:process.env.MP_ACCESS_TOKEN};
  console.log(JSON.stringify({ configuration: {environment:settings.environment,network:settings.network,seller:settings.seller} }));
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(charge.order_id)}`, settings);
  console.log(JSON.stringify({ provider: { status: order.status, detail: order.status_detail,
    validation: validateOrder(order, charge) } }));
  if (charge.signature) {
    const status = await treasuryRpc('getSignatureStatuses', [[charge.signature], {searchTransactionHistory:true}]);
    const transaction = await treasuryRpc('getTransaction', [charge.signature, {encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]).catch(error => ({error:error.code}));
    console.log(JSON.stringify({ signatureStatus: status, transaction }));
  }
  console.log(JSON.stringify({ incidents:(await db.query('SELECT reason,created_at,resolved_at FROM payment_incidents WHERE charge_id=$1',[charge.id])).rows }));
  console.log(JSON.stringify({ relatedPending:(await db.query(`SELECT external_reference,order_id,status,last_error,
    signature,amount_cents,usdc_raw,treasury_address,paid_at FROM charges
    WHERE user_id=(SELECT user_id FROM charges WHERE id=$1) AND environment=$2 AND network=$3
    AND paid_at IS NOT NULL AND delivered_at IS NULL ORDER BY created_at LIMIT 50`,
    [charge.id,charge.environment,charge.network])).rows }));
  const configuredTreasury = await getTreasuryAddress();
  console.log(JSON.stringify({ configuredTreasury, treasuryMatches:configuredTreasury===charge.treasury_address }));
  if (configuredTreasury === charge.treasury_address)
    console.log(JSON.stringify({ liquidity: await treasuryLiquidity() }));
} catch (error) {
  console.error(JSON.stringify({ error: error.code || error.name, message: error.message }));
  process.exitCode = 1;
} finally { await db.end(); }

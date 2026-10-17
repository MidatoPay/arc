import { getPaymentDb, kickWorker } from '../netlify/functions/lib/paymentRuntime.js';
import { mpRequest } from '../netlify/functions/lib/mercadopago.js';
import { validateOrder } from '../netlify/functions/lib/paymentCore.js';

const reference = process.argv[2];
const execute = process.argv.includes('--execute');
if (!/^mp_[a-f0-9]{32}$/.test(reference || '')) throw new Error('Expected exact payment reference');
const pool = getPaymentDb();
const db = await pool.connect();
let locked = false;
let lockKey;
let inTransaction = false;
async function rpc(url, method, params) {
  const response = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok || body.error || !Object.hasOwn(body,'result')) throw new Error(`RPC ${method} failed (${body.error?.code || response.status})`);
  return body.result;
}
try {
  const {rows:[charge]} = await db.query('SELECT * FROM charges WHERE external_reference=$1',[reference]);
  if (!charge) throw new Error('Charge not found');
  const key = `charge:${charge.id}`;
  lockKey = key;
  locked = (await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked;
  if (!locked) throw new Error('Worker holds charge lock; retry later');
  const {rows:[current]} = await db.query('SELECT * FROM charges WHERE id=$1',[charge.id]);
  Object.assign(charge,current);
  if (charge.status !== 'manual_review' || charge.last_error !== 'solana_expired_requires_review' ||
      !charge.signature || !charge.signed_wire || !charge.reserved || charge.delivered_at)
    throw new Error('Charge is not a reserved expired payout under review');
  if (charge.environment !== process.env.MP_ENVIRONMENT || charge.network !== process.env.VITE_SOLANA_CLUSTER ||
      charge.seller_id !== process.env.MP_USER_ID || charge.network !== 'mainnet-beta') throw new Error('Configuration mismatch');
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(charge.order_id)}`,{token:process.env.MP_ACCESS_TOKEN});
  const validation = validateOrder(order,charge);
  if (!validation.paid || validation.refunded || validation.terminal) throw new Error('Provider payment is not eligible');
  const origin = process.env.PAYMENTS_BASE_URL;
  if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Missing production origin');
  const treasuryResponse = await fetch(new URL('/.netlify/functions/treasury',origin),{signal:AbortSignal.timeout(20000)});
  const treasury = await treasuryResponse.json();
  console.log(JSON.stringify({reference,amountCents:charge.amount_cents,usdcRaw:charge.usdc_raw,wallet:charge.wallet_address,
    oldSignature:charge.signature,provider:{status:order.status,detail:order.status_detail},treasury}));
  if (!treasuryResponse.ok || treasury.address !== charge.treasury_address) throw new Error('Deployed treasury does not match charge');
  const urls = [...new Set([process.env.SOLANA_RPC,'https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'].filter(Boolean))];
  const verified = new Set();
  for (const url of urls) {
    try {
      const genesis = await rpc(url,'getGenesisHash',[]);
      if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Wrong RPC network');
      const height = await rpc(url,'getBlockHeight',[{commitment:'finalized'}]);
      const status = await rpc(url,'getSignatureStatuses',[[charge.signature],{searchTransactionHistory:true}]);
      const transaction = await rpc(url,'getTransaction',[charge.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      const history = await rpc(url,'getSignaturesForAddress',[charge.treasury_address,{limit:1000,commitment:'finalized'}]);
      const created = Math.floor(new Date(charge.created_at).getTime()/1000);
      const matching = history.filter(t=>t.signature===charge.signature || t.memo?.includes(reference));
      const coversCreation = history.length < 1000 || history.some(t=>t.blockTime !== null && t.blockTime < created);
      const absent = status.value?.[0] === null && transaction === null && matching.length === 0;
      console.log(JSON.stringify({rpcHost:new URL(url).hostname,height,lastValidHeight:charge.last_valid_block_height,
        signatureStatus:status.value?.[0],transactionFound:transaction!==null,historyCount:history.length,coversCreation,matching}));
      if (!absent || !coversCreation || BigInt(height) <= BigInt(charge.last_valid_block_height)) throw new Error('Prior payout is not proven absent and expired');
      verified.add(new URL(url).hostname);
    } catch (error) {
      console.log(JSON.stringify({rpcHost:new URL(url).hostname,error:error.message}));
      if (error.message === 'Prior payout is not proven absent and expired') throw error;
    }
  }
  if (verified.size < 2) throw new Error('Need two successful independent RPC history checks');
  console.log(JSON.stringify({eligible:true,execute}));
  if (execute) {
    // Without a local dispatch credential, the deployed minute scheduler picks up the queue.
    // Never substitute local signing credentials for the deployed treasury.
    const canDispatch = Boolean(process.env.INTERNAL_WORKER_SECRET);
    if (canDispatch) {
      const dispatch = await kickWorker();
      if (!dispatch.accepted) throw new Error('Production worker could not be dispatched');
    }
    await db.query('BEGIN'); inTransaction = true;
    await db.query(`INSERT INTO payment_payout_attempts(signature,charge_id,signed_wire,last_valid_block_height,payout_memo,reason)
      VALUES($1,$2,$3,$4,$5,'manual_verified_expired_absent_two_rpcs')`,
      [charge.signature,charge.id,charge.signed_wire,charge.last_valid_block_height,charge.payout_memo]);
    await db.query(`UPDATE charges SET signature=NULL,signed_wire=NULL,last_valid_block_height=NULL,payout_memo=NULL,
      status='paid',last_error=NULL,next_attempt_at=now(),provider_status=$2,provider_detail=$3,
      payment_id=$4,reconciled_at=now(),paid_at=COALESCE(paid_at,now()) WHERE id=$1`,
      [charge.id,order.status,order.status_detail,validation.paymentId]);
    await db.query('COMMIT'); inTransaction = false;
    await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]); locked = false;
    console.log(JSON.stringify({requeued:reference,dispatch:canDispatch ? await kickWorker() : {scheduled:true}}));
  }
} catch (error) {
  if (inTransaction) await db.query('ROLLBACK');
  console.error(JSON.stringify({error:error.code || error.name,message:error.message})); process.exitCode = 1;
} finally {
  if (locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockKey]);
  db.release(); await pool.end();
}

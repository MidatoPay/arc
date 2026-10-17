import { getPaymentDb } from '../netlify/functions/lib/paymentRuntime.js';

const reference = process.argv[2];
if (!/^mp_[a-f0-9]{32}$/.test(reference || '')) throw new Error('Expected exact payment reference');
const db = getPaymentDb();
try {
  for (let i=0; i<24; i++) {
    const {rows:[charge]} = await db.query(`SELECT id,status,last_error,signature,usdc_raw,wallet_address,
      delivered_at,next_attempt_at,reconciled_at FROM charges WHERE external_reference=$1`,[reference]);
    if (!charge) throw new Error('Charge not found');
    console.log(JSON.stringify({charge}));
    if (charge.status === 'delivered') {
      const response = await fetch('https://api.mainnet-beta.solana.com', {method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,
          method:'getTransaction',params:[charge.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]}),
        signal:AbortSignal.timeout(20000)});
      const result = await response.json();
      if (!response.ok || result.error || !result.result || result.result.meta?.err) throw new Error('Finalized transaction could not be verified');
      console.log(JSON.stringify({finalizedTransaction:result.result}));
      console.log(JSON.stringify({ledger:(await db.query('SELECT hash,amt,ars,charge_id FROM transactions WHERE charge_id=$1',[charge.id])).rows,
        incidents:(await db.query('SELECT reason,resolved_at FROM payment_incidents WHERE charge_id=$1',[charge.id])).rows}));
      break;
    }
    if (i===23) process.exitCode=2;
    else await new Promise(resolve=>setTimeout(resolve,10000));
  }
} catch(error) {
  console.error(JSON.stringify({error:error.code || error.name,message:error.message})); process.exitCode=1;
} finally {await db.end();}

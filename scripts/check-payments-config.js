import { paymentSettings, getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";
import { verifySeller } from "../netlify/functions/lib/mercadopago.js";
import { treasuryLiquidity } from "../netlify/functions/lib/treasuryPayout.js";
import { fetchArsQuote } from "../src/priceFeed.js";

// Read-only: no orders, transfers, secret output or webhook configuration changes.
let db;
try {
  const required=["MP_ACCESS_TOKEN","MP_USER_ID","MP_STORE_ID","MP_WEBHOOK_SECRET","SOLANA_RPC","TREASURY_SECRET_KEY",
    "ETH_RPC_URL","CHAINLINK_MAX_AGE_SECONDS","INTERNAL_WORKER_SECRET","AIVEN_PG_URL","AIVEN_PG_CA_CERT","VITE_PRIVY_APP_ID","PRIVY_APP_SECRET"];
  const missing=required.filter((key)=>!process.env[key]?.trim());
  if(missing.length) { console.error(JSON.stringify({missingVariables:missing}));throw new Error("missing_configuration"); }
  const settings=paymentSettings();
  await verifySeller(settings);
  const quote=await fetchArsQuote(process.env.ETH_RPC_URL,Number(process.env.CHAINLINK_MAX_AGE_SECONDS));
  const liquidity=await treasuryLiquidity();
  db=getPaymentDb();
  await db.query("SELECT id FROM charges LIMIT 0");
  await db.query("SELECT id FROM payment_inbox LIMIT 0");
  await db.query("SELECT charge_id FROM commission_ledger LIMIT 0");
  await db.query("SELECT user_id FROM merchant_payment_pos LIMIT 0");
  if (settings.environment === "production" && !/^https:\/\//.test(process.env.PAYMENTS_BASE_URL || process.env.URL || "")) throw new Error("missing_https_url");
  console.log(JSON.stringify({environment:settings.environment,network:settings.network,sellerVerified:true,perMerchantPos:true,storeConfigured:true,
    treasuryConfigured:true,liquidityAvailable:BigInt(liquidity.raw)>0n,solAvailable:BigInt(liquidity.solLamports)>10000000n,
    chainlinkRound:quote.roundId,chainlinkUpdatedAt:quote.updatedAt,databaseReady:true,paymentsEnabled:process.env.PAYMENTS_ENABLED === "true"}));
} catch (e) { console.error(e.code || (["chainlink_invalid_or_stale","chainlink_max_age_not_configured","missing_https_url","missing_configuration"].includes(e.message) ? e.message : "configuration_check_failed"));process.exitCode=1; }
finally { if(db) await db.end(); }

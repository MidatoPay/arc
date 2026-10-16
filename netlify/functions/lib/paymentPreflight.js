import { NETWORK } from "../../../src/network.js";
import { PaymentError } from "./paymentCore.js";
import { paymentSettings,paymentQuoteSettings,paymentDatabaseConfig,getPaymentDb,getPaymentPrivy } from "./paymentRuntime.js";
import { verifySellerAccount,verifyStore } from "./mercadopago.js";
import { treasuryLiquidity,treasuryRpc,getTreasurySigner } from "./treasuryPayout.js";
import { inspectPaymentDatabase } from "./paymentDatabase.js";
import { fetchArsQuote,CHAINLINK_USD_ARS_HEARTBEAT_SECONDS } from "../../../src/priceFeed.js";
import { publicSecretVariables } from "../../../scripts/public-env-policy.js";

const required=["MP_ACCESS_TOKEN","MP_USER_ID","MP_STORE_ID","MP_WEBHOOK_SECRET","SOLANA_RPC","ETH_RPC_URL",
  "CHAINLINK_MAX_AGE_SECONDS","INTERNAL_WORKER_SECRET","AIVEN_PG_URL","AIVEN_PG_CA_CERT","VITE_PRIVY_APP_ID","PRIVY_APP_SECRET"];
function failureCode(error) {
  if(error instanceof PaymentError)return error.code;
  const known={"42P01":"payment_schema_missing","42703":"payment_schema_outdated","28P01":"payment_database_auth_failed",
    "42501":"payment_database_permission_denied",ENOTFOUND:"payment_database_unavailable",ECONNREFUSED:"payment_database_unavailable",
    CERT_HAS_EXPIRED:"payment_database_tls_failed",SELF_SIGNED_CERT_IN_CHAIN:"payment_database_tls_failed"};
  if(known[error?.code])return known[error.code];
  if(["chainlink_invalid_round","chainlink_stale_round","chainlink_max_age_not_configured","chainlink_rpc_timeout"].includes(error?.message))return error.message;
  return "dependency_check_failed";
}
async function deadline(fn,timeoutMs) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PaymentError("dependency_check_timeout")),timeoutMs);})]);}
  finally {clearTimeout(timer);}
}
export async function runPaymentPreflight({env=process.env,network=NETWORK,userId,adapters={},timeoutMs=20000}={}) {
  const missing=required.filter(key=>!env[key]?.trim());
  if(!env.TREASURY_SECRET_KEY?.trim() && !env.TREASURY_PRIVATE_KEY?.trim())missing.push("TREASURY_SECRET_KEY");
  const exposed=publicSecretVariables(env);
  const checks=[{name:"variables",status:missing.length?"fail":"pass",code:missing.length?"missing_configuration":null,missingVariables:missing},
    {name:"private_variables",status:exposed.length?"fail":"pass",code:exposed.length?"private_variables_have_vite_prefix":null,variables:exposed}];
  let settings;
  try {settings=paymentSettings(env,network);checks.push({name:"environment",status:"pass"});}
  catch(error){checks.push({name:"environment",status:"fail",code:failureCode(error)});}
  if(env.CONVERSION_FEE_BPS && env.CONVERSION_FEE_BPS!=="50")checks.push({name:"conversion_fee",status:"fail",code:"invalid_conversion_fee"});
  if(!["true","false"].includes(env.PAYMENTS_ENABLED || ""))checks.push({name:"payments_switch",status:"fail",code:"invalid_payments_enabled"});
  let validOrigin=false;
  try {
    const url=new URL(env.PAYMENTS_BASE_URL || env.URL);
    validOrigin=!url.username && !url.password && !url.search && !url.hash && (url.protocol==="https:" ||
      (env.MP_ENVIRONMENT==="test" && url.protocol==="http:" && ["localhost","127.0.0.1"].includes(url.hostname)));
  }catch{}
  checks.push({name:"worker_origin",status:validOrigin?"pass":"fail",code:validOrigin?null:"invalid_payments_base_url"});
  const jobs=[];
  function add(name,keys,fn) {
    const absent=keys.filter(key=>!env[key]?.trim());
    if(absent.length){checks.push({name,status:"blocked",code:"missing_configuration",missingVariables:absent});return;}
    jobs.push(deadline(fn,timeoutMs).then(details=>({name,status:"pass",...(details?{details}:{})}),error=>{
      const failure={name,status:"fail",code:failureCode(error)};
      if(name==="quote" && error?.quoteAge) {
        const details=Object.fromEntries(["updatedAt","ageSeconds","maxAgeSeconds"].filter(key=>Number.isSafeInteger(error.quoteAge[key]) && error.quoteAge[key]>=0).map(key=>[key,error.quoteAge[key]]));
        failure.details={...details,publishedHeartbeatSeconds:CHAINLINK_USD_ARS_HEARTBEAT_SECONDS};
      }
      return failure;
    }));
  }
  if(settings) {
    add("mercadopago_account",[],async()=>{await (adapters.verifyAccount || verifySellerAccount)(settings);});
    add("mercadopago_store",["MP_STORE_ID"],async()=>{await (adapters.verifyStore || verifyStore)(settings);});
  }else checks.push({name:"mercadopago_account",status:"blocked",code:"invalid_configuration"});
  add("quote",["ETH_RPC_URL","CHAINLINK_MAX_AGE_SECONDS"],async()=>{
    const {rpc,maxAge}=paymentQuoteSettings(env);
    const quote=await (adapters.fetchQuote || fetchArsQuote)(rpc,maxAge);
    return {updatedAt:quote.updatedAt,ageSeconds:Math.floor(Date.now()/1000)-quote.updatedAt,maxAgeSeconds:maxAge,
      publishedHeartbeatSeconds:CHAINLINK_USD_ARS_HEARTBEAT_SECONDS};
  });
  add("solana_network",["SOLANA_RPC"],async()=>{
    if(await (adapters.rpc || treasuryRpc)("getGenesisHash",[])!==network.genesis)throw new PaymentError("solana_rpc_network_mismatch");
    return {cluster:network.cluster};
  });
  add("treasury",["SOLANA_RPC"],async()=>{
    if(!env.TREASURY_SECRET_KEY?.trim() && !env.TREASURY_PRIVATE_KEY?.trim())throw new PaymentError("treasury_not_configured");
    try {await (adapters.getSigner || getTreasurySigner)();}catch{throw new PaymentError("invalid_treasury_secret_key");}
    const liquidity=await (adapters.liquidity || treasuryLiquidity)();
    if(BigInt(liquidity.raw)<10000n)throw new PaymentError("insufficient_treasury");
    return {minimumUsdcAvailable:true};
  });
  add("database",["AIVEN_PG_URL","AIVEN_PG_CA_CERT"],async()=>{
    paymentDatabaseConfig(env);
    const db=await (adapters.db || getPaymentDb()).connect();
    try {
      await db.query("BEGIN READ ONLY");
      const report=await (adapters.inspectDatabase || inspectPaymentDatabase)(db);
      if(!report.ready)throw new PaymentError("payment_schema_or_permissions_incomplete");
      return {tablesVerified:report.tables.length};
    }finally{try{await db.query("ROLLBACK");}finally{db.release();}}
  });
  const checkUser=userId || env.PAYMENTS_CHECK_USER_ID || env.PAYMENTS_ADMIN_USER_IDS?.split(",")[0]?.trim();
  if(checkUser)add("privy_user",["VITE_PRIVY_APP_ID","PRIVY_APP_SECRET"],async()=>{
    try {await (adapters.getUser || (id=>getPaymentPrivy().getUser(id)))(checkUser);}catch{throw new PaymentError("privy_user_lookup_failed");}
  });
  else checks.push({name:"privy_user",status:"unverified",code:"privy_check_user_id_required"});
  checks.push(...await Promise.all(jobs));
  return {ready:checks.every(check=>check.status==="pass"),readOnly:true,environment:env.MP_ENVIRONMENT || "test",network:network.cluster,
    paymentsEnabled:env.PAYMENTS_ENABLED==="true",checks};
}

import test from "node:test";
import assert from "node:assert/strict";
import { runPaymentPreflight } from "../netlify/functions/lib/paymentPreflight.js";
import { paymentDatabaseConfig } from "../netlify/functions/lib/paymentRuntime.js";
import { PaymentError } from "../netlify/functions/lib/paymentCore.js";
import { networkConfig } from "../src/network.js";
import { publicSecretVariables } from "../scripts/public-env-policy.js";

function fixture() {
 const network=networkConfig("mainnet"),events=[];
 const env=Object.fromEntries(["MP_ACCESS_TOKEN","MP_USER_ID","MP_STORE_ID","MP_WEBHOOK_SECRET","ARC_RPC","ETH_RPC_URL",
 "AIVEN_PG_CA_CERT","VITE_PRIVY_APP_ID","PRIVY_APP_SECRET","TREASURY_SECRET_KEY"].map(key=>[key,"private-sentinel"]));
 Object.assign(env,{MP_ENVIRONMENT:"production",INTERNAL_WORKER_SECRET:"x".repeat(32),PAYMENTS_ENABLED:"false",CONVERSION_FEE_BPS:"50",
 CHAINLINK_MAX_AGE_SECONDS:"90000",ETH_RPC_URL:"https://example.invalid",PAYMENTS_BASE_URL:"https://example.invalid",
 AIVEN_PG_URL:"postgresql://user:password@example.invalid/db?sslmode=require&application_name=payments",PAYMENTS_CHECK_USER_ID:"did:privy:merchant"});
 const adapters={verifyAccount:async()=>{},verifyStore:async()=>{},fetchQuote:async()=>({updatedAt:Math.floor(Date.now()/1000)}),
 rpc:async method=>method==="eth_chainId"?`0x${network.chainId.toString(16)}`:assert.fail(method),getSigner:async()=>({}),liquidity:async()=>({raw:"10000",nativeWei:"10000000000000000"}),
 db:{connect:async()=>({query:async sql=>events.push(sql),release:()=>events.push("release")})},
 inspectDatabase:async()=>({ready:true,tables:[{}]}),getUser:async()=>({})};
 return {env,network,adapters,events};
}
test("preflight checks all dependencies read-only and does not require enabling payments",async()=>{
 const input=fixture(),report=await runPaymentPreflight(input);
 assert.equal(report.ready,true);assert.equal(report.readOnly,true);assert.equal(report.paymentsEnabled,false);
 assert.deepEqual(input.events,["BEGIN READ ONLY","ROLLBACK","release"]);
 assert.ok(!JSON.stringify(report).includes("private-sentinel"));
});
test("preflight collects independent failures, reports missing names and bounds slow dependencies",async()=>{
 const input=fixture();delete input.env.PRIVY_APP_SECRET;input.env.VITE_TREASURY_SECRET_KEY="private-sentinel";
 input.adapters.verifyAccount=async()=>{throw new PaymentError("seller_account_mismatch");};
 input.adapters.fetchQuote=async()=>{throw new Error("chainlink_invalid_round");};
 input.adapters.rpc=()=>new Promise(()=>{});input.timeoutMs=20;
 const report=await runPaymentPreflight(input),checks=Object.fromEntries(report.checks.map(row=>[row.name,row]));
 assert.equal(report.ready,false);assert.equal(checks.database.status,"pass");
 assert.equal(checks.mercadopago_account.code,"seller_account_mismatch");assert.equal(checks.quote.code,"chainlink_invalid_round");
 assert.equal(checks.arc_network.code,"dependency_check_timeout");
 assert.deepEqual(checks.private_variables.variables,["VITE_TREASURY_SECRET_KEY"]);
 assert.ok(checks.variables.missingVariables.includes("PRIVY_APP_SECRET"));
 assert.ok(!JSON.stringify(report).includes("private-sentinel"));
});

test("preflight verifies Arc Mainnet and the minimum payout liquidity without moving funds",async()=>{
 const input=fixture();
 const report=await runPaymentPreflight(input),checks=Object.fromEntries(report.checks.map(row=>[row.name,row]));
 assert.equal(report.ready,true);assert.equal(report.network,"arc-mainnet");
 assert.deepEqual(checks.treasury.details,{minimumUsdcAvailable:true});
 assert.deepEqual(checks.arc_network.details,{network:"arc-mainnet",chainId:5042});
 const wrong=fixture();wrong.adapters.rpc=async()=>"0x1";wrong.adapters.liquidity=async()=>({raw:"9999",nativeWei:"0"});
 const failed=Object.fromEntries((await runPaymentPreflight(wrong)).checks.map(row=>[row.name,row]));
 assert.equal(failed.arc_network.code,"arc_rpc_network_mismatch");assert.equal(failed.treasury.code,"insufficient_treasury");
 const missing=fixture();delete missing.env.ARC_RPC;
 const blocked=Object.fromEntries((await runPaymentPreflight(missing)).checks.map(row=>[row.name,row]));
 assert.equal(blocked.arc_network.status,"blocked");assert.ok(blocked.variables.missingVariables.includes("ARC_RPC"));
});
test("database preflight always rolls back and releases on a schema failure",async()=>{
 const input=fixture();input.adapters.inspectDatabase=async()=>({ready:false,tables:[]});
 const report=await runPaymentPreflight(input);
 assert.equal(report.checks.find(row=>row.name==="database").code,"payment_schema_or_permissions_incomplete");
 assert.deepEqual(input.events,["BEGIN READ ONLY","ROLLBACK","release"]);
});
test("stale quote diagnostics include only numeric age fields, the configured maximum and the published heartbeat",async()=>{
 const input=fixture();let receivedMaxAge;
 input.adapters.fetchQuote=async(_rpc,maxAge)=>{
  receivedMaxAge=maxAge;
  const error=new Error("chainlink_stale_round");
  error.quoteAge={updatedAt:1000,ageSeconds:90001,maxAgeSeconds:90000,token:"private-sentinel"};throw error;
 };
 const report=await runPaymentPreflight(input),quote=report.checks.find(row=>row.name==="quote");
 assert.equal(receivedMaxAge,90000);assert.equal(report.ready,false);
 assert.equal(quote.code,"chainlink_stale_round");
 assert.deepEqual(quote.details,{updatedAt:1000,ageSeconds:90001,maxAgeSeconds:90000,publishedHeartbeatSeconds:86400});
 assert.ok(!JSON.stringify(report).includes("private-sentinel"));
});
test("preflight blocks the quote check when CHAINLINK_MAX_AGE_SECONDS is missing",async()=>{
 const input=fixture();delete input.env.CHAINLINK_MAX_AGE_SECONDS;
 const report=await runPaymentPreflight(input),checks=Object.fromEntries(report.checks.map(row=>[row.name,row]));
 assert.equal(report.ready,false);assert.ok(checks.variables.missingVariables.includes("CHAINLINK_MAX_AGE_SECONDS"));
 assert.equal(checks.quote.status,"blocked");assert.deepEqual(checks.quote.missingVariables,["CHAINLINK_MAX_AGE_SECONDS"]);
});
test("database TLS configuration preserves unrelated URL options without disabling verification",()=>{
 const config=paymentDatabaseConfig(fixture().env),url=new URL(config.connectionString);
 assert.equal(url.searchParams.has("sslmode"),false);assert.equal(url.searchParams.get("application_name"),"payments");
 assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.servername,"example.invalid");
 assert.ok(config.connectionTimeoutMillis>0);assert.ok(config.statement_timeout>0);
 assert.deepEqual(publicSecretVariables({VITE_PRIVY_APP_ID:"public",VITE_ARC_RPC:"public",VITE_TREASURY_SECRET_KEY:"secret"}),["VITE_TREASURY_SECRET_KEY"]);
});

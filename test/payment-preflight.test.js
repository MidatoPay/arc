import test from "node:test";
import assert from "node:assert/strict";
import { runPaymentPreflight } from "../netlify/functions/lib/paymentPreflight.js";
import { paymentDatabaseConfig } from "../netlify/functions/lib/paymentRuntime.js";
import { PaymentError } from "../netlify/functions/lib/paymentCore.js";
import { networkConfig } from "../src/network.js";
import { publicSecretVariables } from "../scripts/public-env-policy.js";

function fixture() {
 const network=networkConfig("mainnet-beta"),events=[];
 const env=Object.fromEntries(["MP_ACCESS_TOKEN","MP_USER_ID","MP_STORE_ID","MP_WEBHOOK_SECRET","SOLANA_RPC","ETH_RPC_URL",
 "AIVEN_PG_CA_CERT","VITE_PRIVY_APP_ID","PRIVY_APP_SECRET","TREASURY_SECRET_KEY"].map(key=>[key,"private-sentinel"]));
 Object.assign(env,{MP_ENVIRONMENT:"production",INTERNAL_WORKER_SECRET:"x".repeat(32),PAYMENTS_ENABLED:"false",CONVERSION_FEE_BPS:"50",
 CHAINLINK_MAX_AGE_SECONDS:"120",ETH_RPC_URL:"https://example.invalid",PAYMENTS_BASE_URL:"https://example.invalid",
 AIVEN_PG_URL:"postgresql://user:password@example.invalid/db?sslmode=require&application_name=payments",PAYMENTS_CHECK_USER_ID:"did:privy:merchant"});
 const adapters={verifyAccount:async()=>{},verifyStore:async()=>{},fetchQuote:async()=>({updatedAt:Math.floor(Date.now()/1000)}),
 rpc:async()=>network.genesis,getSigner:async()=>({}),liquidity:async()=>({raw:"10000",solLamports:"13000000"}),
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
 input.adapters.fetchQuote=async()=>{throw new Error("chainlink_invalid_or_stale");};
 input.adapters.rpc=()=>new Promise(()=>{});input.timeoutMs=20;
 const report=await runPaymentPreflight(input),checks=Object.fromEntries(report.checks.map(row=>[row.name,row]));
 assert.equal(report.ready,false);assert.equal(checks.database.status,"pass");
 assert.equal(checks.mercadopago_account.code,"seller_account_mismatch");assert.equal(checks.quote.code,"chainlink_invalid_or_stale");
 assert.equal(checks.solana_network.code,"dependency_check_timeout");
 assert.deepEqual(checks.private_variables.variables,["VITE_TREASURY_SECRET_KEY"]);
 assert.ok(checks.variables.missingVariables.includes("PRIVY_APP_SECRET"));
 assert.ok(!JSON.stringify(report).includes("private-sentinel"));
});
test("database preflight always rolls back and releases on a schema failure",async()=>{
 const input=fixture();input.adapters.inspectDatabase=async()=>({ready:false,tables:[]});
 const report=await runPaymentPreflight(input);
 assert.equal(report.checks.find(row=>row.name==="database").code,"payment_schema_or_permissions_incomplete");
 assert.deepEqual(input.events,["BEGIN READ ONLY","ROLLBACK","release"]);
});
test("database TLS configuration preserves unrelated URL options without disabling verification",()=>{
 const config=paymentDatabaseConfig(fixture().env),url=new URL(config.connectionString);
 assert.equal(url.searchParams.has("sslmode"),false);assert.equal(url.searchParams.get("application_name"),"payments");
 assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.servername,"example.invalid");
 assert.ok(config.connectionTimeoutMillis>0);assert.ok(config.statement_timeout>0);
 assert.deepEqual(publicSecretVariables({VITE_PRIVY_APP_ID:"public",VITE_SOLANA_RPC:"public",VITE_TREASURY_SECRET_KEY:"secret"}),["VITE_TREASURY_SECRET_KEY"]);
});

import { zipFunctions } from "@netlify/zip-it-and-ship-it";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require=createRequire(import.meta.url);
Object.assign(process.env,{
 MP_ENVIRONMENT:process.env.VITE_SOLANA_CLUSTER==="mainnet-beta"?"production":"test",
 MP_ACCESS_TOKEN:"offline-check-token",MP_USER_ID:"123",MP_WEBHOOK_SECRET:"offline-check-webhook",
 SOLANA_RPC:"https://example.invalid",INTERNAL_WORKER_SECRET:"x".repeat(32)
});
// Any accidental remote request makes this check fail immediately.
globalThis.fetch=async()=>{throw new Error("Network access is forbidden in the packaged Functions check");};

// Package exactly as Netlify does; smoke checks never authenticate or move money.
const functions=await zipFunctions("netlify/functions",".netlify/functions-review",{
 config:{"*":{nodeBundler:"esbuild"}},archiveFormat:"none"
});
for(const name of ["charges","merchant-pos","payment-reports","mercadopago-webhook","payments-worker-background"]) {
 const entry=functions.find(fn=>fn.name===name);
 if(!entry)throw new Error(`Missing packaged function: ${name}`);
 // Netlify's runtime loads these bundles as CJS, outside this repo's type=module.
 await writeFile(resolve(entry.path,"package.json"),JSON.stringify({type:"commonjs"}));
 const module=require(resolve(entry.path,`${name}.js`));
 const handler=module.handler || module.default?.handler;
 const result=await handler({path:`/.netlify/functions/${name}`,httpMethod:name==="mercadopago-webhook"?"POST":"GET",headers:{},body:"{}"});
 if(![400,401,403,405].includes(result.statusCode))throw new Error(`Authentication check failed: ${name} ${result.statusCode}`);
}
console.log(`Packaged ${functions.length} Functions; protected endpoints reject unauthenticated requests.`);

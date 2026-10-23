import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";

const target=process.argv[2] || ".env";
if(![".env",".env.production"].includes(target)) throw new Error("invalid_env_target");
const production=target===".env.production";
let contents = await readFile(target, "utf8").catch((e) => { if(e.code === "ENOENT") return ""; throw e; });
const values = {
  // Arc Mainnet only admits the production Mercado Pago environment (sandbox payments cannot release real USDC).
  VITE_ARC_NETWORK:"mainnet", MP_ENVIRONMENT:"production", PAYMENTS_ENABLED:"false",
  MP_ACCESS_TOKEN:"", MP_USER_ID:"", MP_EXTERNAL_POS_ID:"", MP_STORE_ID:"", MP_WEBHOOK_SECRET:"",
  CONVERSION_FEE_BPS:"50", CHAINLINK_MAX_AGE_SECONDS:"90000",
  ETH_RPC_URL:production?"https://ethereum.publicnode.com":"",
  ARC_RPC:"https://rpc.mainnet.arc.io",
  PAYMENTS_BASE_URL:"", INTERNAL_WORKER_SECRET:randomBytes(32).toString("hex"),
  PAYMENTS_ADMIN_USER_IDS:"",
};
const added = [];
const existing=parseEnv(contents);
for (const [key,value] of Object.entries(values)) {
  if (!(key in existing)) { contents += `\n${key}=${value}`; added.push(key); }
  else if (!existing[key].trim() && value) {
    contents=contents.replace(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`,"m"),`${key}=${value}`);
    added.push(key);
  }
}
await writeFile(target, `${contents.trimEnd()}\n`, { mode:0o600 });
console.log("Variables privadas preparadas; valores existentes conservados. Nuevas variables:", added.join(", "));

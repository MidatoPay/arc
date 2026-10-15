import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { networkConfig } from "./src/network.js";
import { publicSecretVariables } from "./scripts/public-env-policy.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const privateVariables=publicSecretVariables({...env,...process.env});
  if(privateVariables.length)throw new Error(`Variables privadas con prefijo público VITE_: ${privateVariables.join(", ")}. Usá los nombres privados de Functions y quitá estas variables del build.`);
  // RPC de Solana Devnet. Poné VITE_SOLANA_RPC en .env (Triton/Helius) para
  // no depender del RPC público (que limita las consultas).
  const target = env.SOLANA_RPC || env.VITE_SOLANA_RPC || networkConfig(env.VITE_SOLANA_CLUSTER || "devnet").rpc;
  // RPC de Ethereum Mainnet para el Price Feed Chainlink USD/ARS.
  const ethTarget = env.ETH_RPC_URL || env.VITE_ETH_RPC || "https://ethereum.publicnode.com";

  return {
    plugins: [react()],
    define: {
      global: "globalThis",
    },
    optimizeDeps: {
      esbuildOptions: { define: { global: "globalThis" } },
    },
    server: {
      proxy: {
        "/merchant-pos": {
          target:"http://127.0.0.1:9999",changeOrigin:true,
          rewrite:(path)=>path.replace(/^\/merchant-pos/,"/.netlify/functions/merchant-pos"),
        },
        "/payment-reports": {
          target:"http://127.0.0.1:9999",changeOrigin:true,
          rewrite:(path)=>path.replace(/^\/payment-reports/,"/.netlify/functions/payment-reports"),
        },
        "/charges": {
          target: "http://127.0.0.1:9999", changeOrigin: true,
          rewrite: (path) => path.replace(/^\/charges/, "/.netlify/functions/charges"),
        },
        "/webhooks/mercadopago": {
          target: "http://127.0.0.1:9999", changeOrigin: true,
          rewrite: (path) => path.replace(/^\/webhooks\/mercadopago/, "/.netlify/functions/mercadopago-webhook"),
        },
        "/rpc": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rpc/, ""),
        },
        "/eth-rpc": {
          target: ethTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/eth-rpc/, ""),
        },
        "/contacts": {
          target: "http://127.0.0.1:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/contacts/, "/.netlify/functions/contacts"),
        },
        "/transactions": {
          target: "http://127.0.0.1:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/transactions/, "/.netlify/functions/transactions"),
        },
        "/treasury": {
          target: "http://127.0.0.1:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/treasury/, "/.netlify/functions/treasury"),
        },
        "/parse-intent": {
          target: "http://127.0.0.1:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/parse-intent/, "/.netlify/functions/parse-intent"),
        },
      },
    },
  };
});

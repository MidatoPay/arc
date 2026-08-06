import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // RPC de Arc Testnet. Poné VITE_ARC_RPC en .env con tu URL de Alchemy
  // para no depender del RPC público (que limita las consultas).
  const target = env.VITE_ARC_RPC || "https://rpc.testnet.arc.network";
  // RPC de Ethereum Mainnet para el Price Feed Chainlink USD/ARS.
  const ethTarget = env.VITE_ETH_RPC || "https://ethereum.publicnode.com";

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
        // Puente al RPC para evitar bloqueos CORS del navegador
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
        // API de contactos (Postgres/Aiven) — a diferencia de /rpc, no hay
        // fallback público posible: hay que correr `netlify functions:serve`
        // aparte (puerto 9999 por default) para que esto responda en dev.
        "/contacts": {
          target: "http://localhost:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/contacts/, "/.netlify/functions/contacts"),
        },
      },
    },
  };
});

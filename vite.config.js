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
      },
    },
  };
});

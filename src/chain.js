import { defineChain } from "viem";

// Las lecturas van por el proxy local de Vite (ver vite.config.js) para
// evitar bloqueos CORS del navegador contra el RPC de Arc.
export const RPC_PROXY =
  typeof window !== "undefined" ? window.location.origin + "/rpc" : "https://rpc.testnet.arc.network";

export const ARC = {
  chainId: 5042002,
  explorer: "https://testnet.arcscan.app",
  faucet: "https://faucet.circle.com",
};

export const arcTestnet = defineChain({
  id: ARC.chainId,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
  rpcUrls: {
    default: { http: [RPC_PROXY] },
    public: { http: [RPC_PROXY] },
  },
  blockExplorers: { default: { name: "ArcScan", url: ARC.explorer } },
  testnet: true,
});

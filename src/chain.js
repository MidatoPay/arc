import { defineChain } from "viem";
import { NETWORK } from "./network.js";
import { rpcAccessToken } from './rpcSession.js';

// App reads go through the authenticated same-origin proxy (vite.config.js /
// netlify/functions/rpc.js); the server forwards them to ARC_RPC.
export const RPC_PROXY =
  typeof window !== "undefined" ? `${window.location.origin}/rpc` : NETWORK.rpc;

// Public HTTPS endpoint used by the Privy embedded wallet itself.
export const WALLET_RPC =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ARC_RPC) || NETWORK.rpc;

/** USDC on Arc: ERC-20 interface (6 decimals) over the native gas balance (18). */
export const USDC_ADDRESS = NETWORK.usdc;
export const USDC_DECIMALS = NETWORK.usdcDecimals;

export const ARC = {
  network: NETWORK.network,
  name: NETWORK.name,
  chainId: NETWORK.chainId,
  explorer: NETWORK.explorer,
  faucet: "https://faucet.circle.com",
  testnet: NETWORK.testnet,
  usdc: USDC_ADDRESS,
  usdcDecimals: USDC_DECIMALS,
};

/** Chain object for Privy (`defaultChain` / `supportedChains`). */
export const arcChain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: NETWORK.nativeDecimals },
  rpcUrls: { default: { http: [WALLET_RPC] } },
  blockExplorers: { default: { name: "Arc Explorer", url: NETWORK.explorer } },
});

export function explorerAddressUrl(address) {
  return `${ARC.explorer}/address/${address}`;
}

export function explorerTxUrl(hash) {
  return `${ARC.explorer}/tx/${hash}`;
}

/**
 * Minimal JSON-RPC client over the proxy. Every request carries the current
 * Privy session token, so a renewed token is picked up without rebuilding.
 */
export function createAppRpc({ url = RPC_PROXY, request = (...args) => fetch(...args) } = {}) {
  let id = 0;
  return async (method, params = []) => {
    const headers = { "Content-Type": "application/json" };
    if (typeof window !== "undefined") headers.Authorization = `Bearer ${await rpcAccessToken()}`;
    const response = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      const error = new Error(body.error?.message || body.error || `rpc_http_${response.status}`);
      error.code = body.error?.code ?? response.status;
      throw error;
    }
    return body.result;
  };
}

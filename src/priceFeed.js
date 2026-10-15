import { ethers } from "ethers";

// Chainlink USD/ARS Reference Price Feed — Ethereum Mainnet
// https://data.chain.link/feeds/ethereum/mainnet/ars-usd
export const CHAINLINK_USD_ARS_FEED = "0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b";

// Fallback off-chain si el RPC de Ethereum no responde.
export const FALLBACK_FX_ARS_USD = 1650;

// Lecturas van por el proxy local (/eth-rpc) para evitar CORS del navegador
// contra el RPC de Ethereum (mismo patrón que /rpc → Solana).
export const ETH_RPC_PROXY =
  typeof window !== "undefined" ? window.location.origin + "/eth-rpc" : "https://ethereum.publicnode.com";

const AGGREGATOR_ABI = [
  "function latestAnswer() view returns (int256 answer)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

export function validateRound({ answer, decimals, updatedAt, roundId, answeredInRound, description }, maxAge, now = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) throw new Error("chainlink_max_age_not_configured");
  if (description !== "USD / ARS" || answer <= 0n || Number(decimals) < 0 || Number(decimals) > 18 ||
      updatedAt <= 0n || updatedAt > BigInt(now) || BigInt(now) - updatedAt > BigInt(maxAge) ||
      answeredInRound < roundId) throw new Error("chainlink_invalid_or_stale");
  return { rate: ethers.formatUnits(answer, decimals), updatedAt: Number(updatedAt), roundId: String(roundId) };
}

// Money-moving operations use this strict path, never the display fallback.
export async function fetchArsQuote(rpcUrl, maxAge) {
  const request = new ethers.FetchRequest(rpcUrl);
  request.timeout = 10000;
  const provider = new ethers.JsonRpcProvider(request, 1, { batchMaxCount: 1 });
  let timer;
  try {
    const feed = new ethers.Contract(CHAINLINK_USD_ARS_FEED, AGGREGATOR_ABI, provider);
    const [round, decimals, description] = await Promise.race([
      Promise.all([feed.latestRoundData(), feed.decimals(), feed.description()]),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("chainlink_rpc_timeout")),12000);})
    ]);
    return validateRound({ answer: round.answer, updatedAt: round.updatedAt, roundId: round.roundId,
      answeredInRound: round.answeredInRound, decimals, description }, maxAge);
  } finally { clearTimeout(timer);provider.destroy(); }
}

/**
 * Lee latestAnswer() del Price Feed Chainlink USD/ARS.
 * Devuelve ARS por 1 USD (mismo semántica que usaba FX_ARS_USD).
 * El feed reporta con 8 decimales; description on-chain: "USD / ARS".
 */
export async function fetchArsPerUsd(rpcUrl = ETH_RPC_PROXY) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, 1, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  const feed = new ethers.Contract(CHAINLINK_USD_ARS_FEED, AGGREGATOR_ABI, provider);
  const [answer, decimals] = await Promise.all([feed.latestAnswer(), feed.decimals()]);
  if (answer <= 0n) throw new Error("Chainlink latestAnswer inválido");
  const rate = Number(ethers.formatUnits(answer, decimals));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Chainlink rate inválido");
  return rate;
}

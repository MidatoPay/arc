// One network definition shared by browser and server. Secrets never belong here.
export function networkConfig(cluster = "devnet") {
  if (!["devnet", "mainnet-beta"].includes(cluster)) throw new Error("invalid_solana_cluster");
  return {
    cluster,
    genesis: cluster === "devnet" ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    chain: cluster === "devnet" ? "solana:devnet" : "solana:mainnet",
    rpc: `https://api.${cluster}.solana.com`,
    wss: `wss://api.${cluster}.solana.com`,
    mint: cluster === "devnet"
      ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
      : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  };
}

export const NETWORK = networkConfig(
  import.meta.env?.VITE_SOLANA_CLUSTER ||
  (typeof process !== "undefined" ? process.env.VITE_SOLANA_CLUSTER : "") || "devnet"
);

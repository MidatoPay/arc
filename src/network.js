// One network definition shared by browser and server. Secrets never belong here.
// Values verified against https://docs.arc.io (connect-to-arc, contract-addresses,
// usdc-system-events) on 2026-10-22.
const ARC_NETWORKS = {
  mainnet: {
    network: "arc-mainnet",
    name: "Arc Mainnet",
    chainId: 5042,
    rpc: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    // USDC is the native gas token (18 decimals). Its ERC-20 interface shares
    // the same balance and uses 6 decimals.
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    nativeDecimals: 18,
    // Predeployed contract that attaches MIDATO|v1 metadata to a call.
    memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
    // EIP-7708 emitter: logs every USDC movement (native and ERC-20) in 18 decimals.
    systemEmitter: "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE",
    // Mempool floor: transactions below 20 gwei are silently dropped.
    minFeePerGasWei: 20_000_000_000n,
    // Test-only features (demo conversion, guest mode, faucet) stay disabled.
    testnet: false,
  },
};

export function networkConfig(name = "mainnet") {
  const network = ARC_NETWORKS[name];
  if (!network) throw new Error("invalid_arc_network");
  return network;
}

export const NETWORK = networkConfig(
  import.meta.env?.VITE_ARC_NETWORK ||
  (typeof process !== "undefined" ? process.env.VITE_ARC_NETWORK : "") || "mainnet"
);

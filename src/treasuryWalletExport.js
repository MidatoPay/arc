import { isAddress } from "@solana/kit";

export function treasuryExportWallets(user) {
  return [...new Set((user?.linkedAccounts || [])
    .filter(account => account.type === "wallet" && account.walletClientType === "privy" &&
      account.chainType === "solana" && typeof account.address === "string" && isAddress(account.address))
    .map(account => account.address))];
}

// Privy enforces ownership and displays the key on its own origin. Never return,
// store or log private key material in this application.
export async function openTreasuryWalletExport({ ready, authenticated, user, address, exportWallet }) {
  if (!ready || !authenticated || !user?.id || !treasuryExportWallets(user).includes(address)) {
    throw new Error("wallet_export_not_owned");
  }
  await exportWallet({ address });
}

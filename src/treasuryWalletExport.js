import { isAddress, sameAddress } from "./arc.js";
import {primaryArcWallet} from './primaryWallet.js';

export function treasuryExportWallets(user) {
  return [...new Set((user?.linkedAccounts || [])
    .filter(account => account.type === "wallet" && ['privy','privy-v2'].includes(account.walletClientType) &&
      account.chainType === "ethereum" && typeof account.address === "string" && isAddress(account.address))
    .map(account => account.address))];
}

// Privy enforces ownership and displays the key on its own origin. Never return,
// store or log private key material in this application.
export async function openTreasuryWalletExport({ ready, authenticated, user, address, exportWallet, authorize }) {
  if (!ready || !authenticated || !user?.id || !sameAddress(primaryArcWallet(user)?.address,address) || typeof authorize!=='function') {
    throw new Error("wallet_export_not_owned");
  }
  const access=await authorize();
  if(!access.authorized || !sameAddress(access.address,address))throw new Error('treasury_export_forbidden');
  await exportWallet({ address });
}

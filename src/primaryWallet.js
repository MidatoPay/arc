import { isAddress } from '@solana/kit';

// Do not infer identity from array order, network, or the most recently linked wallet.
export function primarySolanaWallet(user) {
  const primary = (user?.linkedAccounts || []).filter(account => account.type === 'wallet' &&
    ['privy','privy-v2'].includes(account.walletClientType) && account.chainType === 'solana' &&
    // The server SDK calls this hdWalletIndex; the React SDK calls it walletIndex.
    (account.hdWalletIndex ?? account.walletIndex) === 0 &&
    !(typeof account.hdWalletIndex==='number' && typeof account.walletIndex==='number' && account.hdWalletIndex!==account.walletIndex) &&
    isAddress(account.address || ''));
  const unique = new Map(primary.map(account => [account.address,account]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

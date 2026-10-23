# Arc rules for this repo

## Stack
- Network: **Arc Mainnet** (chain ID `5042`), configured only in `src/network.js` and selected by `VITE_ARC_NETWORK=mainnet`.
- Libraries: `ethers` v6 for transactions, ABI encoding and receipts. `viem` only for `defineChain` (the Privy chain object). Do not add other chain SDKs.
- Contracts: none of our own. Payments call the Arc Memo contract, which forwards an ERC-20 `transfer` to USDC.
- RPC: server code reads `ARC_RPC` (may include a provider key, never committed). The browser uses the authenticated `/rpc` proxy for reads and `VITE_ARC_RPC` (public, no keys) only for the Privy wallet.
- Wallets: Privy embedded EVM wallets (`walletChainType: "ethereum-only"`). Keys never leave Privy. The treasury key (`TREASURY_SECRET_KEY`) lives only in Functions.
- Tokens: USDC is the native gas token (18 decimals) and also an ERC-20 at `0x3600000000000000000000000000000000000000` (6 decimals). Identify it by address, never by symbol. Amounts on the ERC-20 interface are 6-decimal units; balances and gas are 18-decimal wei.
- FX: Chainlink USD/ARS on Ethereum Mainnet via `/eth-rpc`. Do not invent an oracle.

## Transactions
- Before signing: show recipient, exact amount, network and the estimated gas in USDC. The user pays gas on their transfers; the treasury pays gas on its payouts.
- EIP-1559 only, with `maxFeePerGas` at or above Arc's 20 gwei floor.
- Persist the signed transaction (and its nonce) before broadcasting. Rebroadcast only the identical bytes; never re-sign blindly.
- Finality is deterministic: a successful receipt is final. A reverted receipt or a nonce consumed by another transaction requires manual review.
- Treasury nonces are assigned under a database lock.
- Verify outcomes from the receipt (USDC `Transfer` log: from, to, amount), not from the request.
- On-chain data is the minimum: the payment and the `MIDATO|v1|…` memo. Personal data stays in Postgres.

## Product
- Embedded wallet by default. No app token, AMM, bridge, oracle or custody service.
- Test-only features stay disabled on mainnet (`NETWORK.testnet === false`); do not delete them.

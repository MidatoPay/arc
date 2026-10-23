# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm ci                      # install deps (Node 22)
cp .env.example .env        # then fill in VITE_PRIVY_APP_ID (required to run)
npm run dev                 # Vite dev server (localhost:5173)
npm run dev:full            # Vite + Netlify Functions (localhost:8888)
npm run build               # production build
npm test                    # node:test suite (PGlite + mocked Arc RPC, no network)
npm run functions:check     # packages every Function and checks auth on protected endpoints
```

There is no lint script.

### Required env vars (`.env`, see `.env.example`)

- `VITE_PRIVY_APP_ID` — required. Without it, `src/main.jsx` renders a "missing App ID" screen. Enable **EVM (Ethereum)** embedded wallets in the Privy dashboard.
- `VITE_ARC_NETWORK` — `mainnet` (Arc Mainnet, chain ID 5042). It is the only supported value.
- `VITE_ARC_RPC` — optional public HTTPS Arc RPC used by the Privy wallet in the browser. Never put a URL with an API key here.
- `ARC_RPC` — server-side Arc RPC for Functions (may include a provider API key). The browser reaches it only through the authenticated `/rpc` proxy.
- `VITE_ETH_RPC`, `ETH_RPC_URL` — Ethereum Mainnet RPC for the Chainlink USD/ARS feed (`/eth-rpc`).
- `TREASURY_SECRET_KEY` — treasury EVM private key (`0x` + 64 hex). **Server-side only**, never `VITE_`.
- `ANTHROPIC_API_KEY` — optional, server-side only. Used by `netlify/functions/parse-intent.js`; without it voice commands fall back to the local parser.
- `AIVEN_PG_URL`, `AIVEN_PG_CA_CERT`, `PRIVY_APP_SECRET` — required for contacts, history, charges and transfers. Server-side only.

Also see `ARC-RULES.md` at the repo root.

## Architecture

Vite + React SPA with Netlify Functions for secrets and Postgres. It runs voice and QR **USDC** payments on **Arc Mainnet**. USDC is Arc's native gas token (18 decimals) and is moved through its ERC-20 interface at `0x3600000000000000000000000000000000000000` (6 decimals). FX (ARS per USD) comes from the Chainlink USD/ARS feed on Ethereum Mainnet (`src/priceFeed.js`).

**Most of the UI lives in `src/App.jsx`.** Navigation is plain `useState` tab-switching; there is no router.

Key files:
- `src/network.js` — `NETWORK` constants (chain ID, RPC, explorer, USDC, Memo contract, system emitter, 20 gwei fee floor).
- `src/chain.js` — `ARC`, Privy chain object (`arcChain`, via viem `defineChain`), explorer helpers, authenticated app RPC client (`createAppRpc`).
- `src/arc.js` — shared primitives: address validation, USDC units, memo encoding (`memoTransferData`), fee fields, receipt parsing (`usdcTransfers`, `memoFromLogs`).
- `src/transfers.js` — `useWalletTransfers`: create → in-app approval → Privy `signTransaction` (no wallet UI) → submit.
- `src/scanTarget.js` — scanner: MidatoPay pay links, plain addresses and EIP-681 USDC URIs.
- `src/payQr.js` — P2P charge QR/link payload.
- `netlify/functions/lib/arcRpc.js` — server JSON-RPC client and chain ID check.
- `netlify/functions/lib/treasuryPayout.js` — treasury signer and payout preparation.
- `netlify/functions/lib/paymentWorker.js` — Mercado Pago reconciliation and payout settlement.
- `netlify/functions/lib/transferChain.js`, `transferService.js`, `transferWorker.js` — user transfers.
- `netlify/functions/lib/reconcile.js` — wallet history from the Arc system emitter `Transfer` logs.
- `netlify/functions/lib/rpcProxy.js` — `/rpc` (Arc reads only) and `/eth-rpc` (Chainlink only) allowlists.
- `db/schema.sql`, `db/migrations/*.sql` — Postgres DDL.

### Auth & wallet

Privy handles login (email/SMS) and provisions an **embedded EVM wallet** (`walletChainType: "ethereum-only"`, `defaultChain: arcChain`). The primary wallet is the Privy embedded wallet with HD index 0 (`src/primaryWallet.js`).

### Payment mechanic

Every USDC movement is an EIP-1559 transaction to the Memo contract: `Memo.memo(USDC, transfer(to, amount), keccak256(reference), "MIDATO|v1|…")`. Gas is paid in USDC.

- **Mercado Pago payouts:** the treasury pays amount and gas. The worker assigns the nonce under `pg_advisory_lock`, saves the signed transaction before broadcasting and only rebroadcasts the identical bytes. A successful receipt is final; a reverted receipt or a nonce consumed elsewhere goes to manual review.
- **User transfers:** the server prepares the unsigned transaction, the user's wallet signs it, and the server checks it is byte-identical and signed by the sender, simulates it with `eth_call`, and stores it before the worker broadcasts. The user pays gas; the recipient receives the exact amount. Sendable = `amount + max gas + in-flight transfers ≤ balance`.
- **History:** `transactions` keeps `UNIQUE(user_id, network, hash)`; workers write their own rows and reconciliation skips hashes they own.

### Voice → intent parsing

`SpeechRecognition` + `claudeParse` (POST `/parse-intent` with Privy token) with a local fallback parser.

## Deployment (Netlify)

Static site via `netlify.toml`. Set the variables from `.env.production.example` in the Netlify Production context. Remove any `VITE_`-prefixed secret. Add the deployed domain under Privy **Domains**. Apply `db/schema.sql` and the migrations (`npm run db:migrate:payments`) once against the production database.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install # install deps
cp .env.example .env # then fill in VITE_PRIVY_APP_ID (required to run)
npm run dev # start Vite dev server (localhost:5173)
npm run build # production build
npm run preview # preview the production build
```

There is no lint script, no test runner, and no test files in this repo — don't assume `npm test` or `npm run lint` exist.

**Netlify Functions need a second process in dev.** `/contacts`, `/transactions`, `/treasury`, and `/parse-intent` have no public fallback — they're Netlify Functions, and one must actually be running for agenda/history/Convert ARS→USDC/Claude voice parse to work. Without it those calls fail — and since `pushTx`'s persistence call is wrapped in `.catch(() => {})`, transaction saves fail *silently*. Run in a separate terminal:

```bash
npx netlify functions:serve # serves netlify/functions/* on :9999; vite.config.js proxies the paths above there
```

### Required env vars (`.env`, see `.env.example`)

- `VITE_PRIVY_APP_ID` — required. Without it, `src/main.jsx` renders a "missing App ID" screen instead of the app. Enable **Solana** embedded wallets in the Privy dashboard.
- `ANTHROPIC_API_KEY` — optional, **server-side only** (no `VITE_` prefix). Used by `netlify/functions/parse-intent.js`. Without it, voice/text commands fall back to a local regex parser (`localParse` in `src/App.jsx`).
- `VITE_SOLANA_RPC` — optional HTTPS RPC (Triton/Helius). Without it, the Vite/Netlify `/rpc` proxy forwards to the public Solana **devnet** RPC, which rate-limits.
- `VITE_SOLANA_WSS` — optional WSS for Privy subscriptions (default public devnet WSS).
- `VITE_ETH_RPC` — optional. Ethereum RPC for the Chainlink USD/ARS feed via `/eth-rpc`.
- `TREASURY_SECRET_KEY` — Solana keypair (base58 or JSON byte array) for Convert ARS→USDC payouts. **Server-side only** (no `VITE_` prefix); used by `netlify/functions/treasury.js`. Devnet only.
- `AIVEN_PG_URL`, `AIVEN_PG_CA_CERT`, `PRIVY_APP_SECRET` — required for contacts, transactions, treasury payouts, and parse-intent auth. Server-side only, no `VITE_` prefix.

Also see `SOLANA-RULES.md` at the repo root.

## Architecture

This is a Vite + React SPA with Netlify Functions for secrets and Postgres. It demonstrates voice-driven **USDC (SPL)** payments on **Solana Devnet**. Anthropic and treasury keys stay on the server — never `VITE_` / never in the browser bundle. FX (ARS per USDC) is read from the Chainlink USD/ARS feed on Ethereum Mainnet via `latestAnswer()` (`src/priceFeed.js`), with an off-chain fallback if the Ethereum RPC fails.

**Almost the entire app lives in `src/App.jsx`**. Navigation is plain `useState` tab-switching — there is no router.

Supporting files:
- `src/chain.js` — Solana cluster constants, USDC mint (devnet Circle), explorer helpers, RPC/WSS URLs.
- `src/solana.js` — Kit RPC client, USDC ATA balance, build/sign/send SPL transfers + Memo, fee estimate, incoming-transfer detection.
- `src/priceFeed.js` — Chainlink USD/ARS feed reader via `/eth-rpc` (ethers only here).
- `src/fx.js` — ARS↔USDC quotes on top of the Chainlink rate.
- `src/treasury.js` — browser client for `/treasury` (public status + authenticated payouts).
- `src/fiatRail.js` — simulated ARS payment rail.
- `src/flows.js` — `runConvertArsToUsdc`, `runConvertUsdcToArs` orchestration.
- `src/payQr.js` — P2P charge QR/link payload (`buildPayUrl`/`parsePayUrl`) with Solana addresses.
- `src/contacts.js` / `src/transactions.js` — Postgres clients via Netlify Functions + localStorage SWR cache.
- `db/schema.sql` — contacts/transactions/wallets DDL.
- `src/main.jsx` — polyfills, PrivyProvider configured for **Solana-only** embedded wallets + Kit RPC.
- `vite.config.js` — proxies `/rpc`, `/eth-rpc`, `/contacts`, `/transactions`, `/treasury`, `/parse-intent`.
- `netlify/functions/treasury.js` + `lib/treasuryPayout.js` — server-side treasury signer.
- `netlify/functions/parse-intent.js` — server-side Anthropic voice parse.

### Auth & wallet

Privy handles login (email/SMS) and provisions an **embedded Solana wallet**. `App.jsx` uses `useWallets` / `useSignAndSendTransaction` from `@privy-io/react-auth/solana`. Balance is USDC ATA balance via Kit; sends go through `sendUsdc(wallet, signAndSendTransaction, opts)`.

### Payment mechanic

USDC is an **SPL token** (Circle mint on devnet in `src/chain.js`). A payment is `CreateIdempotent ATA` (if needed) + `TransferChecked` + optional `Memo` (`MIDATO|v1|…`). Fees are paid in **SOL**, not USDC.

**Cobrar is P2P.** Charge generates a QR/link for the collector's Solana address and ARS amount. The payer pays with `sendUsdc`. While the QR screen is open, the collector polls USDC balance and, on a balance-diff, runs `findIncomingTransfer` (recent signatures on the ATA) to attribute the signature before recording it. Table uniqueness remains `UNIQUE(user_id, hash)`.

### Voice → intent parsing

`SpeechRecognition` + `claudeParse` (POST `/parse-intent` with Privy token) / `localParse` fallback. Settlement calls `sendUsdc` on Solana.

## Deployment (Netlify)

Static site via `netlify.toml`. Functions: `rpc.js` (Solana), `eth-rpc.js` (Ethereum/Chainlink), `contacts.js`, `transactions.js`, `treasury.js`, `parse-intent.js`, `reconcile-wallets.js` (SPL USDC via Solana RPC).

Required Netlify env: `VITE_PRIVY_APP_ID`, optional `VITE_SOLANA_RPC` / `VITE_SOLANA_WSS` / `VITE_ETH_RPC`, plus **server-only** `ANTHROPIC_API_KEY` / `TREASURY_SECRET_KEY` / `AIVEN_PG_URL` / `AIVEN_PG_CA_CERT` / `PRIVY_APP_SECRET`. Remove any old `VITE_ANTHROPIC_API_KEY` / `VITE_TREASURY_SECRET_KEY` from Netlify so they cannot be baked into a future client build by mistake. Add the deployed domain under Privy **Domains**. Run `db/schema.sql` once against Aiven.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install deps
cp .env.example .env     # then fill in VITE_PRIVY_APP_ID (required to run)
npm run dev               # start Vite dev server (localhost:5173)
npm run build              # production build
npm run preview            # preview the production build
```

There is no lint script, no test runner, and no test files in this repo — don't assume `npm test` or `npm run lint` exist.

**Contacts agenda and transaction history need a second process.** Unlike `/rpc`/`/eth-rpc`, `/contacts` and `/transactions` have no public fallback — they're Netlify Functions backed by Postgres, and one must actually be running for the agenda/history to load in dev. Without it, `/contacts` and `/transactions` GET/POST calls fail — and since `pushTx`'s persistence call is wrapped in `.catch(() => {})`, transaction saves fail *silently*: the Activity tab just won't persist across refresh, with no visible error in the UI or console. Run in a separate terminal:

```bash
npx netlify functions:serve   # serves netlify/functions/* on :9999; vite.config.js proxies /contacts and /transactions there
```

### Required env vars (`.env`, see `.env.example`)

- `VITE_PRIVY_APP_ID` — required. Without it, `src/main.jsx` renders a "missing App ID" screen instead of the app.
- `VITE_ANTHROPIC_API_KEY` — optional. Without it, voice/text commands fall back to a local regex parser (`localParse` in `src/App.jsx`).
- `VITE_ARC_RPC` — optional. Without it, the Vite dev proxy (`vite.config.js`) forwards `/rpc` to the public Arc testnet RPC, which rate-limits.
- `AIVEN_PG_URL`, `AIVEN_PG_CA_CERT`, `PRIVY_APP_SECRET` — required for the contacts agenda (`netlify/functions/contacts.js`) and the transaction history (`netlify/functions/transactions.js`). Server-side only, no `VITE_` prefix. See `docs/superpowers/specs/2026-08-05-contacts-agenda-design.md` § 1.5 for where to get each one.

## Architecture

This is a client-only Vite + React SPA (no backend, no router) demonstrating voice-driven USDC payments on Arc Testnet (chain ID `5042002`). It's a demo/prototype, not production infra — hardcoded contacts, API key shipped to the browser. FX (ARS per USDC) is read from the Chainlink USD/ARS feed on Ethereum Mainnet via `latestAnswer()` (`src/priceFeed.js`), with an off-chain fallback if the Ethereum RPC fails.

**Almost the entire app lives in `src/App.jsx`** (~1000 lines, one file). It contains every screen (`Login`, `Home`, `Voice`, `Success`, `Movimientos`, `Stack`, `Mas`) as components defined top-to-bottom in the same file, plus all business logic. Navigation is plain `useState` tab-switching in the root `App` component — there is no router. When making changes, find the relevant section by component name rather than expecting separate files per screen.

Supporting files:
- `src/chain.js` — Arc Testnet chain definition (viem `defineChain`) and the `RPC_PROXY` URL (routes through the Vite dev proxy at `/rpc` to dodge browser CORS against the real RPC).
- `src/priceFeed.js` — Chainlink USD/ARS feed reader (`latestAnswer` on Ethereum Mainnet) via the `/eth-rpc` proxy.
- `src/fx.js` — ARS↔USDC quotes on top of the Chainlink rate.
- `src/arc.js` — Arc RPC provider, retries, native USDC transfers, memos.
- `src/treasury.js` — collector/treasury wallet (`VITE_TREASURY_PRIVATE_KEY`) for payouts.
- `src/fiatRail.js` — simulated ARS payment rail (swap body later for a real PSP).
- `src/flows.js` — `runChargeFlow`, `runConvertArsToUsdc`, `runConvertUsdcToArs` orchestration.
- `src/contacts.js` — contacts agenda client: talks to the `/contacts` Netlify Function (Postgres via Aiven), with a `localStorage` stale-while-revalidate cache keyed by Privy `user.id` so the agenda survives across devices. Not a local-storage-only module — see `netlify/functions/contacts.js` and `db/schema.sql`.
- `src/transactions.js` — transaction history client, same pattern as `src/contacts.js`: talks to the `/transactions` Netlify Function (Postgres via Aiven) with a `localStorage` stale-while-revalidate cache keyed by Privy `user.id`. See `netlify/functions/transactions.js` and `db/schema.sql`.
- `db/schema.sql` — `contacts` and `transactions` table DDL for Aiven Postgres; run manually once against the DB, not an auto-migration.
- `src/main.jsx` — polyfills (`Buffer`/`global`/`process`) required by Privy, then mounts `<PrivyProvider>` wrapping `<App>`. Login methods are restricted to email/SMS with embedded-wallet auto-creation.
- `vite.config.js` — proxies `/rpc` → Arc RPC and `/eth-rpc` → Ethereum RPC (`VITE_ETH_RPC` or publicnode).

### Auth & wallet

Privy (`@privy-io/react-auth`) handles login (email/SMS) and provisions an embedded wallet per user — no seed phrases. `App.jsx` picks the Privy wallet via `useWallets()`, reads balance through a dedicated read-only `ethers.JsonRpcProvider` pointed at `RPC_PROXY`, and gets a signer for sends via `wallet.getEthereumProvider()` → `ethers.BrowserProvider`.

### Payment mechanic

There's no ERC-20 contract call: USDC is the chain's *native* currency on Arc, so a "payment" is a plain native-value transfer (`signer.sendTransaction`) to one of the hardcoded `CONTACTS` addresses. The invoice/reference travels as UTF-8-encoded tx `data` (built by `armarMemo`, format `MIDATO|v1|inv:<factura>|to:<alias>|cur:<currency>|amt:<amount>`) — this is how the app claims on-chain reconciliation without an external database. When decoding it back, ArcScan's "Input Data" viewed as UTF-8 shows the memo.

RPC calls (`readProvider.getBalance`, `waitForTransaction`, `sendTransaction`) are wrapped in `withRetry`, which does exponential backoff specifically on rate-limit errors (`"limit reached"`, `-32011`, `429`) — this pattern exists because the public Arc RPC throttles aggressively; keep using `withRetry` for new RPC calls rather than calling the provider directly.

### Voice → intent parsing

`Voice` (in `App.jsx`) captures speech via the browser's native `SpeechRecognition`/`webkitSpeechRecognition` API in `es-AR`, with a text-input fallback (Safari needs system Dictation enabled and has quirks handled inline). The transcript is parsed into `{intent, amount, currency, recipient}` by:
1. `claudeParse` — calls the Anthropic Messages API directly from the browser (`anthropic-dangerous-direct-browser-access` header) using `VITE_ANTHROPIC_API_KEY`, if present.
2. `localParse` — regex-based fallback (Spanish keywords for send/transfer/pay, ARS vs USDC detection, alias extraction) used whenever the API key is missing or the call fails.

Recipients resolve against the hardcoded `CONTACTS` array (alias → name/address). The ARS↔USDC conversion uses the live Chainlink rate (ARS per USD) for display and amount conversion only — settlement on Arc remains a native USDC transfer.

## Deployment (Netlify)

Deployed as a static site via `netlify.toml`. The dev-only proxies from `vite.config.js` don't exist in a static build, so Netlify Functions replicate them: `rpc.js` for Arc (`/rpc`), `eth-rpc.js` for Ethereum (`/eth-rpc`, Chainlink reads), `contacts.js` for the contacts agenda (`/contacts`, Postgres via Aiven), and `transactions.js` for the transaction history (`/transactions`, Postgres via Aiven). Keep Vite proxies and functions in sync if the proxy logic changes.

Required setup in the Netlify dashboard (not in this repo):
- Site environment variables: `VITE_PRIVY_APP_ID` (required), `VITE_ANTHROPIC_API_KEY` (optional), `VITE_ARC_RPC` (optional), `VITE_ETH_RPC` (optional — Ethereum RPC for the Chainlink feed), `AIVEN_PG_URL`/`AIVEN_PG_CA_CERT`/`PRIVY_APP_SECRET` (required for the contacts agenda and the transaction history).
- Add the deployed domain (e.g. `<site>.netlify.app`) under **Domains** in the Privy dashboard, or login will fail.
- Run `db/schema.sql` against the Aiven Postgres instance once (it's not applied automatically on deploy).

### UI conventions

All styling is inline `style={{...}}` objects plus a handful of global classes/keyframes defined in `index.html` (`.mp-stage`, `.mp-device`, `.mp-nav`, `.mp-fab`, `.mp-overlay`, `mp-ring`/`mp-pulse` animations) — there's no CSS module or styled-components setup. The `C` object at the top of `App.jsx` holds the color design tokens; reuse it rather than hardcoding new colors. The app frames itself as a phone-shaped "device" centered on the page (`.mp-device`), going edge-to-edge only below 520px width.

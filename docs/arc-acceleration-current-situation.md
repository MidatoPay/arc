# MidatoPay × Arc — Current situation

Answer to: *Describe your current situation on the Arc integration. Type of integration, objective, progress, constraints and more.*

Architecture 1-pager (separate doc): `docs/arc-acceleration-1pager.md`  
Code: [https://github.com/MidatoPay/arc](https://github.com/MidatoPay/arc)

---

**Type.** Hybrid, not a DeFi protocol. MidatoPay is a consumer/merchant payments app. Arc is the settlement rail for **native USDC**. Identity (Privy), voice parsing, contacts, FX quotes, and the ARS ledger stay off-chain. We did not write a custom program, token, AMM, or bridge.

**Objective.** Make sending and collecting digital dollars feel like a normal payment app in Argentina (voice + QR, amounts in ARS) while every transfer is a real USDC movement on Arc that anyone can check on ArcScan. The season goal is to take the existing testnet prototype to a merchant-usable corridor (real ARS rail + operational hardening), still on Arc — then Mainnet only when that is honest.

**Progress (already working on Arc Testnet, before 28 Sep 2026).**

- Live testnet app in [github.com/MidatoPay/arc](https://github.com/MidatoPay/arc): login with email/SMS, embedded wallet, native USDC send.
- Voice and text intents (send / collect), P2P charge QR, invoice memo on-chain (`MIDATO|v1|…`).
- Convert ARS↔USDC through a **testnet treasury** and a **simulated** peso rail.
- Chainlink USD/ARS for quotes; Postgres agenda + history; ArcScan reconciliation job.
- Netlify deploy path (`/rpc` proxy, contacts, transactions).

This is a demo you can run end-to-end on Arc Testnet with faucet USDC. It is not production volume and not Mainnet.

**Constraints.**

- **Testnet only.** Faucet USDC, no real funds. Public Arc RPC rate-limits; production needs a dedicated RPC.
- **Treasury key in the client** (`VITE_TREASURY_PRIVATE_KEY`) for Convert — acceptable for a demo, not for production. Payouts must move to a backend signer.
- **Fiat rail is mocked.** Convert does not talk to a bank or PSP yet.
- **Wallets are Privy**, not Circle Programmable Wallets. Circle products in use are Arc + native USDC + the test faucet.
- **Demo secrets.** Anthropic key can ship in the frontend if enabled; that cannot ship to production as-is.
- **No custom onchain program.** That is intentional (faster, less audit surface) but it means programmable splits/escrow are out of scope until we need them.

**What is blocked vs what we can do now.** Nothing on Arc Testnet is blocked for the core loop (login → fund faucet → voice/QR → ArcScan). What we cannot claim yet: Mainnet, real ARS settlement, Circle Mint/CCTP/Gateway, or production custody.

**This season.** Keep settlement on Arc. Move keys and Convert off the browser, plug a real ARS rail, harden collect/reconciliation for merchants, then decide Mainnet.

# MidatoPay × Arc — 1-pager

**Voice-first USDC payments on Arc Testnet**

Code: [https://github.com/MidatoPay/arc](https://github.com/MidatoPay/arc)  
Explorer: [https://testnet.arcscan.app](https://testnet.arcscan.app)  
Test USDC: [https://faucet.circle.com](https://faucet.circle.com) → Arc Testnet

This document describes the **Arc Testnet prototype**. It is not a production or real-money payment service.

---

## Overview

MidatoPay is a payment app for people and merchants who think in pesos and settle in digital dollars. On Arc, a user signs in with email or phone, receives an embedded wallet, and can send or collect **native USDC** with voice or a QR. Transfers land on **Arc Testnet (chain ID 5042002)** and are independently verifiable on ArcScan.

The product sentence:

> *The onchain piece is the USDC payment plus an invoice memo. Login, voice, contacts, FX, and history stay in Web2.*

---

## Integration architecture

```
User (email / SMS)
    → Privy (identity + embedded Arc wallet)
        → MidatoPay SPA (Vite + React)
            → Voice / text parser (Anthropic optional, local fallback)
            → Contacts + tx history (Postgres via Netlify Functions)
            → Chainlink USD/ARS (Ethereum Mainnet, read-only)
            → Arc Testnet RPC (prepare, sign, send native USDC)
                → ArcScan (receipt + reconciliation)
```

1. **Identity and wallet.** Privy handles email/SMS login and creates an embedded Ethereum-compatible wallet on Arc. The user does not install an extension or handle a seed phrase.

2. **Intent.** The browser captures speech (`SpeechRecognition`) or typed text. A spoken line such as “enviar un dólar a Katy” or “cobrar cinco mil pesos” becomes a structured intent. If `VITE_ANTHROPIC_API_KEY` is set, Claude parses it; otherwise a local Spanish regex parser is used. Recipients resolve against the user’s contact agenda (alias → Arc address).

3. **Settlement on Arc.** USDC is **native** on Arc, not an ERC-20 call. A payment is a value transfer from the user’s wallet, with an UTF-8 memo in `tx.data`:

   `MIDATO|v1|inv:<invoice>|to:<alias>|cur:<ARS|USDC>|amt:<amount>|kind:<voice|pay|charge_p2p|convert_…>`

   The app estimates fees, the user confirms, then the embedded wallet signs and the tx is submitted through an Arc RPC proxy (`/rpc`).

4. **Collect (Cobrar) is P2P.** The collector generates a QR/link with their Arc address, display name, ARS amount, and invoice. The payer opens it in their own session and pays **directly to the collector**. No treasury in this path. While the QR is open, the collector polls USDC balance and attributes the incoming tx (bounded ArcScan/block lookup) before recording it.

5. **Convert (ARS ↔ USDC) is a testnet treasury path.** ARS→USDC: a demo treasury wallet sends native USDC to the user. USDC→ARS: the user sends USDC to the treasury and ARS is credited on a **simulated** fiat rail (`fiatRail.js`). This is not a live bank on-ramp.

6. **FX.** ARS per USDC is read from the Chainlink USD/ARS feed on Ethereum Mainnet (`latestAnswer`), with an off-chain fallback if that RPC fails. FX is display and quote only; settlement on Arc remains USDC.

7. **Off-chain product data.** Contacts and activity live in Postgres (Aiven), behind Netlify Functions authenticated with the Privy access token. A scheduled job reconciles incoming transfers from ArcScan into `transactions`. Personal data never goes onchain.

---

## Circle products in use

| Used | Not used (do not claim) |
|---|---|
| **Arc** as the settlement L1 (Testnet) | Circle Programmable / Developer-Controlled Wallets |
| **Native USDC** on Arc (gas and payment asset) | CCTP / Gateway |
| **Circle faucet** for test USDC on Arc Testnet | Circle Mint |
| ArcScan for public verification | Production Arc Mainnet |

Wallet provider in this repo is **Privy**, not Circle wallets.

---

## What runs onchain vs off-chain

**Onchain (Arc Testnet)**
- Native USDC transfer (send, P2P collect, convert payout / convert-in)
- Invoice/reference memo in transaction data
- Public, verifiable receipt (hash → ArcScan)

**Off-chain**
- Login UI, voice capture, intent parsing
- Contact agenda and activity history
- ARS ledger (simulated)
- Chainlink FX read
- Application orchestration and RPC/API proxies

---

## User-facing feature

A user can:

1. Sign in with email or phone and get a wallet automatically.
2. Fund test USDC from the Circle faucet (Arc Testnet).
3. **Speak a payment** (“send 1 dollar to Katy”) or type it, review amount / recipient / fee, sign, and get an ArcScan link.
4. **Collect** by showing a QR so another MidatoPay user pays them in USDC for an ARS amount.
5. **Convert** ARS ↔ USDC in the testnet prototype (treasury + simulated pesos).
6. Keep an agenda of aliases and a movement history that survives refresh.

The goal is that moving USDC feels like a familiar payments app, while every transfer remains independently checkable on Arc.

---

## Timeline: before 28 September 2026 vs now

**Already live on Arc Testnet before 28 September 2026**

The public repo [MidatoPay/arc](https://github.com/MidatoPay/arc) (`master`) already contained a working Arc Testnet prototype in **August 2026**:

- Privy email/SMS + embedded wallet on Arc
- Voice-initiated native USDC sends
- P2P QR collect with on-chain memo
- Convert ARS↔USDC via a testnet treasury (simulated fiat rail)
- Chainlink FX, contacts, transaction history, ArcScan reconciliation
- PWA shell and Netlify deploy path

That is the baseline we bring into this season. It was testnet-only then and it is testnet-only now.

**What we are building now (season starting 28 September 2026)**

Not a greenfield “add blockchain at the end.” The Arc rail exists. The season work is to take that prototype toward a merchant-ready corridor:

- Harden confirmation, fee UX, and treasury operations (keys off the browser; no `VITE_` secret for payouts)
- Replace the simulated ARS rail with a real local payout/collection path, still settling USDC on Arc
- Merchant collect flow (QR / voice charge) with reliable reconciliation, not a one-off demo
- Production checklist: dedicated Arc RPC, Privy domains, sponsored gas so the user never needs a separate gas token mental model (on Arc, USDC is already native)
- Only after that: evaluate Arc Mainnet. We will not treat testnet faucet USDC as production.

We are **not** pitching a new token, AMM, bridge, or custom custody. Arc + native USDC is the settlement layer; MidatoPay is the voice/QR product on top.

---

## One-sentence summary

MidatoPay already runs voice and QR USDC payments on Arc Testnet with Privy embedded wallets; this season is to harden that rail into a real ARS↔USDC merchant payment product, still settling on Arc.

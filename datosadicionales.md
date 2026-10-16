# Why MidatoPay Is a Strong Fit for the Solana Ecosystem

Companion to [`README.md`](README.md). This document summarizes MidatoPay's capabilities and explains why the project is valuable for Solana. Every technical claim points to files in the repository.

---

## 1. A real economic use case

MidatoPay connects, in a single flow, a payment rail the market already uses with settlement on Solana:

1. The customer pays in pesos with Mercado Pago, a widely used QR payment provider in Argentina.
2. The merchant ends up holding USDC on Solana.

| Element | Implementation |
|---|---|
| Mercado Pago Orders API integration: dynamic QR, signed webhooks, canonical verification | `netlify/functions/lib/mercadopago.js`, `lib/paymentService.js`, `lib/paymentCore.js` |
| Automatic USDC settlement on `mainnet-beta`, with an on-chain memo | `lib/paymentWorker.js`, `lib/treasuryPayout.js` |
| Production configuration: Solana `mainnet-beta` and Mercado Pago production | `.env.production.example`, `docs/MERCADOPAGO_PRODUCCION.md` |
| Treasury on Solana Mainnet | [`7pCp94zA14dSoQC9wiqoNiPtS96XXEEirAqwbrYmbL5L`](https://explorer.solana.com/address/7pCp94zA14dSoQC9wiqoNiPtS96XXEEirAqwbrYmbL5L) on Solana Explorer |
| Real mainnet transaction | [`3hsY2qzq…STchL4hv`](https://explorer.solana.com/tx/3hsY2qzqthv6VHXPuNC7F1cvGCq333Gkk5SDyJbWVaeFbEEYaDyco6pzEY72qjip8BKZUPNCp22w16G1STchL4hv) on Solana Explorer |
| One embedded Solana wallet per merchant, created at login | Privy, `src/main.jsx` |
| A dedicated Mercado Pago point of sale per merchant | `lib/merchantPos.js` |

This covers the angle that Colosseum's analysis of previous submissions identified as open: **the merchant side**. The customer keeps paying in pesos without changing anything, and the merchant holds digital dollars with settlement that can be verified on-chain.

---

## 2. Verifiable technical capabilities

| Capability | Evidence |
|---|---|
| **A real PSP, not a simulation.** Charges go through the Mercado Pago Orders API with dynamic QR, in production or test mode | `orderBody` (`mode: "dynamic"`), `ensureOrder` |
| **Server-side payment verification.** Before settling, the worker re-reads the canonical order and requires seller, point of sale, currency (ARS), exact amount, reference and `live_mode` to match | `validateOrder` in `lib/paymentCore.js` |
| **The treasury only pays against registered charges.** Every settlement comes from a charge stored in PostgreSQL and created by an authenticated user. The destination is a Solana wallet linked to that user in Privy | `createCharge`, `assertWalletOwned`, `settlePayout` |
| **Free-form treasury payouts are blocked on mainnet.** `POST /treasury` returns 403 outside devnet | `netlify/functions/treasury.js`, `sendTreasuryPayout` |
| **Authenticated webhooks.** HMAC-SHA256 with a constant-time comparison. The notification body never authorizes a money movement | `verifyWebhook` |
| **Fresh quotes only.** Every charge requires a Chainlink USD/ARS round no older than `CHAINLINK_MAX_AGE_SECONDS` (25 hours). A stale price cannot be arbitraged against the treasury | `validateRound` in `src/priceFeed.js`, `paymentQuoteSettings` |
| **Settlement built to financial-infrastructure standards.** The signed transaction is stored before it is sent, the same bytes are always rebroadcast, delivery is recorded only at `finalized`, and an ambiguous signature goes to review instead of being re-signed | `lib/paymentWorker.js` |
| **No double spending of treasury funds.** Liquidity reservations are taken under advisory locks before each charge is accepted | `createCharge` |
| **End-to-end idempotency.** Uniqueness constraints on the key, reference, order, payment and signature. Mercado Pago calls carry `X-Idempotency-Key` | `db/migrations/20261013_mercadopago.sql` |
| **Network safety.** Mint and genesis hash per network; the RPC's genesis hash is checked before funds are reserved | `src/network.js`, `treasuryLiquidity` |
| **Verifiable on Solana Explorer.** Every receipt and every Activity row with a signature links to the explorer. The memo identifies the charge | `src/App.jsx`, `src/chain.js` |
| **Server-only secrets.** The build aborts if a `VITE_*` variable looks private | `vite.config.js`, `scripts/public-env-policy.js` |
| **Broad test suite.** 16 files and 115 tests (77 top-level tests and 38 subtests) covering the fee, HMAC, order validation, idempotency, store-before-send, finalization, refunds, quote freshness and migrations, including an embedded PostgreSQL database. CI runs with both devnet and mainnet configurations | `test/`, `.github/workflows/mercadopago-review.yml` |
| **Accounting export.** The admin CSV includes the ARS amount, fee, USDC, rate, Mercado Pago IDs and Solana signature | `src/paymentReports.js` |
| **Business model in the code.** The 0.5% fee is enforced in the function, in the insert and in a database constraint | `quoteCharge`, `CHECK(fee_bps = 50)` |

---

## 3. Stablecoins as settlement infrastructure

In MidatoPay, USDC is the **merchant's unit of account after the sale**. The merchant knows the exact USDC amount before showing the QR code, because the rate stays locked for 15 minutes.

Mercado Pago does not settle in USDC: MidatoPay is the conversion layer.

1. Mercado Pago credits the ARS to the platform's seller account.
2. MidatoPay's prefunded treasury delivers the USDC equivalent.

On Solana, settlement uses native USDC issued by Circle, with no bridges. Each payout is a public SPL transfer with its memo:

```
MIDATO|v1|inv:<mp_reference>|kind:charge_mercadopago|cur:ARS|amt:<ARS>|fx:<rate>|usdc:<amount>
```

That record makes it possible to reconcile each sale with its Mercado Pago order. It also gives the merchant a basis for invoicing, because the peso amount, the exchange rate and the signature are linked.

---

## 4. Why Solana matters for the product

| Product need | Solana feature | How MidatoPay uses it |
|---|---|---|
| Settle each charge at a cost far below a 0.5% fee | Base fee of 5,000 lamports per signature, independent of the amount | Each settlement carries a single treasury signature. Even on ARS 10,000 (a fee of about 0.03 USD at 1,650 ARS/USD), the base fee would only equal the fee with SOL at about 6,000 USD. |
| The merchant sees the money arrive at the counter | `confirmed` within seconds and `finalized` shortly after | The UI shows "Confirmed, finalizing…", and delivery is only recorded at `finalized`. |
| Merchants without crypto knowledge | Embedded Solana wallets (Privy) | The wallet is created at login with email or phone. No seed phrases. |
| A dollar balance without bridges | Native Circle USDC as an SPL token | Mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, checked with `TransferChecked` decimals |
| The merchant needs no SOL to receive | The fee payer can be a different account | The treasury pays the fee and the creation of the merchant's USDC account |
| Auditability | SPL Memo and public explorers | `MIDATO|v1` memo on every settlement |
| Growth toward institutional custody and a better experience | Squads, Solana Pay, fee sponsorship | Already part of the product roadmap (Stack screen, `src/i18n.jsx`) |

Solana is not decoration in this architecture: it is the settlement rail. It provides native USDC, a low and predictable cost per operation, embedded wallets and public traceability.

---

## 5. The 0.5% fee and the commercial proposition

**What the merchant sees:** one rate on one base. It is 0.5% of the ARS amount charged, deducted before conversion and shown on every charge. The customer pays exactly the QR amount.

| Charge (ARS) | MidatoPay fee (ARS) | Amount converted (ARS) | USDC at 1,650 ARS/USD |
|---|---|---|---|
| 10,000.00 | 50.00 | 9,950.00 | 6.030303 |
| 100,000.00 | 500.00 | 99,500.00 | 60.303030 |
| 1,000,000.00 (per-charge maximum) | 5,000.00 | 995,000.00 | 603.030303 |

USDC amounts are rounded down to 6 decimals, as in `quoteCharge`. The first example is verified in `test/payments.test.js`.

Why this structure supports adoption:

- **It is transparent.** One percentage, no hidden spread, easy to compare.
- **It is predictable.** The merchant knows how much USDC they will receive before charging.
- **The merchant pays no extra costs.** MidatoPay absorbs Mercado Pago's processing costs and Solana network fees (`docs/MERCADOPAGO_PRODUCCION.md`).
- **Settlement is automatic.** There is no manual step between the peso payment and the USDC balance.
- **It scales with volume.** Revenue grows in proportion to processed volume, while the on-chain cost per operation is minimal and does not depend on the amount.
- **It can be audited.** Each fee is recorded exactly once in `commission_ledger`, when delivery is finalized. Admin reports show recorded, estimated and under-review fees.

---

## 6. Evidence of commercial interest

**Letter of intent from Deenex Technologies S.A.S.** (16 May 2026, `business-lois/Carta_Intencion_Deenex_MidatoPay.pdf`):

- **Who Deenex is:** an omnichannel platform for food-service chains, with a PWA app, WhatsApp ordering and a loyalty CRM. It is a **distribution channel** that reaches many merchants at once.
- **Stated reach:** **500 active locations** across several Argentine provinces, with a projection of **2,000 locations by December 2026** and plans for regional expansion to Brazil and Mexico.
- **Commitments expressed**, for when the platform is available for commercial integration:
  - offer MidatoPay to the whole network;
  - co-design the go-to-market;
  - run a pilot with selected merchants, followed by training, onboarding and progressive scale-up;
  - open its communication channels with merchants;
  - move toward an NDA, a framework partnership agreement and a technical annex.
- **Validation of the thesis:** the letter describes exactly MidatoPay's proposition. The customer pays in pesos with their usual methods and the merchant receives stable assets, without passing crypto complexity on to the end consumer.

**Why it matters for Solana:**

- Food-service chains have high sales frequency and low ticket sizes. Every merchant onboarded generates recurring USDC settlements on Solana.
- A single distribution partner shortens the onboarding of hundreds of locations.

---

## 7. Adoption potential within the ecosystem

**What already exists:**

- every Mercado Pago charge produces a mainnet USDC transfer with its memo;
- one Solana wallet per merchant;
- one Mercado Pago point of sale per merchant;
- reports and export for administration.

**Expansion opportunities:**

- **More merchants.** Rollout across the Deenex network, from 500 to the projected 2,000 locations, following a pilot → onboarding → scale plan.
- **New flows:**
  - partial conversion, where the merchant chooses how much to keep in USDC;
  - supplier payments in USDC from the merchant's balance;
  - USDT as an alternative, as the LOI mentions.
- **Solana ecosystem integrations:**
  - **Solana Pay** with `reference`, to reconcile every charge on-chain and accept USDC payments;
  - **Squads**, for treasury custody;
  - **fee sponsorship** (Kora / Privy), so the merchant never needs SOL, not even when paying suppliers;
  - **Helius webhooks**, to observe settlements without polling.
- **On-chain reconciliation and traceability.** A reference plus a memo on every settlement, plus an export for the merchant's accountant. That way Solana records serve accounting.
- **Cross-border use.** The merchant can pay foreign suppliers in USDC from their balance.
- **More on-chain volume.** Every merchant sale produces a settlement on Solana, so on-chain volume grows with real commercial activity.

---

## 8. What sets MidatoPay apart from an experimental project

- **Integration with a real PSP:**
  - Mercado Pago Orders API with HMAC-verified webhooks;
  - canonical re-validation of every order (seller, point of sale, currency, amount, `live_mode`);
  - separation between test and production sellers.
- **Settlement engineering at the level of financial infrastructure**, all covered by tests:
  - signed transactions stored before they are sent;
  - identical rebroadcast;
  - recording only at `finalized`;
  - manual review instead of blind re-signing;
  - liquidity reservations under locks;
  - a fee ledger with a single entry per charge;
  - a mandatory quote-freshness limit;
  - repeatable migrations.
- **Running on Solana mainnet**, with mint and genesis-hash checks per network. The [treasury](https://explorer.solana.com/address/7pCp94zA14dSoQC9wiqoNiPtS96XXEEirAqwbrYmbL5L) and a [real transaction](https://explorer.solana.com/tx/3hsY2qzqthv6VHXPuNC7F1cvGCq333Gkk5SDyJbWVaeFbEEYaDyco6pzEY72qjip8BKZUPNCp22w16G1STchL4hv) are publicly visible on Solana Explorer.
- **An implemented monetization model:** 0.5% enforced at three levels (function, insert and database constraint).
- **Documented commercial interest:** a letter of intent from a distribution platform with 500 active locations.
- **A team with experience in the target market:** the CEO has spent more than five years working with small merchants on QR payment adoption and at payment companies.

---

## 9. Conclusion

MidatoPay has the potential to become an infrastructure layer that brings everyday commercial payments and stablecoin settlement to the Solana ecosystem.

| Axis | Summary |
|---|---|
| **Demonstrated value** | The full path from charge to settlement is built with production-grade code. A peso payment through Mercado Pago, verified server-side, becomes a finalized USDC transfer on Solana mainnet to the merchant's embedded wallet, with its memo and with the 0.5% fee recorded exactly once. |
| **Adoption potential** | A letter of intent from a platform with 500 active locations, projecting 2,000, points to a concrete channel. Every onboarded merchant turns daily peso sales into recurring USDC settlements on Solana, without changing anything for the customer. |
| **Solana's role** | Solana is the product's settlement rail: native USDC, low and predictable cost, embedded wallets, public traceability, and a clear path toward Solana Pay, Squads and fee sponsorship. |

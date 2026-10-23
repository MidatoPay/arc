# Why MidatoPay Is a Strong Fit for Arc

Companion to [`README.md`](README.md). This document summarizes MidatoPay's capabilities and explains why the project fits Arc, Circle's stablecoin-native network. Every technical claim points to files in the repository.

---

## 1. A real economic use case

MidatoPay connects, in a single flow, a payment rail the market already uses with settlement on Arc:

1. The customer pays in pesos with Mercado Pago, a widely used QR payment provider in Argentina.
2. The merchant ends up holding USDC on Arc.

| Element | Implementation |
|---|---|
| Mercado Pago Orders API integration: dynamic QR, signed webhooks, canonical verification | `netlify/functions/lib/mercadopago.js`, `lib/paymentService.js`, `lib/paymentCore.js` |
| Automatic USDC settlement on Arc Mainnet (chain ID 5042), with an on-chain memo | `lib/paymentWorker.js`, `lib/treasuryPayout.js` |
| Production configuration: Arc Mainnet and Mercado Pago production | `.env.production.example`, `docs/MERCADOPAGO_PRODUCCION.md` |
| One embedded EVM wallet per merchant, created at login | Privy, `src/main.jsx` |
| A dedicated Mercado Pago point of sale per merchant | `lib/merchantPos.js` |

This covers **the merchant side**. The customer keeps paying in pesos without changing anything, and the merchant holds digital dollars with settlement that can be verified on-chain.

---

## 2. Verifiable technical capabilities

| Capability | Evidence |
|---|---|
| **A real PSP, not a simulation.** Charges go through the Mercado Pago Orders API with dynamic QR | `orderBody` (`mode: "dynamic"`), `ensureOrder` |
| **Server-side payment verification.** Before settling, the worker re-reads the canonical order and requires seller, point of sale, currency (ARS), exact amount, reference and `live_mode` to match | `validateOrder` in `lib/paymentCore.js` |
| **The treasury only pays against registered charges.** Every settlement comes from a charge stored in PostgreSQL and created by an authenticated user. The destination is the Arc wallet linked to that user in Privy | `createCharge`, `assertWalletOwned`, `settlePayout` |
| **Sandbox payments never release real USDC.** The Mercado Pago test environment is disabled on Arc Mainnet, and free-form treasury payouts (`POST /treasury`) return 403 | `paymentSettings`, `netlify/functions/treasury.js` |
| **Authenticated webhooks.** HMAC-SHA256 with a constant-time comparison. The notification body never authorizes a money movement | `verifyWebhook` |
| **Fresh quotes only.** Every charge requires a Chainlink USD/ARS round no older than `CHAINLINK_MAX_AGE_SECONDS` (25 hours) | `validateRound` in `src/priceFeed.js`, `paymentQuoteSettings` |
| **Settlement built to financial-infrastructure standards.** Treasury nonces are assigned under a database lock, the signed transaction is stored before it is sent, the same bytes are always rebroadcast, and a reverted receipt or a nonce consumed elsewhere goes to review instead of being re-signed | `lib/paymentWorker.js` |
| **No double spending of treasury funds.** Liquidity reservations are taken under advisory locks before each charge is accepted, and a fixed gas reserve is never counted as payout liquidity | `createCharge`, `treasuryLiquidity` |
| **End-to-end idempotency.** Uniqueness constraints on the key, reference, order, payment and transaction hash. Mercado Pago calls carry `X-Idempotency-Key` | `db/migrations/20261013_mercadopago.sql` |
| **Network safety.** Every RPC is checked against chain ID 5042 before funds are reserved or transactions are prepared; outcomes are verified from the receipt's USDC `Transfer` log | `src/network.js`, `lib/arcRpc.js`, `lib/transferWorker.js` |
| **User transfers without blind signing.** The server prepares the exact transaction, the embedded wallet signs it after an in-app approval that shows the gas in USDC, and the server checks it is byte-identical, signed by the sender and simulates it before storing | `lib/transferChain.js`, `lib/transferService.js`, `src/TransferApproval.jsx` |
| **Verifiable on the Arc explorer.** Every receipt and every Activity row with a transaction hash links to the explorer. The memo identifies the charge | `src/Movimientos.jsx`, `src/chain.js` |
| **Server-only secrets.** The build aborts if a `VITE_*` variable looks private | `vite.config.js`, `scripts/public-env-policy.js` |
| **Broad test suite.** 27 test files and 193 tests covering the fee, HMAC, order validation, idempotency, store-before-send, nonce assignment, receipts, refunds, quote freshness, EIP-681 parsing, user-signed transfers and migrations, with an embedded PostgreSQL database and a simulated Arc RPC | `test/`, `.github/workflows/mercadopago-review.yml` |
| **Accounting export.** The admin CSV includes the ARS amount, fee, USDC, rate, Mercado Pago IDs and transaction hash | `src/paymentReports.js` |
| **Business model in the code.** The 0.5% fee is enforced in the function, in the insert and in a database constraint | `quoteCharge`, `CHECK(fee_bps = 50)` |

---

## 3. Stablecoins as settlement infrastructure

In MidatoPay, USDC is the **merchant's unit of account after the sale**. The merchant knows the exact USDC amount before showing the QR code, because the rate stays locked for 15 minutes.

Mercado Pago does not settle in USDC: MidatoPay is the conversion layer.

1. Mercado Pago credits the ARS to the platform's seller account.
2. MidatoPay's prefunded treasury delivers the USDC equivalent.

On Arc, USDC is the network's native asset. Each payout is a public transaction through Arc's Memo contract, which forwards the USDC transfer and emits the memo:

```
MIDATO|v1|inv:<mp_reference>|kind:charge_mercadopago|cur:ARS|amt:<ARS>|fx:<rate>|usdc:<amount>
```

That record makes it possible to reconcile each sale with its Mercado Pago order. It also gives the merchant a basis for invoicing, because the peso amount, the exchange rate and the transaction hash are linked.

---

## 4. Why Arc matters for the product

| Product need | Arc feature | How MidatoPay uses it |
|---|---|---|
| One currency end to end | USDC is the gas token | Balances, payouts, fees and gas are all in USDC. The merchant never needs a second token, and the treasury funds payouts and gas from one balance. |
| Settle each charge at a cost far below a 0.5% fee | Stable, USDC-denominated fees (EIP-1559 with a 20 gwei floor; Arc targets about US$0.001 per ERC-20 transfer) | On ARS 10,000 the fee is about 0.03 USD; a payout's gas is a small fraction of that. |
| Know when the money has really arrived | Deterministic finality (no reorgs, no confirmation counting) | A successful receipt is final, so delivery and the fee are recorded once, as soon as the receipt exists. |
| Merchants without crypto knowledge | Standard EVM wallets | Privy creates the wallet at login with email or phone. No seed phrases. |
| Auditability | Memo contract and public explorer | `MIDATO|v1` memo on every settlement. |
| Familiar tooling | EVM compatibility | `ethers` v6, EIP-1559 transactions and EIP-681 payment requests in the scanner. |

Arc is not decoration in this architecture: it is the settlement rail. It provides native USDC as both money and gas, predictable cost per operation, deterministic finality and public traceability.

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
- **The merchant pays no extra costs on charges.** MidatoPay absorbs Mercado Pago's processing costs and the Arc gas of each payout. When merchants send USDC themselves, they pay that transfer's gas in USDC, shown before they confirm.
- **Settlement is automatic.** There is no manual step between the peso payment and the USDC balance.
- **It scales with volume.** Revenue grows in proportion to processed volume, while the on-chain cost per operation is small and does not depend on the amount.
- **It can be audited.** Each fee is recorded exactly once in `commission_ledger`, when delivery is final. Admin reports show recorded, estimated and under-review fees.

---

## 6. Evidence of commercial interest

MidatoPay has two letters of intent that cover both sides of adoption: a **distribution channel** (Deenex) and a **merchant** (Supermercado Soler).

### 6.1 Deenex Technologies S.A.S.

**Letter of intent** (16 May 2026, `business-lois/Carta_Intencion_Deenex_MidatoPay.pdf`):

- **Who Deenex is:** an omnichannel platform for food-service chains, with a PWA app, WhatsApp ordering and a loyalty CRM. It is a **distribution channel** that reaches many merchants at once.
- **Stated reach:** **500 active locations** across several Argentine provinces, with a projection of **2,000 locations by December 2026** and plans for regional expansion to Brazil and Mexico.
- **Commitments expressed**, for when the platform is available for commercial integration:
  - offer MidatoPay to the whole network;
  - co-design the go-to-market;
  - run a pilot with selected merchants, followed by training, onboarding and progressive scale-up;
  - open its communication channels with merchants;
  - move toward an NDA, a framework partnership agreement and a technical annex.
- **Validation of the thesis:** the customer pays in pesos with their usual methods and the merchant receives stable assets, without passing crypto complexity on to the end consumer.

### 6.2 Supermercado Soler

**Letter of intent** (26 November 2025, `business-lois/Carta_Intencion_Wang_Midatopay.pdf`), signed by the supermarket's owner:

- **Who it is:** a supermarket, the exact merchant profile MidatoPay targets: daily peso revenue that loses value between the sale and its use.
- **What it values:** converting peso revenue into digital dollars (stablecoins) to protect the value of its daily cash against inflation and devaluation.
- **What attracts it most:** MidatoPay's model of **pooled volume purchasing with other supermarkets**, which could offer better conversion rates and operational benefits.
- **Next step it asks for:** a product demo and the evaluation of a pilot in its operations.

### 6.3 Why it matters for Arc

- The two letters validate the thesis from both ends: a channel that reaches hundreds of locations, and a merchant that asks to try the product in its own operations.
- Food-service chains and supermarkets have high sales frequency. Every merchant onboarded generates recurring USDC settlements on Arc.
- A single distribution partner shortens the onboarding of hundreds of locations.
- Pooled volume across merchants is a natural driver of larger, recurring USDC flows.

---

## 7. Adoption potential within the ecosystem

**What exists in the code:**

- every Mercado Pago charge produces an Arc Mainnet USDC transfer with its memo;
- one Arc wallet per merchant;
- one Mercado Pago point of sale per merchant;
- user-signed USDC transfers by text, QR (EIP-681) and voice;
- reports and export for administration.

**Expansion opportunities:**

- **More merchants.** Rollout across the Deenex network, from 500 to the projected 2,000 locations, following a pilot → onboarding → scale plan, and a pilot with Supermercado Soler.
- **Pooled volume purchasing.** Grouping the conversion volume of several supermarkets to obtain better conversion rates.
- **New flows:**
  - partial conversion, where the merchant chooses how much to keep in USDC;
  - supplier payments in USDC from the merchant's balance;
  - other Circle stablecoins on Arc where suppliers need them.
- **Circle ecosystem integrations:**
  - CCTP to move USDC between Arc and other networks (treasury funding, supplier payments);
  - institutional treasury custody;
  - gas sponsorship for merchant-initiated transfers, if the product decides to absorb it.
- **On-chain reconciliation and traceability.** A reference plus a memo on every settlement, plus an export for the merchant's accountant.
- **Cross-border use.** The merchant can pay foreign suppliers in USDC from their balance.

---

## 8. What sets MidatoPay apart from an experimental project

- **Integration with a real PSP:**
  - Mercado Pago Orders API with HMAC-verified webhooks;
  - canonical re-validation of every order (seller, point of sale, currency, amount, `live_mode`);
  - separation between test and production sellers, with sandbox payments unable to release real USDC.
- **Settlement engineering at the level of financial infrastructure**, all covered by tests:
  - nonce assignment under a lock;
  - signed transactions stored before they are sent;
  - identical rebroadcast;
  - recording only on a successful receipt;
  - manual review instead of blind re-signing;
  - liquidity reservations under locks, with a gas reserve;
  - a fee ledger with a single entry per charge;
  - a mandatory quote-freshness limit;
  - repeatable migrations.
- **Built for Arc Mainnet**, with chain ID checks on every RPC and receipt-based verification of what moved.
- **An implemented monetization model:** 0.5% enforced at three levels (function, insert and database constraint).
- **Documented commercial interest:** two letters of intent, one from a distribution platform with 500 active locations and one from a supermarket that asks for a demo and a pilot.
- **A team with experience in the target market:** the CEO has spent more than five years working with small merchants on QR payment adoption and at payment companies.

---

## 9. Conclusion

MidatoPay has the potential to become an infrastructure layer that brings everyday commercial payments and stablecoin settlement to Arc.

| Axis | Summary |
|---|---|
| **Demonstrated value** | The full path from charge to settlement is built with production-grade code: a peso payment through Mercado Pago, verified server-side, becomes a final USDC transfer on Arc to the merchant's embedded wallet, with its memo and with the 0.5% fee recorded exactly once. The first Arc Mainnet operations are still to be executed and published. |
| **Adoption potential** | Two letters of intent point to concrete demand: a platform with 500 active locations, projecting 2,000, and a supermarket that wants to pilot the product. Every onboarded merchant turns daily peso sales into recurring USDC settlements, without changing anything for the customer. |
| **Arc's role** | Arc is the product's settlement rail: USDC as both money and gas, predictable fees, deterministic finality and public traceability. |

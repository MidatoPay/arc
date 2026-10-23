# Inventario de dependencias Solana

Números de línea aproximados (±3) donde se indica `~`. Fuente: lectura directa y relevamiento con sub-agentes de solo lectura.

## 1. Paquetes npm

| Paquete | Declarado | Instalado (lock) | Uso | Destino |
|---|---|---|---|---|
| `@solana/kit` | ^8.3.0 | 8.3.0 | cliente + server (tx, firmas, `isAddress`, RPC) | eliminar |
| `@solana-program/token` | ^0.16.1 | 0.16.1 | ATA, `TransferChecked`, `fetchMaybeToken` | eliminar |
| `@solana-program/memo` | ^0.13.1 | 0.13.1 | Memo | eliminar |
| `@solana-program/system` | ^0.14.1 | 0.14.1 | sin uso encontrado | eliminar |
| `bs58` | ^6.0.0 | 6.0.0 | firmas/keys base58 | eliminar |
| `buffer` | ^6.0.3 | 6.0.3 | polyfill de Privy + base64 de wires | conservar (Privy) |
| `ethers` | ^6.13.4 | 6.17.0 | solo Chainlink hoy | conservar, pasa a ser la librería EVM principal |
| `viem` | — (transitivo de Privy) | 2.55.5 | — | evaluar dependencia directa (ver OPEN_QUESTIONS) |
| `@solana/web3.js` | — (transitivo) | 1.98.4 | no usado directamente | desaparece si Privy no lo requiere |

## 2. Frontend (`src/`)

| Archivo | Dependencia Solana |
|---|---|
| `main.jsx:2-7` | polyfills `Buffer/global/process` |
| `main.jsx:12,79-80,87-115` | `createSolanaRpcSubscriptions`; Privy `walletList:["phantom"]` (workaround de readiness), `walletChainType:"solana-only"`, `embeddedWallets.solana`, `solana.rpcs` |
| `main.jsx:71` | texto de ayuda "Embedded wallets for Solana" |
| `network.js:2-19` | clusters, genesis, CAIP `solana:*`, `api.*.solana.com`, mints, `VITE_SOLANA_CLUSTER` |
| `chain.js:1-50` | Kit RPC/transport, `VITE_SOLANA_WSS`, mint/decimales, `explorer.solana.com?cluster=` |
| `solana.js` (todo) | ATA, `TransferChecked`, Memo, blockhash, `signAndSendTransaction`, `getSignatureStatuses`, fee 5000 lamports + renta ATA, `solUsdApprox=150`, `keypairSignerFromSecret`, `findIncomingTransfer`, `extractMemoFromTx` |
| `transfers.js:2-3,50,84-86` | `Buffer` base64 de wires, `SOLANA.chain`, key de localStorage con cluster |
| `transfers.js:17-32` | textos de error que mencionan Solana / blockhash |
| `primaryWallet.js:1` | `isAddress` Kit, `chainType==='solana'` |
| `App.jsx:3-4` | hooks `@privy-io/react-auth/solana`, `isAddress` Kit |
| `App.jsx:25-30` | `armarMemo, estimateUsdcTransfer, getUsdcBalance, nuevaFactura, sendUsdc` |
| `App.jsx:1450-1543,1572-1578,1923` | panel de gas en SOL, "En Solana el fee es SOL" |
| `App.jsx:70,1379,2795,3073,3103,3263,3375` | gating `SOLANA.cluster==="devnet"` |
| `App.jsx:2265-2275` | matching de mensajes de error RPC |
| `App.jsx:2518` | etiqueta `Solana ${cluster}` |
| `payQr.js:4,50-51` | `isAddress` Kit |
| `scanTarget.js:1` + todo el parser | Solana Pay URIs (`spl-token`, `reference`, `memo`, `sol_request`) |
| `contacts.js:1,39,108-137`, `ContactsScreen.jsx:2,224,238`, `SendScreen.jsx:2,58-61` | `isAddress` Kit, flag `solanaCompatible` |
| `Movimientos.jsx:19,26-28,251,275,285,309,449,711` | regex base58, explorer, filtro convert devnet |
| `TransferApproval.jsx:9,85-86`, `TransferReceipt.jsx:12,29,138-159` | "Solana {network}", "0 SOL", regex base58 |
| `PayScan.jsx:5,18,104,329,364-365,404` | `SOLANA.usdcMint`, "USDC Solana", nota Solana Pay |
| `ChargeSummary.jsx:83,268-293`, `ProfileScreen.jsx:3,125-129` | explorer, faucet devnet |
| `TreasuryWalletExport.jsx:3`, `treasuryWalletExport.js:1` | hooks Privy `/solana`, `chainType==="solana"` |
| `charges.js:3,73-148` | key localStorage con cluster; códigos `solana_*`, `insufficient_treasury_sol` |
| `transactions.js:8,76` | cache por cluster; hash = firma base58 |
| `PaymentReports.jsx:8`, `paymentReports.js:9` | `devnet→test`; CSV con firma |
| `flows.js:23`, `fiatRail.js:27` | gating devnet |
| `i18n.jsx` / `i18n.zh.js` | ~45 claves con Solana/SOL/devnet/explorer/Solana Pay (detalle por línea en el informe del sub-agente; resumen en MIGRATION_IMPACT §2.6) |
| `index.html:12` | título "MidatoPay × Solana" |

## 3. Backend (`netlify/functions/`)

| Archivo | Dependencia Solana |
|---|---|
| `lib/treasuryPayout.js:4-26` | imports Kit / token / memo / bs58 |
| `lib/treasuryPayout.js:33-80` | RPC `SOLANA_RPC || VITE_SOLANA_RPC`; secret `TREASURY_SECRET_KEY || TREASURY_PRIVATE_KEY` (base58/JSON, 32/64 bytes) |
| `lib/treasuryPayout.js:188-260` | payout: ATA idempotente, `TransferChecked`, Memo, blockhash, v0 |
| `lib/treasuryPayout.js:263-302` | demo devnet `sendTreasuryPayout` |
| `lib/treasuryPayout.js:~304-330` | `treasuryRpc`, `treasuryLiquidity` (token accounts, SOL, `getGenesisHash`) |
| `lib/transferChain.js` (todo) | `transferRpc`, ATA, `sourceBalance` (valida owner/mint/decimals/state), `prepareTransfer` (fee payer tesorería, check System Program, `getFeeForMessage`, renta 165 bytes), `validateUserSignature` (ed25519), `signSponsoredTransfer` (partial sign) |
| `lib/transferService.js:~15-19` | `TRANSFER_DAILY_SOL_BUDGET`, `TRANSFER_MAX_SOL_COST` en 9 decimales (lamports) |
| `lib/transferService.js` (create/submit/recover) | `getBlockHeight`, `getBalance` SOL del fee payer, `simulateTransaction`, `cost_lamports`, `userFeeSol:'0'` |
| `lib/transferWorker.js` | `getGenesisHash`, `getSignatureStatuses`, `getTransaction` jsonParsed, Token program `Tokenkeg…`, `transferChecked` |
| `lib/paymentWorker.js:10-53` | `getSignatureStatuses`, `getBlockHeight`, `sendTransaction`, `last_valid_block_height`, códigos `solana_*` |
| `lib/paymentService.js:2` | `isAddress` Kit, `assertWalletOwned` con `primarySolanaWallet` |
| `lib/reconcile.js` | `getTokenAccountsByOwner`, `getSignaturesForAddress`, `getTransaction`, `spl-memo`, Token/ATA program ids |
| `lib/rpcProxy.js:5-8,26-29` | allowlist de métodos Solana |
| `lib/paymentPreflight.js:9,60-71` | `SOLANA_RPC` requerido, check `solana_network` (genesis), treasury |
| `lib/paymentRuntime.js:~46` | `SOLANA_RPC` en `paymentSettings` |
| `lib/paymentReporting.js:~28` | `production→'mainnet-beta'`, si no `'devnet'` |
| `lib/paymentDatabase.js:2-16` | columnas requeridas (`signed_wire`, `sponsor_day`, `last_synced_block`, …) |
| `lib/primaryWallet.js` | `primarySolanaWallet` |
| `rpc.js` | target `SOLANA_RPC || VITE_SOLANA_RPC || NETWORK.rpc`, `chain:'solana'` |
| `balance.js:1-2,13` | Kit + token, ATA |
| `treasury.js:5` | `isAddress` Kit; POST bloqueado fuera de devnet |
| `transactions.js:~15` | regex base58; POST cliente solo devnet |
| `contacts.js:1,13,24,37` | `isAddress` Kit, `solanaCompatible` |
| `treasury-export-access.js` | compara wallet principal Solana del admin con la tesorería |

## 4. Base de datos

> Se eliminan o renombran según la propuesta de `TARGET_ARCHITECTURE.md §10` (pendiente de aprobación).

| Objeto | Detalle Solana |
|---|---|
| `charges.network` | `CHECK IN ('devnet','mainnet-beta')` (`20261013_mercadopago.sql:15-31`) |
| `commission_ledger.network` | mismo CHECK (`20261013_commission_history.sql`) |
| `transactions.network`, `wallets.network` | `DEFAULT 'devnet'` |
| `charges.signature/signed_wire/last_valid_block_height/payout_memo` | firma base58, wire base64, expiración por blockhash |
| `wallet_transfers.unsigned_wire NOT NULL`, `last_valid_block_height NOT NULL`, `fee_payer NOT NULL`, `cost_lamports NOT NULL CHECK>0`, `signature`, `signed_wire` | modelo de patrocinio Solana |
| `payment_payout_attempts` | firma, wire, `last_valid_block_height` (tabla sin uso en código) |
| `transactions.block`, `wallets.last_synced_block` | slot Solana |
| `transactions.fee` | semántica mixta (SOL string / 0 / NULL) |
| `usdc_raw BIGINT` (6 decimales) | **no** es específico de Solana: el ERC-20 USDC de Arc también usa 6 decimales |

## 5. Configuración, scripts, CI, tests y docs

- **Variables**: ver `ENVIRONMENT_VARIABLES.md`.
- **`vite.config.js:12-17`**: `define global` (polyfill).
- **`netlify.toml:7`**: `SECRETS_SCAN_OMIT_KEYS` incluye `VITE_SOLANA_CLUSTER`; comentario de `/treasury` menciona `TREASURY_SECRET_KEY`.
- **`.gitignore:8`**: `treasury-devnet.json` (keypair Solana).
- **Scripts**: `prepare-payments-env.js:9-18` (defaults `api.mainnet-beta.solana.com`), `check-functions.js:6,8`, `provision-mercadopago-test.js:15` (exige devnet), `audit-primary-wallets.js` (`chainType==='solana'`), `check-payments-config.js` (preflight).
- **CI** `.github/workflows/mercadopago-review.yml:14-16`: matriz `cluster: [devnet, mainnet-beta]`.
- **Tests fuertemente acoplados**: `transfers`, `payments` (asserts de mint/CAIP), `treasury-network` (genesis), `rpc-transport` (transport Kit), `payout-follow` (estados de firma), `wallet-contacts` (base58, `chainType:'solana'`, asserción inversa sobre contacto EVM), `treasury-wallet-export`, `transfer-ui` ("0 SOL", "Solana Mainnet").
- **Tests con acople leve** (valores de `network`): `payment-reports`, `merchant-pos`, `payment-database`, `payment-activity`.
- **Tests no abiertos** (acople sin verificar): `payment-handlers`, `charge-received`, `rpc-efficiency`, `redirect-credentials`, `payment-preflight`, `treasury-access`, `install-reminder`, `merchant-profile`.
- **Docs y reglas**: `README.md`, `CLAUDE.md`, `SOLANA-RULES.md`, `.kiro/steering/solana-first.md` (dice "no se vuelve a Arc"), `docs/USDC_TRANSFERS.md`, `docs/REVISION_MERCADOPAGO_PREMERGE.md`, `docs/MERCADOPAGO_PRODUCCION.md`, `datosadicionales.md`, `solanaRevision/` (material de evaluación).

## 6. Sin dependencia de Solana

`src/priceFeed.js`, `src/chainlinkConfig.js`, `src/fx.js`, `netlify/functions/eth-rpc.js`, `quote.js`, `lib/quoteSettings.js`, `lib/mercadopago.js`, `lib/merchantPos.js`, `merchant-*`, `parse-intent.js`, `mercadopago-webhook.js`, `payments-dispatch.js`, `transfers-dispatch.js`, `lib/readCache.js`, `lib/fetchAdapter.js`, PWA.

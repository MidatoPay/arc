# Arquitectura actual (Solana)

Estado relevado sobre la branch `fv-migracionArc` (base `97a6c00`, historia de `MidatoPay/solanahackcba`). Solo lectura: no se modificó código.

Convenciones: **[V]** verificado leyendo el código; **[P]** parcialmente leído (solo búsquedas dirigidas); **[S]** supuesto.

> Base de datos: solo se cambia lo listado en `TARGET_ARCHITECTURE.md §10` (limpieza de Solana y de lo que no se usa).

## 1. Vista general

- **Frontend**: Vite + React 18 SPA, sin router (tabs con `useState`). Casi toda la UI está en `src/App.jsx`. [V]
- **Backend**: Netlify Functions (mezcla de v1 `exports.handler` y v2 con rutas nativas + rate limit) en `netlify/functions/`, lógica compartida en `netlify/functions/lib/`. [V]
- **Base de datos**: Postgres (Aiven), esquema en `db/schema.sql` + `db/migrations/*.sql`. Tests con PGlite. [V]
- **Auth y wallets**: Privy (email/SMS) con **embedded wallet Solana** por usuario. [V]
- **Red**: Solana `devnet` (default) o `mainnet-beta`, elegida por `VITE_SOLANA_CLUSTER`. Producción ya opera en `mainnet-beta` (tesorería `7pCp94zA…`, según `datosadicionales.md`). [V]
- **Activo**: USDC SPL (Circle), 6 decimales, identificado por mint + Token Program. Fees en **SOL**. [V]
- **FX**: Chainlink USD/ARS en **Ethereum Mainnet** (independiente de Solana) vía `ethers` v6. [V]

```
Browser (React)
  ├─ Privy (login + embedded wallet Solana, firma)
  ├─ /rpc  ──► netlify rpc.js ──► Solana RPC (allowlist de métodos, auth Privy)
  ├─ /eth-rpc ─► eth-rpc.js ─► Ethereum RPC (solo Chainlink USD/ARS)
  ├─ /balance, /wallet, /transfers, /charges, /treasury, /transactions, /contacts, ...
  ▼
Netlify Functions ──► Postgres (Aiven)
  ├─ payments worker (cron 1 min) ─► Mercado Pago API + payout USDC desde tesorería
  ├─ transfers worker (cron 1 min) ─► broadcast/seguimiento de envíos patrocinados
  └─ reconcile-wallets (cron 15 min) ─► detección de USDC entrante vía Solana RPC
```

## 2. Módulos chain-layer

| Módulo | Rol | Ref |
|---|---|---|
| `src/network.js` | Pivote de red compartido browser/server: cluster, genesis hash, CAIP chain id, RPC/WSS públicos, mint USDC. Lee `VITE_SOLANA_CLUSTER`. | [V] |
| `src/chain.js` | `RPC_PROXY` (`/rpc`), `WSS_URL`, `USDC_MINT`, `USDC_DECIMALS=6`, objeto `SOLANA`, links a Solana Explorer, RPC Kit con Bearer token de Privy. | [V] |
| `src/rpcSession.js` | Token Privy de sesión para el proxy RPC (patrón agnóstico de cadena). | [V] |
| `src/solana.js` | Primitivas on-chain cliente: ATA, `TransferChecked`, Memo, `sendUsdc` (Privy `signAndSendTransaction`), estimación de fee en SOL, polling de confirmación, `findIncomingTransfer`. | [V] |
| `src/transfers.js` | Motor de envíos patrocinados del lado cliente (aprobación, idempotencia, recuperación, firma *sign-only*). | [V] |
| `src/primaryWallet.js` | Selección de wallet principal Privy (`chainType==='solana'`, HD index 0). Compartido con el server. | [V] |
| `src/main.jsx` | `PrivyProvider` Solana-only + polyfills `Buffer/global/process`. | [V] |
| `netlify/functions/lib/treasuryPayout.js` | Firmante de tesorería (keypair Solana), payouts SPL + Memo, liquidez con check de genesis. | [V] |
| `netlify/functions/lib/transferChain.js` | Construcción de envíos patrocinados (tesorería = fee payer), verificación de firma del usuario, co-firma. | [V] |
| `netlify/functions/lib/transferService.js` | Crear/enviar transfers: cuota 2/día, presupuesto en lamports, reservas, simulación. | [V] |
| `netlify/functions/lib/transferWorker.js` | Máquina de estados de seguimiento y verificación del `transferChecked` finalizado. | [V] |
| `netlify/functions/lib/paymentWorker.js` | Orquestación Mercado Pago → payout USDC: persistir wire firmado antes de enviar, rebroadcast, expiración por blockhash. | [V] |
| `netlify/functions/lib/reconcile.js` | Reconciliación de entrantes con `getSignaturesForAddress` + balances de token pre/post + memo. | [V] (vía sub-agente) |
| `netlify/functions/lib/rpcProxy.js` | Proxy autenticado con allowlist Solana y allowlist Ethereum (solo Chainlink). | [V] |
| `netlify/functions/balance.js` | Saldo USDC del usuario leyendo su ATA (`finalized`). | [V] (vía sub-agente) |
| `netlify/functions/lib/paymentPreflight.js` | Chequeos de preparación: variables, genesis hash, tesorería, DB, Privy. | [V] |

## 3. Flujos principales

### 3.1 Login y wallet
1. Privy login (email/SMS) → `createOnLogin: "users-without-wallets"` crea wallet Solana.
2. `primarySolanaWallet(user)` elige la única wallet embebida Solana con HD index 0.
3. `GET /wallet` sincroniza la wallet principal en `wallets` (con auditoría si cambia) y el cliente solo usa la address si coincide con la del server.

### 3.2 Saldo
`GET /balance` → server deriva ATA y lee `fetchMaybeToken` (`finalized`), devuelve `{address, network, usdc}`; cliente valida `network===SOLANA.cluster`. Refresco visible cada 120 s. El browser no lee saldo on-chain directamente.

### 3.3 Envío USDC (camino principal: patrocinado)
Voz / PayScan / SendScreen → `App.sendPayment` → `useSponsoredTransfers`:
1. Modal de aprobación → `POST /transfers` (Idempotency-Key, localStorage para recuperación).
2. Server (`prepareTransfer`): tx v0 con **fee payer = tesorería**, `CreateATAIdempotent` (renta la paga la tesorería), `TransferChecked` (autoridad = usuario), Memo `MIDATO|v1|inv:transfer_<id>|kind|usdc`. Guarda `unsigned_wire`, `last_valid_block_height`, `cost_lamports`.
3. Cliente firma *sign-only* con Privy `useSignTransaction`.
4. `POST /transfers/:id/submit`: verifica firma ed25519 y bytes idénticos, cuota, saldo menos reservas, presupuesto diario/individual en lamports, saldo SOL de la tesorería, simula, co-firma y persiste `signed_wire` (sin broadcast).
5. Worker: broadcast, `getSignatureStatuses`, verificación del `transferChecked` finalizado, inserta en `transactions`, estado `completed`. Blockhash vencido sin estado → `manual_review`.
El usuario paga **0 SOL**; cupo 2 envíos/día (día de Buenos Aires).

### 3.4 Cobro Mercado Pago → payout USDC
`POST /charges` → cotización Chainlink estricta, fee fijo 50 bps, reserva de liquidez de tesorería bajo advisory lock → orden MP con QR dinámico → webhook HMAC → inbox → worker:
`reconcileCharge` → `settlePayout`: arma y firma payout (ATA + TransferChecked + Memo), **persiste firma + wire antes del broadcast**, rebroadcast del mismo wire, éxito solo en `finalized`, blockhash vencido sin estado → revisión manual. `finalizeDelivery` inserta en `transactions` y `commission_ledger` en una transacción.

### 3.5 Cobro P2P por QR/link
`payQr.buildPayUrl` (`?pay=addr:..,who:..,ars:..,inv:..`), validación con `isAddress` de Kit. El pagador paga con el motor de envíos (`kind: charge_p2p`). Detección de entrantes del lado server (`/transactions` + `reconcile-wallets`). `findIncomingTransfer` del cliente existe pero no tiene callers. [P]

### 3.6 Escaneo
`scanTarget.parseScanTarget`: links MidatoPay, URIs **Solana Pay** (`solana:` con `spl-token`, `reference`, `memo`) y addresses base58 planas.

### 3.7 Convert ARS↔USDC (demo, solo devnet)
ARS→USDC: `POST /treasury` firma server-side y paga (bloqueado fuera de devnet). USDC→ARS: el usuario firma y envía con `sendUsdc` (paga fee en SOL) a la tesorería; rail ARS simulado.

### 3.8 Historial, reportes, export de tesorería
`/transactions` (lista + reconciliación inline), `Movimientos.jsx` con links al explorer, reportes admin + CSV con firma, export de la wallet de tesorería vía Privy `useExportWallet` (solo admin cuya wallet principal == tesorería).

## 4. Manejo de errores, reintentos y confirmaciones

- `withRetry`: 4 intentos con backoff exponencial solo ante rate-limit (429, -32429).
- Payouts y transfers: nunca re-firman a ciegas; "ausencia en un RPC no prueba no-ejecución" → `manual_review`.
- Advisory locks: `charge:id`, `treasury:addr`, `transfer:id`, `transfer-user`, `transfer-create`, `transfer-budget`, `primary-wallet`.
- Unicidad: `signature UNIQUE` en `charges` y `wallet_transfers`; `UNIQUE(user_id,network,hash)` en `transactions`.
- `PaymentError(code,status)` y mapeo de errores de DB sin filtrar SQL ni secretos.

## 5. Lo que no depende de la cadena (se preserva)

Privy auth y verificación server-side de tokens; Mercado Pago (Orders API, HMAC, inbox, POS por usuario, cancelación/expiración, idempotencia); cotización Chainlink y fee 50 bps (función + insert + `CHECK`); `commission_ledger` y reportes; contactos, perfiles de comercio, parse-intent (Anthropic) y parser local; i18n (es/en/zh); PWA; cron schedules y rate limits; política de variables públicas (`scripts/public-env-policy.js`).

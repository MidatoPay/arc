# Plan de migración

Borrador sujeto a las respuestas de `OPEN_QUESTIONS.md`. **No se implementa nada hasta tu aprobación explícita.** Cada etapa termina con `npm test`, `npm run build` y `npm run functions:check` en verde.

> **Base de datos**: solo los cambios aprobados de `TARGET_ARCHITECTURE.md §10` (limpieza de Solana y de lo que no se usa); nada más. Decisiones vigentes: app nueva, solo Arc Mainnet, el usuario paga su gas, la tesorería paga el gas de sus payouts, sin cupo diario.

## 0. Prerrequisitos (operador, fuera del código)

1. Aprobación del plan. Prohibido durante la implementación: correr migraciones contra cualquier base (la de Solana no se toca), y hacer push.
2. Privy dashboard: habilitar embedded wallets EVM; dominios.
3. Tesorería Arc Mainnet custodiada y fondeada por el equipo MidatoPay.
4. Verificaciones de `ARC_MAINNET_RESEARCH.md §9` aplicables (lecturas, sin mover fondos).

## 1. Etapas

| # | Etapa | Contenido | Depende de |
|---|---|---|---|
| 1 | Configuración de red | `src/network.js`, `src/chain.js`; constantes verificadas de Mainnet; guardia `eth_chainId`; valor de `network` según D-1; variables a Arc (N-7) | D-1, N-7 |
| 2 | Dependencias | Quitar Solana; fijar `viem` si aplica | Q-14 |
| 3 | Wallet y Privy | `main.jsx`, `primaryWallet` (cliente/server/script), `/wallet`, export de tesorería | 1 |
| 4 | DB (limpieza aprobada, C-1) | Cambios de `TARGET_ARCHITECTURE.md §10` editando `db/schema.sql` y `db/migrations/*` en el lugar; `migrate-payments.js`, `paymentDatabase.js`, tests PGlite | D-1, D-2, D-3 |
| 5 | Tesorería y payouts MP | `treasuryPayout`, `settlePayout`/`followPayout`, nonce bajo lock, liquidez con gas propio de la tesorería, preflight | 1, 4, N-5 |
| 6 | Envíos de usuario (gas a cargo del usuario) | `transferChain/Service/Worker` + `src/transfers.js`, reserva de gas en el saldo, sin cupo diario | 3, 4, N-3, N-4, N-8 |
| 7 | Saldo, proxy RPC | `balance.js`, `rpcProxy.js` allowlist EVM | 1 |
| 8 | Reconciliación | `reconcile.js`, `transactions.js`, `reconcile-wallets.js` | 1, 4, Q-7 |
| 9 | Escaneo, links, contactos | `payQr`, `scanTarget` (Q-10), `contacts` | 1 |
| 10 | UI y textos | Panel de gas en USDC, etiquetas de red, explorer, i18n es/en/zh | 3–9 |
| 11 | Funciones de prueba | Convert, guest, faucet y MP test quedan inaccesibles en mainnet; mantener desactivadas o quitar (N-6) | N-6 |
| 12 | Docs y reglas | README, CLAUDE.md, reglas, steering (si Q-15) | todo |
| 13 | Verificación final | Búsqueda de referencias Solana residuales; pruebas en Arc Testnet | todo |

## 2. Estrategia de tests

- **Unitarios (node:test + PGlite, como hoy)**: red y chainId; parseo/validación de addresses EVM; unidades 6/18 decimales y truncado; armado y verificación EIP-712; armado de tx de payout (chainId, piso de 20 gwei, destino, datos de Memo); asignación de nonce concurrente; máquina de estados por recibo (`status 1/0`, sin recibo, nonce consumido, `validBefore` vencido); presupuesto y colchón de gas sin doble conteo; allowlist del proxy; reconciliación con logs simulados (sin doble conteo entre emisor de sistema y ERC-20).
- **Guardia de red**: tests que fallan si el RPC responde otro chainId, si el dominio EIP-712 no es 5042, o si se intenta firmar para otra cadena.
- **Tests existentes**: adaptar los acoplados a Solana (ver `SOLANA_DEPENDENCIES.md §5`) sin cambiar lo que verifican de negocio (fee 50 bps, HMAC, idempotencia, reservas, store-before-send).
- **Integración manual en Arc Mainnet** (no hay testnet; con tu aprobación y montos mínimos reales, N-6): login y creación de wallet EVM; saldo; envío con gas del usuario; cobro MP con payout; reconciliación de un envío externo; Movimientos y links al explorer. Nada se declara probado si no se ejecutó.
- **DB**: los tests con PGlite corren sobre el esquema actual sin cambios, lo que sirve como prueba de que el código entra en él.
- **Residuales**: búsqueda de `solana`, `lamport`, `SOL`, `devnet`, `mainnet-beta`, `base58` en código activo y config; excepciones documentadas.

## 3. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Confundir 18 y 6 decimales | Montos ×10¹² | Constantes tipadas, conversión en un solo lugar, tests de borde |
| Doble conteo de eventos USDC | Saldos/historial inflados | Leer un solo emisor por caso; test específico |
| Tx con fee < 20 gwei descartada en silencio | Payout "colgado" | Piso explícito + seguimiento por nonce |
| Nonce de tesorería trabado | Bloquea todos los payouts | Lock de asignación, monitoreo, incidente con reemplazo aprobado |
| Blocklist de USDC | Revert que consume gas de tesorería | `eth_call`/`estimateGas` previo; estado `failed`/revisión |
| Gas y liquidez en el mismo saldo | Sobre-reserva o falta de gas | Fórmula de disponible con gas reservado y colchón |
| Address EVM con distinto casing | Rechazos o duplicados | Normalizar a checksum al guardar y comparar |
| Limpieza de esquema rompe consultas existentes | Errores en runtime | Renombres aplicados en código, `paymentDatabase.js` y tests PGlite en la misma etapa |
| Base nueva ya creada con el esquema viejo | Editar `.sql` no la cambia | D-2 antes de la etapa 4 |
| Usuario sin USDC suficiente para el gas | Envío rechazado o tx descartada | Reserva de gas en el saldo gastable (N-8) y mensaje claro en la UI |
| Sin testnet | Pruebas de integración con fondos reales | Montos mínimos, piloto con `TRANSFERS_ALLOWED_USER_IDS` |
| Reglas del repo contradictorias (steering) | Agentes futuros revierten a Solana | Actualizar reglas (Q-15) |
| Historias git sin relación | No hay PR posible a `MidatoPay/arc` | Q-17: se resuelve más adelante |

## 4. Rollback

- Código: la migración vive en `fv-migracionArc`; volver es redeployar el build Solana anterior.
- DB: no hay nada que revertir porque el esquema no cambia. Es una aplicación nueva con su propia base.
- Variables: mantener las Solana en Netlify hasta confirmar el corte; borrar recién después.
- Fondos: un payout Arc final no se revierte (finalidad determinística). Por eso el primer despliegue mainnet arranca con `PAYMENTS_ENABLED=false` y `TRANSFERS_ENABLED=false`, y se habilita con un piloto (`TRANSFERS_ALLOWED_USER_IDS`).

## 5. Registro de cambios

Se completa durante la implementación: archivo, motivo (dependencia directa de Solana) y test que lo cubre.

Implementado el 22/10/2026 en `fv-migracionArc`. Sin commits, sin push y sin migraciones ejecutadas contra ninguna base.

| Archivo | Cambio | Motivo | Test |
|---|---|---|---|
| `src/network.js` | Nuevo `NETWORK` de Arc Mainnet (chain 5042, RPC, explorer, USDC, Memo, emisor de sistema, piso 20 gwei, `testnet:false`) seleccionado por `VITE_ARC_NETWORK` | Red | `treasury-network`, `payments` |
| `src/chain.js` | `ARC`, `arcChain` (viem `defineChain`), explorer, `createAppRpc` JSON-RPC con token de sesión | Red y RPC del navegador | `rpc-transport`, `rpc-efficiency` |
| `src/arc.js` (reemplaza `src/solana.js`) | Direcciones EVM, unidades 6/18, `memoTransferData`, fees, `usdcTransfers`, `memoFromLogs`, envío de prueba | Primitivas de cadena | `arc-chain` |
| `src/main.jsx` | Privy con wallets EVM, `walletChainType:"ethereum-only"`, `defaultChain/supportedChains: [arcChain]` | Wallet | `app-startup` |
| `src/primaryWallet.js`, `netlify/functions/lib/primaryWallet.js` | `primaryArcWallet` (`chainType:'ethereum'`, índice HD 0, dedupe por minúsculas) | Identidad | `wallet-contacts` |
| `src/transfers.js`, `TransferApproval.jsx`, `TransferReceipt.jsx`, `SendScreen.jsx`, `PayScan.jsx`, `App.jsx` | `useWalletTransfers` con `signTransaction` de Privy; gas en USDC en la aprobación; enviable = importe + gas; "usar todo" = saldo − gas; sin cuota | N-3, N-4, N-8, C-2 | `transfer-ui` |
| `src/scanTarget.js` | EIP-681 en lugar del formato de pago anterior | Q-10 | `arc-chain` |
| `src/Movimientos.jsx`, `ChargeSummary.jsx`, `PaymentReports.jsx`, `paymentReports.js`, `transactions.js`, `walletBalance.js`, `contacts.js`, `ContactsScreen.jsx`, `ProfileScreen.jsx`, `TreasuryWalletExport.jsx`, `treasuryWalletExport.js` | `txHash`, links al explorer de Arc, `arcCompatible`, wallets EVM | Nombres y explorer | `transfer-ui`, `treasury-wallet-export`, `rpc-efficiency` |
| `src/i18n.jsx`, `src/i18n.zh.js`, `src/charges.js` | Textos y códigos `arc_*`, `transfer_nonce_expired`, `transfer_not_landed_requires_review`, `mp_test_requires_test_network` | Sin rastros | `payment-recovery`, `charge-received` |
| `netlify/functions/lib/arcRpc.js` | Cliente JSON-RPC, `assertArcNetwork` (chain ID), `alreadySubmitted` | RPC server | `treasury-network`, `transfers` |
| `netlify/functions/lib/treasuryPayout.js` | Firmante EVM, liquidez con reserva de gas de 0,05 USDC, payout vía Memo con nonce asignado | Payouts | `treasury-network` |
| `netlify/functions/lib/paymentWorker.js` | `nextTreasuryNonce` bajo `pg_advisory_lock`; guardar antes de transmitir; recibo final; `arc_transaction_failed` / `arc_payout_not_landed` | Payouts | `payout-follow`, `payments`, `payment-database` |
| `netlify/functions/lib/paymentRuntime.js` | `ARC_RPC` obligatorio; `MP_ENVIRONMENT=test` bloqueado en mainnet | N-6, seguridad | `payments` |
| `netlify/functions/lib/transferChain.js`, `transferService.js`, `transferWorker.js`, `netlify/functions/transfers.js` | Tx EIP-1559 sin firmar, validación byte a byte y de firmante, `eth_call`, enviable con gas, nonce expirado, recibo verificado; sin patrocinio ni cuota | Q-1, N-4, N-8 | `transfers` |
| `netlify/functions/lib/reconcile.js` | `eth_getLogs` del emisor de sistema, rangos ≤ 9.999 bloques, memo del recibo | Q-7 | `arc-chain` |
| `netlify/functions/lib/rpcProxy.js`, `netlify/functions/rpc.js`, `balance.js` | Allowlist de lecturas EVM; saldo = `eth_getBalance` truncado a 6 decimales | Proxy y saldo | `rpc-efficiency` |
| `netlify/functions/lib/paymentCore.js`, `paymentReporting.js`, `paymentActivity.js`, `paymentPreflight.js`, `paymentDatabase.js`, `paymentService.js`, `treasury.js`, `treasury-export-access.js`, `contacts.js`, `transactions.js`, `reconcile-wallets.js` | `tx_hash`/`txHash`, chequeo `arc_network`, direcciones EVM normalizadas | Nombres | `payment-database`, `payment-preflight`, `payment-reports`, `wallet-contacts` |
| `db/migrations/20261013_mercadopago.sql`, `20261013_commission_history.sql`, `20261016_wallet_transfers.sql` | `arc-mainnet`, `tx_hash`/`signed_tx`/`nonce`/`max_gas_wei`; sin columnas de la red anterior ni `payment_user_blocks` | C-1, D-1, D-3 | `payment-database`, `transfers` |
| `db/migrations/20261016_payment_payout_attempts.sql` | Eliminada | C-1 | `payment-database` |
| `scripts/*.js` | Auditoría de wallets EVM, variables Arc, provisión MP de prueba solo en testnet | N-6, N-7 | `functions:check` |
| `index.html`, `netlify.toml`, `.env.example`, `.env.production.example`, `.gitignore`, `.github/workflows/mercadopago-review.yml`, `package.json`/lock | Variables Arc, sin matriz de redes, `ethers` + `viem@2.55.5`, sin librerías de la red anterior | N-7, Q-14 | build |
| `README.md`, `CLAUDE.md`, `ARC-RULES.md` (reemplaza las reglas anteriores), `.kiro/steering/arc-first.md`, `docs/USDC_TRANSFERS.md`, `docs/MERCADOPAGO_PRODUCCION.md`, `docs/REVISION_MERCADOPAGO_PREMERGE.md`, `docs/FRONTEND_ASSISTANT.md`, `.agents/skills/frontend-assistant/references/midatopay.md`, `datosadicionales.md`, `arcRevision/` | Documentación para Arc | Q-15, D-4 | — |
| `test/*.test.js` | Reescritos para Arc; nuevo `arc-chain.test.js` | — | 193/193 |

Excepciones documentadas de la búsqueda de residuales: `docs/arc-migration/` (registro de la migración), `migracion.md` (pedido original), `docs/superpowers/` (contexto histórico), el PDF de `arcRevision/` (informe externo, no editable) y tests negativos que rechazan explícitamente wallets o URIs de la red anterior. El bundle incluye código multi-cadena propio de `@privy-io/react-auth`, que la app no configura.

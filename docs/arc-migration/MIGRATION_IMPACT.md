# Impacto de la migración

Cada componente que cambia, por qué y de qué depende. "Q-n"/"N-n" refieren a `OPEN_QUESTIONS.md`. Lo que no figura acá no debería tocarse.

> Decisiones vigentes: app nueva, solo Arc Mainnet, el usuario paga su gas, la tesorería paga el gas de sus payouts, sin cupo diario. **DB**: solo la limpieza de `TARGET_ARCHITECTURE.md §10`.

## 1. Diferencias de plataforma que fuerzan cambios

| Solana (hoy) | Arc | Consecuencia |
|---|---|---|
| USDC SPL: mint + ATA por dueño, renta | USDC nativo + ERC-20 `0x3600…`, sin cuentas por dueño | Desaparecen ATA, `CreateATAIdempotent`, renta y `recipient_not_wallet` por owner |
| Fee en SOL, fee payer arbitrario | Gas en USDC; paga el `from` de la tx | Decidido: el usuario paga su gas; la tesorería solo paga el de sus payouts (Q-1 ✅, N-5) |
| Firmas ed25519 base58; tx v0 con blockhash | secp256k1, tx EIP-1559 con nonce y chainId (EIP-155) | Formatos de hash, address, key y wire cambian |
| Expiración por `lastValidBlockHeight` | Sin expiración; exclusividad por nonce | Reescribir la lógica "nunca puede aterrizar → revisión" (TARGET §5) |
| `processed/confirmed/finalized` | pending → final (determinístico) | Simplifica estados; `confirmed` intermedio deja de existir |
| Genesis hash como guardia de red | `eth_chainId` = `0x13b2` | Reemplazar todos los checks |
| Memo program | Contrato `Memo` predeployado (o calldata) | Reescribir memo y su lectura (Q-4) |
| `getSignaturesForAddress` + balances pre/post | `eth_getLogs` del emisor de sistema (18 dec) | Reescribir reconciliación (Q-7) |
| Solana Pay (`solana:`) | EIP-681 (`ethereum:`) | Funcionalidad de escaneo a portar o quitar (Q-10) |
| Un solo saldo SOL para fees, otro USDC para pagos | **Un solo saldo USDC** para gas y pagos | Separar USDC de gas vs USDC comprometido (§3) |

## 2. Componentes a modificar

### 2.1 Configuración de red (base de todo)
- `src/network.js`: de clusters Solana a `{network, chainId, rpc, explorer, usdc, memo}` por red Arc. Dependen de él casi todos los módulos y la columna `network` de la DB. Nombres de red: Q-5.
- `src/chain.js`: proxy `/rpc` con Bearer (se conserva el patrón), objeto de cadena para Privy, links a `explorer.arc.io`, sin WSS (Q-6).

### 2.2 Wallet y firma (cliente)
- `src/main.jsx`: `PrivyProvider` EVM (`embeddedWallets.ethereum`, `defaultChain`/`supportedChains` Arc), quitar config Solana y el workaround de Phantom. Polyfill `Buffer` se mantiene si Privy lo necesita.
- `src/primaryWallet.js` (+ `lib/primaryWallet.js`, `scripts/audit-primary-wallets.js`): `chainType==='ethereum'`, HD index 0, comparación de address normalizada (checksum). Impacta `/wallet`, `assertWalletOwned`, transfers, export de tesorería.
- `src/App.jsx`: hooks EVM de Privy, `switchChain(chainId)` antes de firmar, quitar `isAddress` de Kit. Solo las partes chain-dependientes.
- `src/transfers.js`: firma *sign-only* de una tx EIP-1559 del usuario (N-3) en lugar de bytes Solana; muestra el costo de red en USDC; textos de error.
- `src/solana.js` → módulo EVM equivalente (nombre: Q-14) con solo lo que sigue en uso: memo/factura, conversión de unidades, envío usuario-firmado (Convert USDC→ARS, si se mantiene), estimación de gas.
- `src/TreasuryWalletExport.jsx`, `src/treasuryWalletExport.js`: hooks EVM, `chainType==="ethereum"`.

### 2.3 Server: tesorería, payouts y envíos
- `lib/treasuryPayout.js`: clave secp256k1 (hex) con `ethers.Wallet`, payout ERC-20 USDC (con o sin Memo, Q-4), firma local, persistencia de tx cruda + nonce + hash antes del broadcast, liquidez con `eth_chainId`.
- `lib/paymentWorker.js` (`settlePayout`, `followPayout`): estados por recibo; "nunca aterriza" por nonce consumido; rebroadcast del mismo raw tx. `finalizeDelivery` no cambia salvo `block`.
- `lib/transferChain.js`, `lib/transferService.js`, `lib/transferWorker.js`: sin patrocinio. El usuario es `from` y paga el gas (N-3). Se elimina el chequeo de saldo SOL del fee payer y la co-firma de la tesorería. El saldo cubre monto + gas (N-8). Cuota y topes según N-4. Verificación del log `Transfer` del recibo en lugar de `transferChecked`.
- `lib/rpcProxy.js` + `rpc.js`: allowlist EVM (Q-13). `eth-rpc.js` no cambia.
- `balance.js`: `balanceOf` / `eth_getBalance` (Q-3) con validación de chainId.
- `lib/reconcile.js`, `reconcile-wallets.js`, `transactions.js`: logs EVM, checkpoint por número de bloque, regex de address EVM.
- `lib/paymentService.js`, `treasury.js`, `contacts.js`: validación de address EVM.
- `lib/paymentPreflight.js`, `lib/paymentRuntime.js`: `ARC_RPC` (Q-5), check `arc_network` por chainId, tesorería EVM.
- `lib/paymentReporting.js`: mapeo `environment → network`.

### 2.4 Base de datos
Limpieza de lo que es de Solana o no se usa, según `TARGET_ARCHITECTURE.md §10` (pendiente de aprobación y de D-1 a D-3). Impacta `db/schema.sql`, `db/migrations/*`, `scripts/migrate-payments.js`, `lib/paymentDatabase.js` y los tests con PGlite.

### 2.5 Escaneo y links
- `payQr.js`: validación EVM (formato del link no cambia).
- `scanTarget.js` + `PayScan.jsx` + `SendScreen.jsx`: Solana Pay → EIP-681 o quitar (Q-10).
- `contacts.js`, `ContactsScreen.jsx`: compatibilidad invertida (contactos Solana pasan a "incompatibles", Q-12).
- `Movimientos.jsx`, `TransferReceipt.jsx`: regex de address/hash EVM, explorer.

### 2.6 Textos de UI
Solo las cadenas que mencionan Solana/SOL/devnet/Solana Pay/explorer/lamports en `i18n.jsx` y `i18n.zh.js` (~45 claves por idioma), `TransferApproval.jsx`, `TransferReceipt.jsx`, `PayScan.jsx`, `SendScreen.jsx`, `ChargeSummary.jsx`, `ProfileScreen.jsx`, `App.jsx` (panel de gas: "fee en USDC"), `index.html` (título). Mismo tono y estructura; no se reescribe copy no relacionado.

### 2.7 Gating de entorno de prueba
`SOLANA.cluster === "devnet"` habilita: Convert demo, guest mode, faucet, `POST /treasury`, `POST /transactions` del cliente, `fiatRail`, entorno MP `test`. Con solo mainnet (Q-2 ✅) quedan inaccesibles; qué hacer con ese código: N-6.

### 2.8 Dependencias
Quitar `@solana/kit`, `@solana-program/*`, `bs58`. Agregar `viem` como dependencia directa fijada solo si se usa para el objeto de cadena de Privy (Q-14). `ethers` ya está.

### 2.9 Configuración, scripts, CI
`.env.example`, `.env.production.example`, `netlify.toml` (`SECRETS_SCAN_OMIT_KEYS`, comentarios), `scripts/prepare-payments-env.js`, `check-functions.js`, `provision-mercadopago-test.js`, `audit-primary-wallets.js`, CI (matriz de una sola red: mainnet), `.gitignore` (`treasury-devnet.json`). **No** `db/` ni `scripts/migrate-payments.js`.

### 2.10 Tests
Reescritura: `transfers`, `payments` (asserts de red), `treasury-network`, `rpc-transport`, `payout-follow`, `wallet-contacts`, `treasury-wallet-export`, `transfer-ui`. Ajuste de valores de red: `payment-reports`, `merchant-pos`, `payment-database`, `payment-activity`. Revisar los 8 no abiertos. Agregar tests de: envío Arc, transfer USDC, gas, saldos, fallas, confirmaciones, guardia de chainId.

### 2.11 Documentación y reglas
`README.md`, `CLAUDE.md`, `SOLANA-RULES.md`, `.kiro/steering/solana-first.md` (contradice la migración; Q-15), `docs/USDC_TRANSFERS.md`, `docs/MERCADOPAGO_PRODUCCION.md`, `docs/REVISION_MERCADOPAGO_PREMERGE.md`. `datosadicionales.md` y `solanaRevision/` son material de pitch: no se tocan salvo pedido.

## 3. Gas vs USDC comprometido (requisito D)

En Solana la tesorería tenía dos saldos (SOL para fees, USDC para payouts). En Arc es **uno**. Hoy:
- `createCharge` reserva `usdc_raw` contra `liquidity.raw` (USDC).
- `submitTransfer` chequea el SOL del fee payer contra `cost_lamports` pendientes.

En Arc, la liquidez disponible de la tesorería pasa a ser:

```
disponible = saldo_usdc_tesorería
           − Σ usdc_raw de cobros reservados
           − Σ gas máximo de payouts/relays firmados y no finales
           − colchón de gas (configurable o constante, Q-8)
```

**Decisión: el usuario paga su gas.** La tesorería no financia envíos de usuarios. Por lo tanto `gastable = saldo − envíos pendientes − gasLimit × maxFeePerGas` (N-8). La reserva de gas en el patrocinio de envíos y el chequeo del saldo SOL del fee payer desaparecen. Para la tesorería, la fórmula anterior aplica solo al gas de sus propios payouts de Mercado Pago (N-5).

Para no contar doble: el gas nunca se suma a `amt`/`usdc_raw` ni a `commission_ledger`. El gas del usuario se registra en `transactions.fee`, y el costo máximo previsto, en `wallet_transfers.max_gas_wei` (TARGET §10).

## 4. Funcionalidad incompatible o en riesgo

| Funcionalidad | Problema en Arc | Pregunta |
|---|---|---|
| Envíos patrocinados (0 SOL) | Decidido: el usuario paga gas en USDC; cambia la UX ("costo de red" visible) | Q-1 ✅, N-3, N-4 |
| Solana Pay en el escáner | Estándar distinto | Q-10 |
| Datos/saldos Solana existentes | No aplica: aplicación nueva | Q-12 ✅ |
| `network` en DB limitado a `devnet`/`mainnet-beta` | Se limpia el esquema | D-1 |
| Columnas y tablas de Solana o sin uso | Se limpia el esquema | TARGET §10, D-3 |
| `recipient_not_wallet` | No hay "owner" de cuenta | Q-9 |
| Faucet/Convert/guest/MP test | Solo mainnet: quedan inaccesibles | N-6 |

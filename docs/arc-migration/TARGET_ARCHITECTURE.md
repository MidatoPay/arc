# Arquitectura objetivo (Arc)

Propuesta. Las decisiones marcadas "Q-n" esperan respuesta en `OPEN_QUESTIONS.md`; se muestra la opción recomendada.

> Decisiones vigentes: aplicación nueva, **solo Arc Mainnet (5042)**, **el usuario paga su gas**, la tesorería paga el gas de sus payouts, sin cupo diario. **DB**: solo los cambios de §10, una vez aprobados.

## 1. Principios

0. Base de datos: solo la limpieza de §10 (Solana y lo que no se usa).
1. Misma estructura de módulos, rutas, API, tablas y UI. Se cambia la capa de cadena, no el producto.
2. Mismo rigor de liquidación: **persistir la tx firmada antes de enviarla**, rebroadcast de los mismos bytes, nunca re-firmar a ciegas, revisión manual ante ambigüedad.
3. Una sola librería EVM en el código propio: **ethers v6** (ya instalada). viem solo como objeto de cadena para Privy (Q-14).
4. Defensa de red en capas: `eth_chainId` en server, EIP-155 en cada tx, `chainId` en el dominio EIP-712, `supportedChains` de Privy y `switchChain` antes de firmar.

## 2. Mapeo de módulos

| Hoy (Solana) | Objetivo (Arc) |
|---|---|
| `src/network.js` clusters | `networkConfig(name)` → `{network, chainId, rpc, explorer, usdc:"0x3600…", usdcDecimals:6, memo:"0x5294…", testnet}` |
| `src/chain.js` (Kit, WSS, Solana Explorer) | `RPC_PROXY`, `ARC` (equivalente a `SOLANA`), objeto de cadena Privy, links `explorer.arc.io/tx|address` |
| `src/solana.js` | módulo EVM (Q-14): `armarMemo`, `nuevaFactura`, unidades, `estimateUsdcTransfer` en USDC, `sendUsdc` usuario-firmado vía provider EIP-1193 de Privy |
| `src/transfers.js` firma de bytes | firma *sign-only* de una tx EIP-1559 del usuario con Privy (N-3) |
| `lib/treasuryPayout.js` keypair Solana | `ethers.Wallet(TREASURY_SECRET_KEY)`; payout ERC-20 (vía `Memo`, Q-4) |
| `lib/transferChain.js` fee payer = tesorería | arma la tx del usuario (`from` = usuario, paga su gas), verifica la firma recuperando el remitente, sin co-firma |
| `lib/reconcile.js` | `eth_getLogs` del emisor de sistema + logs `Memo` del recibo |
| `lib/rpcProxy.js` allowlist Solana | allowlist EVM (§7) |
| genesis checks | `eth_chainId === 0x13b2` |

## 3. Envío de usuario: el usuario paga el gas (recomendado N-3 opción A)

Se mantiene la API (`POST /transfers`, `/submit`, `/cancel`, GET) y la pantalla de aprobación. Cambia "costo de red 0 SOL" por "costo de red estimado en USDC".

1. `POST /transfers`: valida address y monto (sin cupo diario, N-4 eliminado), y `saldo − envíos pendientes ≥ monto + gas máximo` (N-8: el destinatario recibe el monto exacto; "enviar todo" = `saldo − gas`). Arma una tx EIP-1559 con `chainId 5042`, `from` = usuario, nonce de la cuenta del usuario, `maxFeePerGas ≥ 20 gwei`, `gasLimit` estimado, destino `Memo.memo(USDC, transfer(to, usdc_raw), memoId, memo)` (Q-4). La guarda en `unsigned_tx`, con `nonce` y `max_gas_wei` (§10).
2. Cliente: `switchChain(5042)` y la wallet embebida Privy firma de forma programática, sin UI de wallet (N-3). Modal propio de MidatoPay: C-2.
3. `POST /submit`: recupera el remitente de la firma (== `from`), exige bytes sin firmar idénticos a los guardados, vuelve a chequear saldo + gas, ejecuta `eth_call` (cubre blocklist y saldo) y **persiste `signed_tx` + `tx_hash`** antes de cualquier envío.
4. Worker: `eth_sendRawTransaction` con los mismos bytes. Con recibo `status 1` y exactamente un `Transfer` del ERC-20 `0x3600…` con `from/to/value == usdc_raw` → `completed` e insert en `transactions` (`fee` = gas real en USDC). Con `status 0` → `failed`.
5. "Nunca puede aterrizar": no hay recibo y el nonce confirmado del usuario ya es mayor que el de la tx (el usuario envió otra tx con ese nonce desde otra app) → `manual_review`, igual que hoy.

Los envíos usuario-firmados que no pasan por el server (Convert USDC→ARS) usan el mismo armado, pero envían directo desde el cliente.

## 4. Payout de cobro Mercado Pago

`settlePayout`:
1. Bajo `pg_advisory_xact_lock('treasury-nonce:<addr>')`: nonce = max(`eth_getTransactionCount(pending)`, último nonce asignado no final + 1).
2. Arma tx EIP-1559 `chainId 5042`, `maxFeePerGas ≥ 20 gwei` (dato del RPC, piso 20 gwei), `maxPriorityFeePerGas` 0–1 gwei, `gasLimit` de `estimateGas` con margen. Destino: `Memo.memo(USDC, transfer(wallet, usdc_raw), memoId=keccak256(external_reference), memoData=utf8("MIDATO|v1|…"))` (Q-4).
3. Firma local y **persiste** `signature`(=hash), `signed_wire`(=raw tx), nonce, `payout_memo`, `status=delivery_pending`.
4. `eth_sendRawTransaction` del mismo raw; seguimiento por `eth_getTransactionReceipt`.

## 5. "Nunca puede aterrizar" sin blockhash

| Caso | Señal en Arc | Acción |
|---|---|---|
| Recibo `status 1` | final | `delivered` / `completed` |
| Recibo `status 0` | final fallida (p. ej. blocklist) | revisión (payout) / `failed` (transfer); nonce consumido |
| Sin recibo y `nonce_confirmado(tesorería) > nonce_tx` | otro tx usó ese nonce: el nuestro ya no puede entrar | `manual_review` (mismo criterio que hoy: nunca re-firmar automáticamente) |
| Sin recibo y nonce aún libre | pendiente o descartado del mempool | rebroadcast del mismo raw |
| Transfer de usuario sin firmar y con nonce del usuario ya consumido | la tx preparada quedó inválida | re-preparar (equivale al `recoverPreparation` actual por blockhash vencido) |

Riesgo: un nonce trabado bloquea los siguientes de la tesorería. Mitigación: piso de fee correcto, monitoreo de `pending` viejo, reemplazo con mismo nonce solo con aprobación (incidente).

## 6. Saldos y gas

- Saldo del usuario (pantalla y gastable): `balanceOf` del ERC-20 (6 dec, ya truncado a lo transferible por ERC-20) (Q-3).
- Tesorería: `eth_getBalance` (18 dec) para gas y `balanceOf` para liquidez de payouts; fórmula de disponible en `MIGRATION_IMPACT.md §3`.
- Estimación mostrada al usuario en USDC (`gasLimit × maxFeePerGas / 1e18`), sin aproximaciones de precio como el `solUsdApprox=150` actual.

## 7. Proxy RPC

Allowlist EVM propuesta para `/rpc` (cliente): `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_call` (solo `to` ∈ {USDC `0x3600…`} y selectores de lectura `balanceOf`), `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_getTransactionCount`. `eth_sendRawTransaction` solo si se mantiene algún envío usuario-firmado (Q-1/Q-2). Se conservan auth Privy, 64 KiB, batch ≤ 10 y rate limit. Los workers usan el RPC server-side directo, como hoy.

## 8. Reconciliación de entrantes

`eth_getLogs({address: 0xffff…FfFE, topics:[Transfer, null, pad(wallet)], fromBlock: last_synced_block+1})` en tramos ≤ 9.999 bloques. Valor en 18 decimales → `amt` NUMERIC exacto. Memo desde el recibo (evento `Memo` de `0x5294…`). Se saltean hashes de `charges`/`wallet_transfers` (los workers son la fuente de verdad, igual que hoy). Checkpoint `last_synced_block` = número de bloque. Primer sync acotado (Q-7).

## 9. Privy

```js
// ilustrativo
embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
defaultChain: arcChain,          // id 5042, rpc /rpc o RPC propio
supportedChains: [arcChain],     // solo Arc Mainnet (decisión: sin testnet)
```
Antes de firmar: `await wallet.switchChain(5042)`. Dashboard Privy: habilitar embedded wallets EVM y dominios (paso manual del operador).

## 10. Base de datos: limpieza de Solana y de lo que no se usa (propuesta C-1, pendiente de aprobación)

Solo se toca lo listado. Todo lo demás (contactos, perfiles, POS y tablas de Mercado Pago, montos, fees, ledger, idempotencia, locks) queda igual.

### `wallet_transfers`
| Columna hoy | Propuesta | Motivo |
|---|---|---|
| `unsigned_wire TEXT NOT NULL` | renombrar → `unsigned_tx` | tx EIP-1559 sin firmar |
| `signed_wire TEXT` | renombrar → `signed_tx` | tx firmada cruda |
| `signature TEXT UNIQUE` | renombrar → `tx_hash` | en EVM es un hash de tx |
| `last_valid_block_height BIGINT NOT NULL` | reemplazar → `nonce BIGINT NOT NULL` | EVM no expira por bloque; la exclusividad la da el nonce del usuario |
| `cost_lamports BIGINT NOT NULL CHECK>0` | reemplazar → `max_gas_wei NUMERIC(78,0) NOT NULL CHECK>0` | costo máximo de gas en USDC (18 dec), para reservar `monto + gas` (N-8) |
| `fee_payer TEXT NOT NULL` | **eliminar** | siempre es el usuario (`from_address`) |
| `sponsor_day DATE` + índice `wallet_transfers_budget_idx` | **eliminar** | solo servía para el cupo y el presupuesto, eliminados (N-4) |
| índice `wallet_transfers_jobs_idx` | ajustar a `tx_hash` y estados sin `confirmed` | Arc no tiene estado intermedio |

### `charges`
| Columna hoy | Propuesta | Motivo |
|---|---|---|
| `signature TEXT UNIQUE` | renombrar → `tx_hash` | hash del payout |
| `signed_wire TEXT` | renombrar → `signed_tx` | — |
| `last_valid_block_height BIGINT` | reemplazar → `nonce BIGINT` | nonce de la tesorería, para asignación segura bajo lock |
| `network CHECK IN ('devnet','mainnet-beta')` | ver "red" abajo | — |

### Tablas
| Tabla | Propuesta | Motivo |
|---|---|---|
| `payment_payout_attempts` | **eliminar** (archivo de migración incluido) | modelo Solana (`last_valid_block_height`) y ningún código la usa; solo un test |
| `payment_user_blocks` | **eliminar** (D-3 ✅), junto con el `DELETE` en `finalizeDelivery` y sus asserts de test | tabla de bloqueos de usuario que nada inserta; resto de despliegues viejos |

### Red (`network`) en `charges`, `commission_ledger`, `transactions`, `wallets`, `wallet_transfers`, `wallet_identity_audit` (D-1 ✅)
Se mantiene la columna con un solo valor: `CHECK (network IN ('arc-mainnet'))` en `charges` y `commission_ledger`, `DEFAULT 'arc-mainnet'` en `transactions` y `wallets`. No cambian claves ni índices.

### Sin cambios
`transactions` (`hash`, `block`, `fee`, `memo` son genéricos; `fee` = gas en USDC), `wallets` (`privy_wallet_id`, `hd_wallet_index`, `last_synced_block` = número de bloque), `wallet_identity_audit`, `contacts`, `commission_ledger` (salvo red), tablas MP y de comercios.

### Cómo se aplica (D-2 ✅)
La base de la app nueva todavía no existe. Se editan en el lugar, sin agregar `ALTER` encima:
- `db/migrations/20261013_mercadopago.sql`
- `db/migrations/20261013_commission_history.sql`
- `db/migrations/20261016_wallet_transfers.sql`
- `db/migrations/20261016_payment_payout_attempts.sql` (se borra)

`db/schema.sql` no cambia, porque no tiene nada de Solana. Fuera de los `.sql`, se acompañan `scripts/migrate-payments.js`, `lib/paymentDatabase.js` y los tests PGlite. **No se corre ninguna migración contra ninguna base** (la base de la app Solana no se toca) y **no se sube nada**. Los cambios se validan solo con PGlite en los tests.

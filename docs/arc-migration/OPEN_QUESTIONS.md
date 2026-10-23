# Preguntas abiertas

## Base de datos: solo se cambia lo aprobado

Primero se decidió "la DB no se toca". Después (C-1) el equipo pidió **eliminar de la DB todo lo que es de Solana o no se usa**. Regla vigente: **solo se modifica lo listado en `TARGET_ARCHITECTURE.md §10` una vez aprobado**. Contactos, perfiles, POS y tablas de Mercado Pago, montos, fees, ledger e idempotencia no se tocan.

## Decisiones tomadas

| # | Tema | Decisión | Fecha |
|---|---|---|---|
| Q-12 | Datos Solana existentes | No aplica: **aplicación nueva**. | 22/10 |
| Q-1 | Gas de envíos de usuarios | **Lo paga el usuario**, en USDC. La tesorería no patrocina envíos. | 22/10 |
| Q-2 | Redes | **Solo Arc Mainnet** (5042). Sin testnet. | 22/10 |
| Q-16 | Tesorería | Custodia y fondeo a cargo del equipo MidatoPay. | 22/10 |
| Q-17 | Git | Se resuelve más adelante. | 22/10 |
| N-5 | Gas de los payouts de Mercado Pago | **Lo paga la tesorería** (es quien envía el USDC al comercio). El comercio recibe el monto completo. | 22/10 |
| N-4 | Cupo de 2 envíos/día y presupuestos | **Se elimina** el cupo diario. Se eliminan `TRANSFER_DAILY_SOL_BUDGET` y `TRANSFER_MAX_SOL_COST` y su lógica. | 22/10 |
| N-6 | Funciones de prueba (Convert, invitado, faucet, MP test, `POST /treasury`, `POST /transactions` del cliente, script de provisión MP test) | **Quedan desactivadas, sin borrar nada.** | 22/10 |
| N-7 | Variables | **Confirmado**: `VITE_SOLANA_CLUSTER→VITE_ARC_NETWORK` (`mainnet`), `SOLANA_RPC→ARC_RPC`, `VITE_SOLANA_RPC→VITE_ARC_RPC`, `VITE_SOLANA_WSS` se elimina, `TREASURY_SECRET_KEY` mismo nombre con clave EVM `0x…`. Corte limpio, sin fallback a nombres viejos. | 22/10 |
| N-8 | Gas y monto | El destinatario **siempre recibe exactamente el monto enviado**; el gas sale del saldo restante. Requisito: `saldo ≥ monto + gas`. Ej.: saldo 10, envía 8 → llegan 8, gas sale de los 2 restantes. **Enviar todo**: llega `saldo − gas`. | 22/10 |
| N-3 | Firma | Los usuarios están en Privy: la wallet embebida firma **sin interacción del usuario** (como hoy, `showWalletUIs: false`). Flujo: el server arma la tx, la wallet Privy la firma de forma programática, el server la valida, la guarda y la envía. | 22/10 (interpretación, confirmar en C-2) |
| — | Rastros de Solana | **No dejar rastros de Solana** en código, nombres ni valores. | 22/10 (en conflicto con la DB, C-1) |

## Pendientes

**C-1 ✅ actualizado (22/10): se permite limpiar la DB de todo lo que es de Solana o no se usa.** Reemplaza la restricción "la DB no se toca". La propuesta concreta, columna por columna, está en `TARGET_ARCHITECTURE.md §10` y queda pendiente de aprobación junto con D-1 a D-3. N-1 y N-2 (reutilizar columnas Solana) quedan descartadas.

- **D-1 ✅ (22/10)**: la columna `network` se mantiene, con un único valor `'arc-mainnet'` (`CHECK` y `DEFAULT`).
- **D-2 ✅ (22/10)**: la base de datos de la app nueva **no existe todavía**. Solo existe la de la app Solana, que **no se toca**. Se editan `db/schema.sql` y `db/migrations/*` en el lugar. **No se ejecuta ninguna migración contra ninguna base y no se sube (push) nada.**
- **D-3 ✅ (22/10)**: `payment_user_blocks` se **elimina** (tabla, `DELETE` en `finalizeDelivery` y asserts de test). Es una tabla de *bloqueos de usuario* (no de bloques de la cadena), que nada inserta. El número de bloque de cada operación ya se guarda en `transactions.block` y `wallet_transfers.block`.
- **D-4 ✅ (22/10)**: `datosadicionales.md` y `solanaRevision/` se **reescriben para Arc**.
- **Plan aprobado (22/10/2026).**

Contexto original del conflicto:
Hoy el esquema mismo contiene Solana:
- `charges.network` y `commission_ledger.network`: `CHECK (network IN ('devnet','mainnet-beta'))`.
- `transactions.network` y `wallets.network`: `DEFAULT 'devnet'`.
- `wallet_transfers`: `cost_lamports`, `last_valid_block_height`, `fee_payer`, `unsigned_wire`, `sponsor_day` (estas dos últimas `NOT NULL` o ligadas al patrocinio).
- `charges.last_valid_block_height`, `signed_wire`; tabla `payment_payout_attempts`.

No se pueden cumplir las dos decisiones a la vez. Opciones:
- **A**: la DB no se toca. El código queda sin rastros de Solana, pero la DB conserva esos nombres y valores. El código los usa como nombres opacos detrás de un único módulo de acceso.
- **B**: se cambia el esquema (valores de `network`, nombres de columnas, constraints). Como es una app nueva con base nueva, se puede editar `db/schema.sql` y las migraciones existentes en lugar de agregar migraciones nuevas. Es tocar la DB.
- **C**: otra combinación que definas (p. ej. cambiar solo los valores de `network` y dejar las columnas).

**C-2 ✅ (22/10)**: se mantiene el modal propio `TransferApproval.jsx`, mostrando el **gas estimado en USDC**.

**N-8 ✅ (22/10)**: confirmado tal como está en la tabla de decisiones.

## Abiertas con recomendación (si no hay respuesta, se aplica la recomendada)

| # | Tema | Recomendación |
|---|---|---|
| Q-3 | Saldo | `balanceOf` ERC-20 (6 dec) para mostrar; `eth_getBalance` (18 dec) para validar `monto + gas`. |
| Q-4 | Memo `MIDATO|v1|…` | Contrato oficial `Memo` `0x5294…`. |
| Q-7 | Reconciliación de entrantes | `eth_getLogs` del emisor de sistema `0xffff…FfFE` por RPC, checkpoint por bloque, primer sync 9.999 bloques. |
| Q-9 | Destinatario contrato | Rechazar contratos salvo EOAs con delegación EIP-7702. |
| Q-10 | Solana Pay en el escáner | Portar a EIP-681. |
| Q-13 | RPC de producción | `ARC_RPC` configurable; default RPC público de Circle. |
| Q-14 | Librerías y nombres | ethers v6; `viem` fijado solo para la cadena de Privy; `src/solana.js→src/arc.js`; renombrar `primarySolanaWallet`, `SOLANA`, `solanaCompatible`, códigos `solana_*`, etc. (implícito en "sin rastros"). |
| Q-15 | Reglas del repo | Actualizar `.kiro/steering/solana-first.md`, reemplazar `SOLANA-RULES.md`, actualizar `CLAUDE.md`/`README.md` (implícito en "sin rastros"). |

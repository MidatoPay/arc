# Variables de entorno

## Mapeo final confirmado (22/10/2026)

| Hoy | Arc | Valor por defecto |
|---|---|---|
| `VITE_SOLANA_CLUSTER` | `VITE_ARC_NETWORK` | `mainnet` |
| `SOLANA_RPC` | `ARC_RPC` | `https://rpc.mainnet.arc.io` |
| `VITE_SOLANA_RPC` | `VITE_ARC_RPC` | vacío (fallback de `ARC_RPC`) |
| `VITE_SOLANA_WSS` | **eliminada** | — |
| `TRANSFER_DAILY_SOL_BUDGET` | **eliminada** (sin cupo ni presupuesto) | — |
| `TRANSFER_MAX_SOL_COST` | **eliminada** | — |
| `TREASURY_SECRET_KEY` / `TREASURY_PRIVATE_KEY` | mismo nombre, clave EVM hex `0x…` | — |

Corte limpio: no se leen los nombres viejos. El resto de las variables no cambia. Lo que sigue es el análisis previo.

> **Decisión (22/10/2026): todas las variables de Solana pasan a valores Arc Mainnet.** Esto amplía la regla original de `migracion.md`, que solo renombraba las de RPC. El mapeo final, a confirmar, está en `OPEN_QUESTIONS.md` N-7 y es la fuente vigente. Las secciones 1 y 2 de abajo quedan como análisis previo. Las variables de base de datos (`AIVEN_PG_URL`, `AIVEN_PG_CA_CERT`) no cambian.

No se leyó ningún `.env` real (solo `.env.example` y `.env.production.example`).

## 1. Renombres propuestos (RPC)

| Nombre actual | Nombre nuevo | Dónde se usa hoy | Estado |
|---|---|---|---|
| `SOLANA_RPC` | `ARC_RPC` | `lib/paymentRuntime.js`, `lib/paymentPreflight.js`, `balance.js`, `rpc.js`, `lib/treasuryPayout.js`, `lib/reconcile.js`, `lib/transferChain.js`, `scripts/prepare-payments-env.js`, `scripts/check-functions.js`, `.env*.example`, `README.md`, `docs/USDC_TRANSFERS.md`, `docs/REVISION_MERCADOPAGO_PREMERGE.md` | Propuesto. Sin precedente histórico (la versión Arc solo tenía la variante `VITE_`). Confirmar (Q-5). |
| `VITE_SOLANA_RPC` | `VITE_ARC_RPC` | Fallback server-side en `balance.js`, `rpc.js`, `lib/treasuryPayout.js`, `lib/reconcile.js`; `.env.example`; `SOLANA-RULES.md`; `CLAUDE.md`. Ningún uso en `src/`. | Nombre verificado: es el que usaba la versión Arc (git `2259b73`). |
| `VITE_SOLANA_WSS` | `VITE_ARC_WSS` **o eliminar** | Solo `src/chain.js` → suscripciones de Privy Solana; `.env*.example`, `prepare-payments-env.js`, `README`, docs | Privy EVM no requiere WSS. Q-6. |

Todas las referencias (código, `.env*.example`, scripts, CI, docs) se actualizan en el mismo cambio. Mientras dure la transición se puede leer el nombre viejo como fallback solo si lo aprobás (Q-5); la versión Solana hizo eso con `VITE_ARC_RPC`.

## 2. Variables que conservan el nombre pero cambian de valor o de semántica

Requieren decisión porque no son "de RPC" pero su contenido es Solana:

| Variable | Hoy | En Arc | Pregunta |
|---|---|---|---|
| `VITE_SOLANA_CLUSTER` | `devnet` / `mainnet-beta`; selecciona red en browser y server, valor de la columna `network`, `SECRETS_SCAN_OMIT_KEYS`, CI | Necesita valores Arc (p. ej. `arc-mainnet`). Mantener el nombre cumple la regla pero queda engañoso; renombrar (p. ej. `VITE_ARC_NETWORK`) sería una excepción. | Q-5 |
| `TREASURY_SECRET_KEY` (+ alias `TREASURY_PRIVATE_KEY`) | Keypair Solana base58 / JSON 64 bytes | Clave privada secp256k1 hex 32 bytes (`0x…`). **Nombre sin cambios.** El valor lo carga el operador; nunca se commitea. | Q-16 (custodia/rotación) |
| `TRANSFER_DAILY_SOL_BUDGET` | Presupuesto diario de patrocinio en SOL (9 dec) | Presupuesto en USDC de gas | Q-8 |
| `TRANSFER_MAX_SOL_COST` | Tope de costo por envío en SOL | Tope en USDC de gas | Q-8 |

## 3. Sin cambios

| Variable | Nota |
|---|---|
| `VITE_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Requiere habilitar wallets EVM en el dashboard (acción del operador) |
| `ANTHROPIC_API_KEY` | — |
| `VITE_ETH_RPC`, `ETH_RPC_URL`, `CHAINLINK_MAX_AGE_SECONDS` | Chainlink USD/ARS sigue en Ethereum Mainnet |
| `AIVEN_PG_URL`, `AIVEN_PG_CA_CERT` | — |
| `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_USER_ID`, `MP_EXTERNAL_POS_ID`, `MP_STORE_ID`, `MP_WEBHOOK_SECRET` | — |
| `CONVERSION_FEE_BPS` | Sigue fijo en 50 |
| `PAYMENTS_BASE_URL`, `INTERNAL_WORKER_SECRET`, `PAYMENTS_ENABLED`, `PAYMENTS_ADMIN_USER_IDS`, `PAYMENTS_CHECK_USER_ID` | — |
| `TRANSFERS_ENABLED`, `TRANSFERS_ALLOWED_USER_IDS` | — |
| `VITE_ANTHROPIC_API_KEY` | Fallback legado en `parse-intent.js`; no se toca |

## 4. Valores nuevos que no se derivan de la configuración actual

No se introduce ninguna variable nueva sin aprobación. Constantes verificadas que irían en `src/network.js` (no son secretos ni varían por despliegue): chain ID `5042`, USDC `0x3600000000000000000000000000000000000000`, Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`, explorer `https://explorer.arc.io`, RPC público por defecto `https://rpc.mainnet.arc.io`. Lo mismo para testnet si se aprueba (Q-2).

## 5. Lugares a actualizar por cada renombre

`.env.example`, `.env.production.example`, `netlify.toml` (comentarios y `SECRETS_SCAN_OMIT_KEYS` si cambia `VITE_SOLANA_CLUSTER`), `scripts/prepare-payments-env.js`, `scripts/check-functions.js`, `scripts/provision-mercadopago-test.js`, `.github/workflows/mercadopago-review.yml`, `README.md`, `CLAUDE.md`, reglas (`SOLANA-RULES.md`/sucesor), `docs/*`. En Netlify (UI) el operador debe crear las variables nuevas y borrar las viejas después del corte.

# Red del proyecto: Solana

Este proyecto (MidatoPay — pagos por voz) **se trabaja sobre la red Solana**.

- **Red por defecto:** Solana **Devnet**. Mainnet solo cuando se pida explícitamente.
- **Origen histórico:** el proyecto arrancó sobre "Arc" (estilo EVM) y luego
  se creó esta versión para Solana. Arc quedó atrás — no se vuelve a Arc.

## Fuente de verdad del estado actual

El estado real y vigente del código está definido por:

- `CLAUDE.md`
- `SOLANA-RULES.md`
- `README.md`
- `.env.example`
- El código en `src/` — en particular `src/solana.js`, `src/chain.js`,
  `@solana/kit`, el mint SPL de Circle (USDC devnet), `VITE_TREASURY_SECRET_KEY`
  y la constraint `UNIQUE(user_id, hash)` en `db/schema.sql`.

## docs/superpowers (planes + specs): contexto, NO implementación vigente

Los documentos en `docs/superpowers/plans/` y `docs/superpowers/specs/` fueron
escritos para la versión **Arc anterior a la migración**. Valen como contexto
de *por qué* existe cada feature (agenda de contactos, historial de
transacciones, reconciliación de fondo, cobro P2P por QR, intent de voz
"cobrar", display name de wallet), pero sus **detalles de cadena están
obsoletos**:

- Referencias a `src/arc.js` → hoy es `src/solana.js`.
- Direcciones `0x…` estilo Ethereum → hoy son addresses/mints de Solana.
- `ArcScan` / Blockscout → hoy es Solana RPC / Solana Explorer.
- `VITE_TREASURY_PRIVATE_KEY` → hoy es `VITE_TREASURY_SECRET_KEY`.
- La migración de `UNIQUE(hash)` → ya aplicada como `UNIQUE(user_id, hash)`.

**La lógica de producto de esos specs se mantiene; la implementación es Solana.**
Al retomar cualquier feature, usá el código en `src/` y los archivos de la
"fuente de verdad" de arriba, no las rutas/detalles de cadena de los planes.

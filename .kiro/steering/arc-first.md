# Red del proyecto: Arc Mainnet

Este proyecto (MidatoPay — cobros QR y pagos por voz) **se trabaja sobre Arc Mainnet** (chain ID `5042`).

- **Red:** Arc Mainnet es la única red soportada (`VITE_ARC_NETWORK=mainnet`). No hay testnet configurada.
- **Gas:** se paga en USDC. El usuario paga el gas de sus envíos; la tesorería paga el gas de sus payouts de Mercado Pago.
- **Features solo de prueba:** quedan desactivadas en mainnet (`NETWORK.testnet === false`). No se borran.
- **Base de datos y deploy:** no correr migraciones contra ninguna base ni hacer push sin pedido explícito.

## Fuente de verdad del estado actual

- `CLAUDE.md`
- `ARC-RULES.md`
- `README.md`
- `.env.example` y `.env.production.example`
- `docs/arc-migration/` (plan, arquitectura objetivo, decisiones e investigación de Arc)
- El código en `src/` y `netlify/functions/` — en particular `src/network.js`, `src/chain.js`, `src/arc.js`,
  `netlify/functions/lib/arcRpc.js`, `ethers` v6, el USDC de Arc (`0x3600000000000000000000000000000000000000`),
  el contrato Memo, `TREASURY_SECRET_KEY` (clave EVM, solo server) y `UNIQUE(user_id, network, hash)` en las migraciones.

## docs/superpowers (planes + specs): contexto, NO implementación vigente

Los documentos en `docs/superpowers/plans/` y `docs/superpowers/specs/` se escribieron para una versión
anterior sobre Arc Testnet. Valen como contexto de *por qué* existe cada feature (agenda de contactos,
historial, reconciliación de fondo, cobro P2P por QR, intent de voz "cobrar", display name de wallet),
pero sus detalles de cadena y de implementación pueden estar desactualizados:

- Red, chain ID, RPC y explorer → hoy son los de `src/network.js` (Arc Mainnet).
- `VITE_TREASURY_PRIVATE_KEY` → hoy es `TREASURY_SECRET_KEY`, solo server-side.
- Unicidad de `transactions` → hoy es `UNIQUE(user_id, network, hash)`.

**La lógica de producto de esos specs se mantiene; la implementación vigente es la del código.**

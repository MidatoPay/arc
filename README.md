# MidatoPay × Solana — Voice Payments

Login con email o teléfono (Privy) → wallet embebida Solana → pagos por voz en USDC
(SPL) que se liquidan de verdad en Solana Devnet, verificables en Solana Explorer.

## Cobros Mercado Pago y producción

La acción **Cobrar** usa QR dinámicos de Mercado Pago y entrega USDC desde tesorería, con comisión de conversión del 0,5%. Configuración, migración, webhook y activación: [guía de producción](docs/MERCADOPAGO_PRODUCCION.md).

El administrador configurado en `PAYMENTS_ADMIN_USER_IDS` accede desde **Más → Operaciones y comisiones** al historial de todos los comercios, filtros, totales y exportación CSV. Para probar frontend y backend juntos en local: `npm run dev:full` y abrir `http://localhost:8888`.

En **Profile → Nombre del negocio**, cada usuario puede guardar o borrar el nombre de su comercio. Activity y el encabezado del QR usan ese nombre; si está vacío, usan el nombre del usuario de Privy. La tabla `merchant_profiles` vincula ambos nombres al DID autenticado de Privy. Antes de desplegar esta versión, aplicar `db/migrations/20261016_merchant_profiles.sql` (incluida en `npm run db:migrate:payments`). El endpoint autenticado `/merchant-profile` permite consultar el perfil con GET y actualizar únicamente `businessName` con PATCH.

El circuito de demo descrito más abajo corresponde a devnet. En mainnet, los desembolsos directos de `/treasury`, las conversiones fiat simuladas y el modo guest de prueba están deshabilitados.

## Setup

```bash
npm install
cp .env.example .env   # completá las claves (ver abajo)
npm run dev
```

### Claves necesarias en .env

| Variable | De dónde sale | ¿Obligatoria? |
|---|---|---|
| `VITE_PRIVY_APP_ID` | dashboard.privy.io → tu app | Sí, sin esto no hay login |
| `ANTHROPIC_API_KEY` | console.anthropic.com (server-side, Netlify Function) | No (sin ella usa parser local) |
| `VITE_SOLANA_RPC` | Triton / Helius (HTTPS) | No (sin ella usa el RPC público de devnet, que limita) |
| `VITE_SOLANA_WSS` | Mismo provider (WSS) | No (default: wss público de devnet) |
| `VITE_ETH_RPC` | RPC Ethereum Mainnet | No (sin ella usa publicnode; necesario para el FX Chainlink) |
| `TREASURY_SECRET_KEY` | Keypair Solana de la recaudadora (base58 o JSON, server-side) | Sí para Convertir ARS→USDC (solo devnet) |
| `PRIVY_APP_SECRET` | Privy dashboard → App secret | Sí para Functions (contactos, treasury, parse-intent) |

### Configurar Privy (3 minutos)

1. Entrá a https://dashboard.privy.io y creá una app
2. **Login methods**: activá Email y SMS
3. **Embedded wallets**: activá creación automática de wallets **Solana**
4. **Domains**: agregá `http://localhost:5173`
5. Copiá el App ID al `.env`

## Usar la app

1. Entrar con email o teléfono → recibís un código → se crea tu wallet Solana sola
2. Inicio → copiar dirección → https://faucet.circle.com → **Solana Devnet** → pedir USDC
3. Necesitás un poco de SOL en la wallet para fees (`solana airdrop 2` o faucet de SOL)
4. Voz 🎙 → "enviar 1 dólar a katy" → Firmar y enviar
5. El recibo trae la signature con link a https://explorer.solana.com/?cluster=devnet

Usá **Chrome o Edge** para el micrófono. En Safari necesitás Dictado activado
(Configuración del Sistema → Teclado) y permiso de micrófono para localhost.

## Stack

Cliente `@solana/kit` v8, Privy embedded Solana, USDC mint de Circle en devnet,
memo SPL para la factura, Postgres (contactos/historial) sin cambios.

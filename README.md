# MidatoPay × Arc — Voice Payments

Login con email o teléfono (Privy) → wallet embebida → pagos por voz en USDC
que se liquidan de verdad en Arc Testnet (chain 5042002), verificables en ArcScan.

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
| `VITE_ANTHROPIC_API_KEY` | console.anthropic.com | No (sin ella usa parser local) |
| `VITE_ARC_RPC` | alchemy.com → Arc Testnet | No (sin ella usa el RPC público, que limita) |
| `VITE_ETH_RPC` | RPC Ethereum Mainnet | No (sin ella usa publicnode; necesario para el FX Chainlink) |
| `VITE_TREASURY_PRIVATE_KEY` | Wallet recaudadora fondeada en Arc Testnet | Sí para Cobrar / Convertir ARS→USDC (solo testnet) |

### Configurar Privy (3 minutos)

1. Entrá a https://dashboard.privy.io y creá una app
2. **Login methods**: activá Email y SMS
3. **Embedded wallets**: activá "Create on login" para usuarios sin wallet
4. **Domains**: agregá `http://localhost:5173`
5. Copiá el App ID al .env

## Usar la app

1. Entrar con email o teléfono → recibís un código → se crea tu wallet sola
2. Inicio → copiar dirección → https://faucet.circle.com → Arc Testnet → pedir USDC
3. Voz 🎙 → "enviar 1 dólar a katy" → Firmar y enviar
4. El recibo trae el hash con link a https://testnet.arcscan.app

Usá **Chrome o Edge** para el micrófono. En Safari necesitás Dictado activado
(Configuración del Sistema → Teclado) y permiso de micrófono para localhost.

## ⚠️ Seguridad

- Solo testnet. Fondos de prueba sin valor. Nunca mandes fondos reales.
- La API key de Anthropic va en el front solo para demo local — no publicar.

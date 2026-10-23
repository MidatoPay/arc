# Arc Mainnet: investigación

Consultado el 22/10/2026. La documentación oficial migró de `docs.arc.network` a **`docs.arc.io`** (redirect 301 verificado). Contenido parafraseado de las fuentes; solo se citan valores técnicos literales (direcciones, IDs, URLs).

Convenciones: **[V]** verificado en documentación oficial de Arc/Circle; **[V-ext]** verificado en fuente oficial de un tercero (viem, Privy); **[S]** supuesto; **[A verificar]** debe confirmarse on-chain o en el SDK instalado antes de implementar.

## 1. Red

| Parámetro | Mainnet | Testnet | Fuente |
|---|---|---|---|
| Chain ID | `5042` (`0x13b2`) | `5042002` | [V] [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc), [RPC endpoints](https://docs.arc.io/arc/references/rpc-endpoints.md) |
| RPC primario (Circle) | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` | [V] |
| WebSocket | `wss://rpc.mainnet.arc.io` | `wss://rpc.testnet.arc.io` | [V] |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` | [V] |
| Explorer API (Blockscout v2) | `https://explorer.arc.io/api/v2` | — | [V-ext] definición `arc` de viem |
| Faucet | no hay | `https://faucet.circle.com` | [V] |
| Moneda nativa | USDC | USDC | [V] |
| Lanzamiento mainnet | 16/09/2026 | testnet desde oct/2025 | fuentes secundarias (Chainstack, Dwellir) |

- El RPC primario acepta requests anónimos con CORS abierto, está balanceado entre backends con alturas levemente distintas y puede devolver `-32014` cerca del head (reintentar con backoff). [V]
- Proveedores con API key: Alchemy (`arc-mainnet.g.alchemy.com/v2/<key>`), Blockdaemon, dRPC, QuickNode. [V]
- `eth_getLogs` admite como máximo 10.000 bloques por llamada (error `-32012`); a ~2 bloques/s son ~85 minutos. [V]
- Los valores de testnet que usaba la versión Arc anterior (`rpc.testnet.arc.network`, `testnet.arcscan.app`, git `2259b73` en `/home/vargaviella/arcgrant`) son **obsoletos** frente a la documentación actual. [V]

## 2. Modelo de transacción y finalidad

- EVM-compatible, baseline Osaka; soporta EIP-1559 y EIP-7702. No soporta blobs (tipo 3). [V] [EVM differences](https://docs.arc.io/arc/references/evm-differences)
- **Finalidad determinística** (Malachite BFT): una tx está *pending* o *final*; no hay reorgs ni conteo de confirmaciones. Basta un recibo con número de bloque. [V] [Deterministic finality](https://docs.arc.io/arc/concepts/deterministic-finality), [Transaction lifecycle](https://docs.arc.io/integrate/wallets/transaction-lifecycle.md)
- Bloques de ~0,5 s; los timestamps son no decrecientes (pueden repetirse): ordenar por número de bloque. [V]
- Reverts en runtime (blocklist) quedan incluidos con `status: 0` y consumen gas; el nonce queda gastado. [V]
- Una tx con `maxFeePerGas` < 20 gwei se descarta del mempool **sin error ni recibo**. Las tx pueden ser desalojadas bajo carga; el reemplazo se hace con el mismo nonce. [V]

## 3. Gas

| Parámetro | Valor | Fuente |
|---|---|---|
| Token de gas | USDC nativo, 18 decimales | [V] [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees.md) |
| Modelo | EIP-1559 con base fee suavizado por EWMA; el base fee no se quema | [V] [Stable fee design](https://docs.arc.io/arc/concepts/stable-fee-design) |
| Base fee mínimo | 20 gwei (piso del mempool) | [V] |
| Base fee máximo | 20.000 gwei | [V] |
| Objetivo de costo | ~US$0,001 por transferencia ERC-20 en condiciones normales | [V] |
| Priority fee | 0 recomendado; 1 gwei bajo carga; consultar `eth_maxPriorityFeePerGas` | [V] |
| Costo del gas | `gasUsed × effectiveGasPrice` del recibo (no emite eventos) | [V] |
| Paymasters multi-token | no soportados en el lanzamiento | [V] [Stablecoin native model](https://docs.arc.io/arc/concepts/stablecoin-native-model) |

Cálculo propio (no documentado): un `transferWithAuthorization` (~65.000 gas según la guía del relayer) cuesta ~0,0013 USDC al piso de 20 gwei y hasta ~1,3 USDC en el techo teórico de 20.000 gwei. Una transferencia nativa (21.000 gas) cuesta ~0,00042 USDC al piso.

## 4. USDC

- **Una sola balance, dos interfaces** [V] [Stablecoin native model](https://docs.arc.io/arc/concepts/stablecoin-native-model):
  - Nativa, **18 decimales**: gas, `msg.value`, `eth_getBalance`.
  - ERC-20 en **`0x3600000000000000000000000000000000000000`**, **6 decimales**: `transfer`, `approve`, `transferFrom`, EIP-3009. Misma dirección en mainnet y testnet. No hay USDC "wrapped". [V] [Contract addresses](https://docs.arc.io/arc/references/contract-addresses)
- `balanceOf` trunca los últimos 12 decimales del saldo nativo; un `balanceOf` en 0 no implica saldo nativo 0. La doc recomienda no registrar créditos con el valor truncado. [V]
- Para mostrar un valor nativo como USDC se divide por 10¹². [V]
- **Reglas de transferencia** [V]: prohibido enviar valor a `0x0`; prohibido "quemar"; la **blocklist de USDC se aplica en runtime** (envíos desde/hacia direcciones bloqueadas revierten y consumen gas); enviar valor nativo a un contrato puede revertir.
- **Eventos** [V] [USDC system events](https://docs.arc.io/arc/references/usdc-system-events):
  - Emisor de sistema (EIP-7708) `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`: `Transfer(from,to,value)` en 18 decimales para **todo** movimiento explícito de USDC (envío nativo, ERC-20, mint, burn). Se emite primero en la tx.
  - Contrato ERC-20 `0x3600…`: `Transfer` propio en 6 decimales solo para operaciones de la interfaz ERC-20.
  - Una transferencia ERC-20 emite **ambos** logs: filtrar por emisor para no contar doble.
  - Mainnet usa EIP-7708 desde genesis (los eventos legacy `NativeCoin*` solo aplican a historia vieja de testnet).
- **EIP-3009 `transferWithAuthorization`** disponible en el ERC-20 USDC; dominio EIP-712 documentado para testnet: `name "USDC"`, `version "2"`, `chainId 5042002`, `verifyingContract 0x3600…`. Nonce aleatorio `bytes32` por autorización; `validAfter/validBefore`. El relayer paga el gas. [V] [EIP-3009 relayer](https://docs.arc.io/integrate/relayers-and-paymasters/eip-3009-relayer.md)
  - Dominio en mainnet (`name`/`version` con `chainId 5042`): **[A verificar]** leyendo `eip712Domain()` / `DOMAIN_SEPARATOR()` on-chain.
  - `authorizationState(authorizer, nonce)` (vista estándar de EIP-3009 en FiatToken): **[A verificar]**.

## 5. Memos

- Contrato predeployado **`Memo` en `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`** (misma dirección en ambas redes). [V] [Transaction memos](https://docs.arc.io/arc/concepts/transaction-memos.md)
- `memo(address target, bytes data, bytes32 memoId, bytes memoData)`: ejecuta la llamada al `target` preservando al EOA como `msg.sender` (precompile `CallFrom`) y emite `BeforeMemo(memoIndex)` → eventos del target → `Memo(sender, target, callDataHash, memoId, memo, memoIndex)`. [V]
- Debe invocarse **directamente desde un EOA**; smart wallets (ERC-4337, Safe, SCA) revierten. Si el inner call revierte, revierte toda la tx. [V]
- Combinación `Memo.memo(target=USDC, data=transferWithAuthorization(...))` desde el relayer: **[S]** compatible (EIP-3009 no depende de `msg.sender`); **[A verificar]** en testnet.
- La versión Arc anterior ponía el memo como calldata UTF-8 de una transferencia nativa (`data`). Sigue siendo EVM-válido, pero el contrato `Memo` es el mecanismo oficial e indexable. [V] (git `2259b73`)

## 6. Herramientas

- Arc documenta compatibilidad sin cambios con Solidity, Foundry, Hardhat, **viem** y **ethers.js**. [V]
- **viem** incluye `arc` (id 5042, RPCs oficiales, explorer `explorer.arc.io`, multicall3 `0xcA11…CA11`) y `arcTestnet` en `main`. [V-ext] [viem arc.ts](https://raw.githubusercontent.com/wevm/viem/main/src/chains/definitions/arc.ts). Que el `viem@2.55.5` instalado como transitivo de Privy ya los exporte: **[A verificar]** (no se encontró `node_modules` indexado).
- **ethers v6** (`6.17.0` instalado): suficiente para providers, `Wallet`, EIP-1559, `signTypedData`, ABI. La guía oficial del relayer usa ethers v6. [V]
- Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`, Permit2, Multicall3From `0x522fAf9A91c41c443c66765030741e4AaCe147D0`. [V]

## 7. Wallets (Privy)

- Privy embedded wallets soportan cualquier cadena EVM vía objeto de cadena viem (`defaultChain` + `supportedChains`; el array no puede ser vacío y `defaultChain` debe estar incluido). Intentar firmar/cambiar a una cadena fuera de `supportedChains` lanza error: sirve de guardarraíl de red. [V-ext] [Privy: configuring EVM networks](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)
- Arc **no** está en la lista de redes por defecto de Privy, por lo que debe configurarse explícitamente. RPC override con `addRpcUrlOverrideToChain` de `@privy-io/chains`. [V-ext]
- **Gas sponsorship de Privy**: modo "user pays" (gas en USDC) solo en Ethereum, Base, Optimism, Arbitrum, Polygon, Tempo y testnets; **Arc no figura**. La lista de redes del modo "app pays" no pudo leerse (contenido en pestaña dinámica) → soporte de Arc **[A verificar]** con Privy. "App pays" usa EIP-7702 + paymasters (Alchemy). [V-ext] [Privy gas overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview)
- Hooks EVM a usar (`useWallets`, `wallet.getEthereumProvider()`, `wallet.switchChain`, `useSignTypedData`, `useSendTransaction`, `useExportWallet`) en `@privy-io/react-auth@3.36.1`: **[A verificar]** contra el paquete instalado. La versión Arc anterior usó `useWallets`, `useCreateWallet`, `switchChain` y `getEthereumProvider` con la misma versión 3.36.1 (git `2259b73`). [V]
- Comportamiento de `createOnLogin: "users-without-wallets"` para usuarios existentes que ya tienen wallet Solana pero no EVM: **[S]** crea la wallet EVM; **[A verificar]**.

## 8. Patrocinio de gas: opciones en Arc

> Descartado por decisión del equipo (22/10/2026): **el usuario paga su gas**. Esta sección queda como referencia.

| Opción | Estado | Notas |
|---|---|---|
| Relayer EIP-3009 (la tesorería envía `transferWithAuthorization`) | [V] documentado por Arc | Usuario firma EIP-712 off-chain, no necesita gas; replica el modelo actual (tesorería paga el costo de red). Expiración natural con `validBefore`. |
| Paymaster ERC-4337 propio | [V] documentado por Arc | Requiere deploy y fondeo de EntryPoint en USDC nativo; agrega infraestructura nueva. |
| Privy gas sponsorship | [A verificar] | Depende de soporte de Arc por Privy/Alchemy. |
| El usuario paga gas en USDC | [V] nativo | Exige reservar USDC para gas en el saldo gastable. |

## 9. Pendiente de verificación antes de implementar

1. Dominio EIP-712 del USDC en mainnet (`eip712Domain()`), y existencia de `authorizationState`.
2. `Memo.memo` envolviendo `transferWithAuthorization` y `transfer` desde un EOA de tesorería (testnet).
3. Exportación de `arc`/`arcTestnet` en el `viem` resuelto y API de hooks EVM en Privy 3.36.1.
4. Soporte de Arc en Privy gas sponsorship (solo si se elige esa opción).
5. Política de rate limit del RPC público de Circle para uso server-side de producción (la doc indica acceso anónimo; no publica límites).
6. Cómo fondear la tesorería en mainnet: la doc sugiere pedir USDC de gas al contacto de Circle o bridgear (CCTP; dominio de Arc `26`).

# Transferencias de USDC y wallet principal

## Comportamiento

Enviar, QR y voz usan una única wallet principal: la wallet EVM embebida de Privy con índice HD 0. El SDK de React devuelve `walletIndex`; el SDK de servidor devuelve `hdWalletIndex`. No se seleccionan wallets por orden, saldo ni dirección de tesorería. El servidor verifica identidad y propiedad antes de preparar y antes de aceptar una firma. Las wallets adicionales no se borran, utilizan ni consolidan.

La creación automática de Privy (`users-without-wallets`) es el único mecanismo de aprovisionamiento. Si la wallet tarda en aparecer, la app permite sincronizar; no crea una adicional. `scripts/audit-primary-wallets.js` genera un inventario de solo lectura sin claves; `--sync` corrige el mapeo para la red configurada y registra la dirección anterior en `wallet_identity_audit`. La API `/wallet` hace la misma sincronización verificada en cada inicio de sesión. Nunca se reescriben destinos de cobros históricos.

La exportación en Profile requiere autorización administrativa del servidor y que la tesorería configurada sea la principal del propio administrador. Privy muestra la clave en su interfaz; la aplicación no la recibe.

## Quién paga el gas

En Arc el gas se paga en USDC. En los envíos del usuario lo paga el usuario, del mismo saldo. El destinatario recibe exactamente el importe ingresado y el gas se descuenta aparte. Un importe es enviable solo si `importe + gas máximo + envíos en curso ≤ saldo`. "Usar todo" propone `saldo − gas estimado`. La hoja de aprobación muestra el costo de red estimado en USDC.

No hay cuota diaria ni presupuesto de patrocinio: la tesorería no participa en los envíos de usuarios.

## API

- `GET /wallet`: identidad principal autenticada y verificada.
- `GET /treasury/export-access`: autorización de exportación de tesorería; usuarios no administradores reciben 403.
- `GET /transfers`: últimas 50 intenciones propias, disponibilidad del servicio y `networkFeeUsdc` (estimación informativa del costo de red).
- `POST /transfers`: `Idempotency-Key` UUID v4 y `{from,to,amount,kind}`. `amount` es un string USDC positivo con hasta seis decimales; `kind` es `pay`, `voice` o `charge_p2p`. Devuelve la intención con `maxNetworkFeeUsdc` y `transaction`: el pedido EIP-1559 sin firmar (chain ID 5042, destino el contrato Memo, nonce, gas y fees). Un reintento conserva importe y destinatario. Si el nonce preparado ya fue usado por otra transacción, el mismo reintento vuelve a preparar la transacción dentro de la misma intención.
- `POST /transfers/:id/submit`: `{signedTransaction}` (transacción firmada serializada, hex). El servidor exige que la transacción sin firma sea byte a byte la preparada, que el firmante sea la wallet de origen y que el nonce siga libre. Comprueba saldo enviable, simula la llamada exacta con `eth_call` y guarda hash y bytes firmados. La transacción no sale hacia ningún RPC antes de ese commit durable.
- `POST /transfers/:id/cancel`: cancela únicamente intenciones sin transacción firmada guardada, bajo el mismo bloqueo del submit.
- `GET /transfers/:id`: consulta propia y seguimiento; no expone los bytes firmados.

No se aceptan transacciones arbitrarias. La única llamada preparada es `Memo.memo(USDC, transfer(destino, importe), keccak256(referencia), memo)`. El destino debe ser una wallet (EOA o EOA delegada EIP-7702), no un contrato. Las lecturas verifican el chain ID de Arc Mainnet.

## Firma en el navegador

`useWalletTransfers` (`src/transfers.js`) prepara la intención, muestra la hoja de aprobación propia y, al confirmar, llama a `signTransaction` de Privy con `showWalletUIs:false`. La firma ocurre dentro de la wallet embebida; la app solo recibe la transacción firmada y la envía a `/submit`.

## Estados

Estados: `awaiting_signature`, `broadcasting`, `completed`, `failed`, `manual_review`, `canceled`.

- La finalidad de Arc es determinística: un recibo exitoso es final. El worker verifica en el recibo el log `Transfer` de USDC (origen, destino e importe) antes de registrar el movimiento contable definitivo, con el gas real (`gasUsed × effectiveGasPrice`) como fee.
- Un recibo revertido queda `failed` (`transfer_onchain_failed`): no se movió USDC, aunque el usuario pagó gas.
- Un recibo exitoso que no coincide con lo preparado queda en `manual_review` (`transfer_chain_mismatch`).
- Sin recibo y con el nonce ya consumido por otra transacción: `manual_review` (`transfer_not_landed_requires_review`). La transferencia conserva su reserva y nunca se vuelve a firmar automáticamente. Si más tarde aparece el recibo, se completa.

El worker retransmite exclusivamente los mismos bytes. Sigue observando recibos aunque el usuario ya no tenga habilitados los envíos, pero no retransmite para usuarios deshabilitados ni para transferencias en revisión. Activity muestra pendientes y finalizados sin duplicados; el reconciliador omite hashes gestionados por el worker. Los errores de tracking se guardan con códigos seguros sin registrar claves ni transacciones firmadas.

### Validación en producción con acceso limitado

Con `TRANSFERS_ENABLED=false`, configurar `TRANSFERS_ALLOWED_USER_IDS=did:privy:ID_DE_PRUEBA` en el contexto Production de Netlify permite enviar únicamente a esos usuarios autenticados (varios IDs separados por coma). No se usan direcciones, emails ni datos del cliente para conceder acceso. La API, la preparación, el submit y el worker aplican la misma política.

Así se valida un envío real con el acceso general cerrado: iniciar sesión con la cuenta habilitada, fondear su wallet con un poco de USDC en Arc, revisar wallet principal y destinatario, aprobar un importe pequeño y comprobar el hash, el recibo y Activity. Para pausar todos los envíos, mantener `TRANSFERS_ENABLED=false` y vaciar `TRANSFERS_ALLOWED_USER_IDS`; el tracking de operaciones existentes continúa.

## Agenda

La API valida tipos, longitudes, direcciones EVM con checksum válido y alias únicos por usuario, y guarda las direcciones normalizadas. Conserva contactos históricos con direcciones de otro formato y los marca incompatibles (`arcCompatible:false`); no los ofrece para enviar. Una dirección pegada tiene prioridad sobre cualquier alias. Alias y nombres deben coincidir de forma exacta y única; una ambigüedad no selecciona destinatario. El destinatario y el importe quedan fijados al preparar el envío.

## Despliegue y aceptación

1. Ejecutar `npm test`, `npm run build` y `npm run functions:check`.
2. Aplicar `db/migrations/20261016_wallet_transfers.sql` (incluida en `npm run db:migrate:payments`) antes de desplegar frontend y Functions.
3. Desplegar con `TRANSFERS_ENABLED=false`. Configurar `ARC_RPC`, `VITE_ARC_RPC` (público), las credenciales Privy, `INTERNAL_WORKER_SECRET`, la URL base del sitio, el RPC de Ethereum y `CHAINLINK_MAX_AGE_SECONDS` para el equivalente informativo ARS.
4. En Privy, habilitar wallets embebidas EVM. Revisar inventario de wallets y mapeos con `scripts/audit-primary-wallets.js`.
5. Habilitar solo la cuenta de prueba con `TRANSFERS_ALLOWED_USER_IDS` y validar los tres flujos (manual, QR, voz), la firma silenciosa de Privy, que el gas mostrado coincida con el cobrado, saldo insuficiente para importe + gas, persistencia tras recarga y fallos. Las pruebas automatizadas usan claves efímeras y RPC simulado; nunca mueven fondos reales.
6. Habilitar el acceso general solo después de estas comprobaciones. Revisar en `wallet_transfers` los códigos `last_error` y la cola de revisión. Una transferencia ambigua se investiga por hash y nonce antes de cualquier recuperación administrativa.

# Revisión previa al merge de Mercado Pago

Actualizada: 22 de octubre de 2026, migración a Arc Mainnet. Rama: `fv-migracionArc`.

Alcance: correcciones, pruebas locales, empaquetado de Functions y preparación del branch. No se ejecutaron cobros ni transferencias durante esta revisión. No se autoriza un merge a `main` ni un despliegue productivo con este informe.

## Hallazgos corregidos

| Prioridad | Falla | Corrección y evidencia |
|---|---|---|
| Crítica | Un RPC de otra cadena podía usarse para reservar liquidez o preparar transacciones. | Toda lectura de tesorería, saldo y preparación verifica `eth_chainId = 5042` (`arc_rpc_network_mismatch`). Pruebas de rechazo de chain IDs incorrectos. |
| Crítica | Dos payouts concurrentes podían compartir nonce de tesorería. | Nonce asignado bajo `pg_advisory_lock`, nunca por debajo del conteo `pending` ni de un nonce ya guardado. Prueba específica. |
| Alta | Un pago de sandbox de Mercado Pago podía liberar USDC real en mainnet. | `MP_ENVIRONMENT=test` queda deshabilitado en Arc Mainnet (`mp_test_requires_test_network`). |
| Alta | Un GET fallido después de guardar la orden dejaba el cobro en `creating`, aunque el QR existiera. | El worker recupera el QR y pasa a `awaiting_payment` tras verificar la orden canónica. Regresión con PostgreSQL embebido. |
| Alta | El historial podía asociar otra operación al intento pendiente del navegador. | La asociación requiere la misma clave e identidad. |
| Alta | Una variable `VITE_TREASURY_SECRET_KEY` podía poner una clave privada a disposición del build del navegador. | Build y diagnóstico rechazan nombres privados con prefijo `VITE_`. Netlify requiere retirar esa variable. |
| Media | Los chequeos terminaban en el primer error. | Preflight reúne todas las dependencias, con plazos y consultas de solo lectura. Endpoint protegido por administrador. |
| Media | Errores de transporte, formatos inesperados y credenciales MP podían terminar como 503 genérico. | Códigos seguros para cuenta, sucursal, RPC y tesorería; sin cuerpos del proveedor ni secretos en logs. |
| Media | Pausar pagos detenía también la observación de transacciones ya enviadas. | Con pagos pausados se siguen observando recibos sin firmar ni retransmitir. Prueba específica. |

La comisión continúa fija en **50 puntos básicos, equivalente a 0,5%**. Una entrega con recibo exitoso genera una sola entrada contable y una sola comisión registrada.

## Verificación reproducible local, sin servicios productivos

```powershell
npm test
npm run build
npm run functions:check
npm run deps:check
```

Las pruebas usan PostgreSQL embebido, claves efímeras y un RPC de Arc simulado. El chequeo de Functions empaqueta las 21 funciones con esbuild, impide solicitudes de red y comprueba el rechazo de solicitudes sin autenticación o firma. El workflow `Mercado Pago review` ejecuta estos controles con `VITE_ARC_NETWORK=mainnet`; no ejecuta operaciones en la red.

Resultado local (22/10/2026): **193 pruebas aprobadas**, build del frontend aprobado y **21 Functions empaquetadas** con verificación de acceso sin autenticación. `deps:check` no se ejecutó en esta revisión (requiere red).

## Vigencia de la cotización Chainlink

Para el proxy `0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b` en Ethereum Mainnet, el registro `USD / ARS` publica **heartbeat de 86400 segundos**, umbral de desviación 0,5% y ocho decimales ([directorio oficial](https://docs.chain.link/data-feeds/price-feeds/addresses)). `CHAINLINK_MAX_AGE_SECONDS=90000` es obligatoria: una ronda más antigua rechaza el cobro con `quote_stale`. Se mantienen las verificaciones de red Ethereum, par `USD / ARS`, precio positivo, ronda completa y timestamp válido.

Advertencias existentes: chunks grandes de Privy/Vite. El SDK de Privy incluye código multi-cadena propio (por ejemplo, pantallas de otras redes) que la app no configura ni usa.

## Dependencias y seguridad

Se reemplazaron las librerías de la cadena anterior por `ethers` v6 y `viem` fijado en `2.55.5` (solo `defineChain`). El control `npm run deps:check` impide aprobar dependencias de ejecución con alertas altas o críticas conocidas. No se usó `npm audit fix --force`. El SDK servidor `@privy-io/server-auth` está deprecado; su migración a `@privy-io/node` requiere una tarea separada. Esta revisión no equivale a certificar que no existen vulnerabilidades.

## Variables que deben existir en Netlify

Usar el contexto de la rama desplegada. El `.env` local no se sube a Netlify. No copiar credenciales de producción a Deploy Previews.

| Scope | Variable | Valor o requisito |
|---|---|---|
| Builds y Functions | `VITE_PRIVY_APP_ID` | ID público de la aplicación Privy (wallets EVM habilitadas). |
| Builds y Functions | `VITE_ARC_NETWORK` | `mainnet`. |
| Builds | `VITE_ARC_RPC` | RPC HTTPS público de Arc para la wallet de Privy (opcional, sin API key). |
| Functions | `PRIVY_APP_SECRET` | Secreto de esa misma aplicación Privy. |
| Functions | `AIVEN_PG_URL` | URL PostgreSQL de la base que contiene las migraciones. |
| Functions | `AIVEN_PG_CA_CERT` | CA del servidor PostgreSQL; se admiten saltos de línea o `\n`. |
| Functions | `ARC_RPC` | RPC de Arc Mainnet para Functions (puede llevar API key). |
| Functions | `TREASURY_SECRET_KEY` | Clave privada EVM (`0x` + 64 hex) de la tesorería dedicada. Sin prefijo `VITE_`. |
| Functions | `MP_ENVIRONMENT` | `production`. |
| Functions | `MP_ACCESS_TOKEN` | Access token del vendedor. |
| Functions | `MP_USER_ID` | ID de la cuenta que corresponde al token. |
| Functions | `MP_STORE_ID` | ID numérico de una sucursal perteneciente al vendedor. |
| Functions | `MP_WEBHOOK_SECRET` | Secreto de firma del webhook Orders de esa aplicación. |
| Functions | `ETH_RPC_URL` | RPC Ethereum Mainnet para el feed. |
| Functions | `CHAINLINK_MAX_AGE_SECONDS` | `90000`. |
| Functions | `CONVERSION_FEE_BPS` | `50`. |
| Functions | `PAYMENTS_BASE_URL` | Origen HTTPS del despliegue que recibirá las llamadas al worker. |
| Functions | `INTERNAL_WORKER_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
| Functions | `PAYMENTS_ENABLED` | `false` durante verificación; `true` permite crear QR cobrables y entregar USDC. |
| Functions | `PAYMENTS_ADMIN_USER_IDS` | DIDs Privy de administradores, separados por comas. |
| Functions | `TRANSFERS_ENABLED`, `TRANSFERS_ALLOWED_USER_IDS` | Envíos de usuarios; `false` y piloto por DID hasta validar. |

`MP_EXTERNAL_POS_ID` es legado. `TREASURY_PRIVATE_KEY` sigue admitida como alias privado; el nombre recomendado es `TREASURY_SECRET_KEY`. Eliminar `VITE_TREASURY_SECRET_KEY` y `VITE_TREASURY_PRIVATE_KEY`. Si una clave privada llegó a un archivo JS público, reemplazarla por una tesorería nueva antes de habilitar fondos. Retirar del contexto de Netlify las variables de la versión anterior que ya no se usan.

## Comprobaciones reales pendientes, antes de habilitar cobros

- Confirmar que el workflow termina correctamente y exigirlo en la protección de `main`.
- Verificar contexto y scopes de Netlify y retirar las variables privadas con prefijo público.
- En un despliegue de revisión autorizado, abrir **Más → Operaciones y comisiones → Verificar configuración de cobros** (`GET /payment-reports/readiness`).
- Confirmar autorización Privy con wallets EVM, asociación del comercio, liquidez USDC de la tesorería (más la reserva de gas) y chain ID 5042.
- Configurar en Mercado Pago la URL HTTPS `/webhooks/mercadopago`, evento **Order**, y su secreto.
- Confirmar que el plan Netlify permite Functions background y que el dispatcher programado y el worker funcionan.
- Cuando se autorice una prueba real: comprobar un cobro, aviso persistido, recibo exitoso con el evento Memo, historial y comisión únicos. No declarar el circuito productivo validado hasta contar con esa evidencia.

## Pausa y recuperación

Ante una transacción ambigua, diferencia de importe o fallos persistentes, mantener/establecer `PAYMENTS_ENABLED=false` mediante un despliegue autorizado. No borrar transacciones firmadas, reservas ni operaciones para forzar otro pago. Los avisos se conservan y las transacciones ya transmitidas siguen observándose hasta su resolución. Nunca hacer rollback de datos contables ni borrar el ledger.

Referencias oficiales: [consulta canónica de Orders QR](https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/get-order/get) y [notificaciones y validación de origen](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications).

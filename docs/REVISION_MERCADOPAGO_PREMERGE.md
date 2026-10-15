# Revisión previa al merge de Mercado Pago

Fecha: 14 de octubre de 2026. Rama: `mercadopago`.

Alcance: correcciones, pruebas locales, empaquetado de Functions y preparación del branch. No se ejecutaron cobros ni transferencias durante esta revisión. No se autoriza un merge a `main` ni un despliegue productivo con este informe.

## Hallazgos corregidos

| Prioridad | Falla | Corrección y evidencia |
|---|---|---|
| Crítica | Los genesis hashes Solana estaban truncados: cualquier RPC real era rechazado al consultar liquidez. | Hashes completos compartidos por frontend/backend; pruebas de ambas redes y rechazo de hashes incorrectos. |
| Alta | Un GET fallido después de guardar la orden dejaba el cobro en `creating`, aunque el QR existiera. | El worker recupera el QR y pasa a `awaiting_payment` tras verificar la orden canónica. Regresión con PostgreSQL embebido. |
| Alta | El historial podía asociar otra operación al intento pendiente del navegador. | La asociación requiere la misma clave e identidad; revisar otro cobro no elimina el intento pendiente. |
| Alta | Una variable `VITE_TREASURY_SECRET_KEY` podía poner una clave privada a disposición del build del navegador. | Build y diagnóstico rechazan nombres privados con prefijo `VITE_`. Se corrigió la copia local sin imprimir claves. Netlify requiere retirar esa variable. |
| Media | Los chequeos terminaban en el primer error y no comprobaban el entorno real de las Functions desplegadas. | Preflight reúne todas las dependencias, con plazos y consultas de solo lectura. Endpoint protegido por administrador y botón en reportes. |
| Media | Errores de transporte, formatos inesperados y credenciales MP podían terminar como 503 genérico. | Códigos seguros para cuenta, sucursal, RPC y tesorería; sin cuerpos del proveedor ni secretos en logs. |
| Media | Crear la orden MP dentro del POST del navegador agregaba llamadas externas y riesgo de timeout. | Primero se guarda la intención; se responde 202 y el worker crea la orden con el cuerpo y clave persistidos. |
| Media | Pausar pagos detenía también la observación de firmas ya enviadas. | Se permite observar `finalized` sin firmar ni retransmitir mientras está pausado. Prueba específica. |
| Media | Quitar `sslmode` con una expresión regular podía romper otros parámetros de PostgreSQL. | Se usa `URL.searchParams`, manteniendo CA y verificación TLS obligatorias; prueba específica. |

La comisión continúa fija en **50 puntos básicos, equivalente a 0,5%**. Una entrega finalizada genera una sola entrada contable y una sola comisión registrada. Se mantienen las pruebas de duplicados, devoluciones, identidad del comercio y separación entre ambientes.

## Verificación reproducible local, sin servicios productivos

```powershell
npm test
npm run build
npm run functions:check
```

Las pruebas usan PostgreSQL embebido y adaptadores de servicios. El chequeo de Functions empaqueta las 13 funciones con esbuild, impide solicitudes de red y comprueba el rechazo de solicitudes sin autenticación o firma. El workflow `Mercado Pago review` ejecuta estos controles para devnet y mainnet en cada PR y push a las ramas configuradas. Cambiar `VITE_SOLANA_CLUSTER` en ese workflow solo cambia la configuración de las pruebas; no ejecuta operaciones en esas redes.

Se probaron migraciones repetibles, reservas concurrentes, persistencia previa a transmitir, recuperación de órdenes y transacciones, firmas de webhook, aislamiento por usuario y comisiones. Esta entrega no incorpora nuevas migraciones.

Resultado local final: **78 pruebas aprobadas** con cada configuración de red; build del frontend aprobado y **13 Functions empaquetadas** con verificación de acceso sin autenticación. La ejecución de GitHub Actions queda pendiente del push y su resultado debe revisarse en el PR.

Advertencias existentes: chunks grandes de Privy/Vite y uso de `import.meta` al empaquetar como CJS. El servidor toma la red de `process.env`; el smoke check comprueba que el paquete carga y valida solicitudes. No se considera suficiente comprobar únicamente el frontend.

## Variables que deben existir en Netlify

Usar el contexto de la rama desplegada. El `.env` local no se sube a Netlify. No copiar credenciales de producción a Deploy Previews.

| Scope | Variable | Valor o requisito |
|---|---|---|
| Builds y Functions | `VITE_PRIVY_APP_ID` | ID público de la aplicación Privy correspondiente. |
| Builds y Functions | `VITE_SOLANA_CLUSTER` | `mainnet-beta` para Mercado Pago productivo; `devnet` para vendedor de prueba. |
| Builds | `VITE_SOLANA_WSS` | WebSocket de la misma red, si se configura uno propio. |
| Functions | `PRIVY_APP_SECRET` | Secreto de esa misma aplicación Privy. |
| Functions | `AIVEN_PG_URL` | URL PostgreSQL de la base que contiene las migraciones. |
| Functions | `AIVEN_PG_CA_CERT` | CA del servidor PostgreSQL; se admiten saltos de línea o `\n`. |
| Functions | `SOLANA_RPC` | RPC HTTP de la misma red que `VITE_SOLANA_CLUSTER`. |
| Functions | `TREASURY_SECRET_KEY` | Clave privada Solana válida de la tesorería dedicada. Sin prefijo `VITE_`. |
| Functions | `MP_ENVIRONMENT` | `production` o `test`, compatible con la red Solana. |
| Functions | `MP_ACCESS_TOKEN` | Access token del vendedor de ese ambiente. |
| Functions | `MP_USER_ID` | ID de la cuenta que corresponde al token. |
| Functions | `MP_STORE_ID` | ID numérico de una sucursal perteneciente al vendedor. |
| Functions | `MP_WEBHOOK_SECRET` | Secreto de firma del webhook Orders de esa aplicación. |
| Functions | `ETH_RPC_URL` | RPC Ethereum mainnet para el feed, también al probar con Solana devnet. |
| Functions | `CHAINLINK_MAX_AGE_SECONDS` | Entero positivo según la política verificada del feed; no aumentar arbitrariamente para aceptar rondas viejas. |
| Functions | `CONVERSION_FEE_BPS` | `50`. |
| Functions | `PAYMENTS_BASE_URL` | Origen HTTPS del despliegue que recibirá las llamadas al worker. |
| Functions | `INTERNAL_WORKER_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
| Functions | `PAYMENTS_ENABLED` | `false` durante verificación; `true` permite crear QR cobrables y entregar USDC. |
| Functions | `PAYMENTS_ADMIN_USER_IDS` | DIDs Privy de administradores, separados por comas. Necesario para verificación y reportes administrativos. |

`MP_EXTERNAL_POS_ID` es legado: no asigna una caja común a todos los nuevos comercios. Cada usuario tiene su asociación persistente. Las asignaciones reservadas por email se reclaman usando el perfil autenticado de Privy. `PAYMENTS_CHECK_USER_ID` es opcional para el chequeo local; en Netlify el diagnóstico utiliza el DID del administrador autenticado.

`TREASURY_PRIVATE_KEY` sigue admitida como alias privado. El nombre recomendado es `TREASURY_SECRET_KEY`. Eliminar `VITE_TREASURY_SECRET_KEY` y `VITE_TREASURY_PRIVATE_KEY`. Si una clave privada llegó a un archivo JS público, reemplazarla por una tesorería nueva antes de habilitar fondos.

Para funciones ajenas al QR, como voz, conservar sus variables actuales. Los secretos privados no deben omitirse del escaneo. Se mantienen únicamente las exclusiones públicas ya acordadas en `netlify.toml`.

## Comprobaciones reales pendientes, antes de habilitar cobros

Estas acciones no se ejecutan como parte de las pruebas locales:

- Confirmar que los dos jobs del workflow terminan correctamente y exigirlos en la protección de `main`.
- Verificar el contexto y scopes de Netlify y retirar las variables privadas con prefijo público. Cambiar variables requiere un nuevo deploy.
- En un despliegue de revisión autorizado, ingresar como administrador y abrir **Más → Operaciones y comisiones → Verificar configuración de cobros**. El endpoint `GET /payment-reports/readiness` comprueba el entorno de esa Function, sin crear órdenes, cajas ni transferencias.
- Confirmar autorización Privy, asociación del comercio, liquidez USDC/SOL y red correctas. El chequeo de tesorería acredita solo el mínimo inicial; la reserva de cada cobro comprueba saldo para su importe y todas las reservas activas.
- Resolver el rechazo `chainlink_invalid_or_stale` observado en la comprobación anterior. Se conserva el bloqueo: una ronda vencida no debe autorizar dinero real.
- Configurar en Mercado Pago la URL HTTPS `/webhooks/mercadopago`, evento **Order**, y su secreto. La verificación local del HMAC no demuestra que Mercado Pago pueda entregar una notificación al dominio.
- Confirmar que el plan Netlify permite Functions background y que el dispatcher programado y el worker funcionan en ese despliegue.
- Cuando se autorice una prueba real: comprobar un cobro, aviso persistido, entrega `finalized`, historial y comisión únicos. No declarar el circuito productivo validado hasta contar con esa evidencia.

Las consultas externas anteriores confirmaron la base migrada y la cuenta/sucursal de prueba. También detectaron que el `.env` de test apuntaba a un RPC mainnet; esa copia local fue alineada con devnet. Esas consultas no certifican las variables de Netlify ni la financiación productiva. Tras la indicación de no ejecutar en producción, la validación se limita a pruebas locales.

## Pausa y recuperación

Ante firma ambigua, diferencia de importe o fallos persistentes, mantener/establecer `PAYMENTS_ENABLED=false` mediante un despliegue autorizado. No borrar firmas, reservas ni operaciones para forzar otro pago. Los avisos se conservan y las firmas ya transmitidas pueden observarse hasta su resolución. No volver a código anterior que permita transferencias públicas de tesorería en mainnet. Nunca hacer rollback de datos contables ni borrar el ledger.

Referencias oficiales contrastadas: [consulta canónica de Orders QR](https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/qr-code/orders/get-order/get) y [notificaciones y validación de origen](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications).

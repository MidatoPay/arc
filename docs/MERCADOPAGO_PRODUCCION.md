# Cobros Mercado Pago → USDC

La revisión técnica y la matriz actual de variables están en [REVISION_MERCADOPAGO_PREMERGE.md](REVISION_MERCADOPAGO_PREMERGE.md). Distingue las verificaciones locales de la validación externa que aún requiere un despliegue y una prueba autorizados.

El botón **Cobrar** y el comando de voz crean un QR dinámico de Mercado Pago. El vendedor recibe ARS; la tesorería prefinanciada envía USDC nativo de Solana a la wallet autenticada. La comisión de conversión es **0,5% del importe ARS**, descontada antes de convertir.

La implementación está preparada para producción, pero no configura credenciales externas ni habilita dinero real automáticamente. `PAYMENTS_ENABLED=false` impide crear órdenes nuevas y enviar USDC; el webhook y la conciliación de órdenes existentes siguen funcionando.

## Configurar Netlify

El escaneo de secretos de Netlify omite únicamente `PAYMENTS_BASE_URL`, `MP_ENVIRONMENT`, `PAYMENTS_ENABLED`, `VITE_SOLANA_CLUSTER` y `ETH_RPC_URL` (configurada con un RPC público). El resto permanece bajo control, incluido `MP_EXTERNAL_POS_ID`. El ID de caja real se reemplazó por un marcador en los documentos; los tokens, secretos y claves siguen protegidos.

Para preparar el archivo privado productivo sin modificar las credenciales ya cargadas: `npm run payments:env:production`. Agrega los faltantes y genera `INTERNAL_WORKER_SECRET`; no imprime secretos. Los RPC públicos sirven para una primera validación, pero la tesorería, Privy y PostgreSQL deben completarse con la configuración real. El archivo `.env.production` está ignorado por Git y no se carga automáticamente en Netlify.

1. Aplicar primero el esquema base existente si la base es nueva. Con respaldo y acceso a PostgreSQL, ejecutar `npm run db:migrate:payments`. La migración versionada está en `db/migrations/20261013_mercadopago.sql`; conserva el historial antiguo como devnet y añade órdenes, avisos, incidencias y reservas. Puede repetirse.
2. Usar `.env.production.example` como lista de configuración del contexto **Production** de Netlify. Mantener credenciales reales fuera de Git, previews y logs.
3. Configurar `VITE_SOLANA_CLUSTER=mainnet-beta`, RPC HTTP privado en `SOLANA_RPC`, y WebSocket mainnet en `VITE_SOLANA_WSS`. Privy, balance, firmas, explorador, reconciliador y tesorería comparten la red. El RPC de tesorería verifica `getGenesisHash` antes de reservar fondos. El mint mainnet es `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, según [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses).
4. Cargar `MP_ACCESS_TOKEN`, `MP_USER_ID`, `MP_STORE_ID` y `MP_WEBHOOK_SECRET` de una misma cuenta productiva argentina; `MP_ENVIRONMENT=production`. `MP_STORE_ID` es el ID numérico de una sucursal existente de esa cuenta. Las cajas se crean automáticamente por usuario Privy en modo atendido `pdv`. `MP_EXTERNAL_POS_ID` queda como configuración antigua y ya no se usa para nuevos cobros. La Public Key y las credenciales OAuth no se requieren para este modelo de vendedor único.
5. Cargar `TREASURY_SECRET_KEY` de una tesorería **dedicada** mainnet, financiada con USDC y SOL. No operarla con otros sistemas: las reservas solo conocen desembolsos de esta aplicación. Se reserva el USDC neto; no se impone un saldo mínimo fijo de SOL.
6. Configurar `ETH_RPC_URL` en Ethereum mainnet para consultar el feed existente `0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b`. Se usa la última ronda publicada sin límite de antigüedad. La lectura verifica red Ethereum, descripción `USD / ARS`, respuesta positiva, ronda completa y timestamp válido, sin fecha futura. El respaldo fijo de la pantalla nunca autoriza cobros.
7. Mantener `CONVERSION_FEE_BPS=50`. Cargar `PAYMENTS_BASE_URL=https://<dominio-productivo>` e `INTERNAL_WORKER_SECRET` aleatorio de al menos 32 caracteres. `npm run payments:env` genera este secreto únicamente en el `.env` privado local y agrega las variables faltantes sin modificar valores existentes ni imprimir secretos.
8. Desplegar con pagos deshabilitados. En Mercado Pago Developers → aplicación → Webhooks → Modo productivo, registrar `https://<dominio-productivo>/webhooks/mercadopago`, seleccionar **Order (Mercado Pago)** y guardar el secreto generado en Netlify. [Guía oficial](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications?scope=prod).
9. Ejecutar `npm run payments:check` con la configuración productiva cargada en un `.env` privado. Hace consultas de cuenta/caja, red/liquidez, feed y tablas; no crea órdenes ni transfiere fondos. Validar también recepción externa del webhook y disponibilidad de funciones background en el plan Netlify.
10. Habilitar `PAYMENTS_ENABLED=true`, volver a desplegar y realizar un cobro controlado autorizado. Confirmar pago real, webhook, entrega finalizada y una sola fila de historial. La compra y los movimientos reales no forman parte de las pruebas automatizadas.

La plataforma absorbe los gastos de Mercado Pago y Solana adicionales al 0,5%. Chainlink se usa como ARS por USD y se asume 1 USDC = 1 USD para la conversión. No hay compra automática de USDC ni retiro automático de ARS desde Mercado Pago.

## Operación y API

### Administrador e historial completo

Cada comercio corresponde a un usuario Privy. Configurar `PAYMENTS_ADMIN_USER_IDS` con los DIDs de los administradores separados por comas, por ejemplo `did:privy:usuario_admin`. Es una variable privada del backend, sin prefijo `VITE_`. El ID propio aparece en **Más**; también se obtiene del dashboard Privy. Con sesión autorizada aparece **Más → Operaciones y comisiones**.

### Caja por usuario Privy

La migración `20261014_merchant_pos.sql`, incluida en `npm run db:migrate:payments`, crea `merchant_payment_pos`. Guarda el DID Privy, ambiente, vendedor, email completo, sucursal, IDs de caja, estado y petición de creación con su clave de idempotencia. No modifica las cajas de cobros anteriores ni sus comisiones.

Con `PAYMENTS_ENABLED=true`, al iniciar sesión la aplicación llama `POST /merchant-pos` con el token Privy. El backend obtiene el email directamente de Privy; no acepta un DID, email o caja aportados por el cliente. También asegura la caja antes del primer cobro, de modo que un alta pendiente pueda reintentarse. Los usuarios existentes quedan asociados cuando vuelven a ingresar. Sin email vinculado se exige vincular uno antes de cobrar.

Se reutiliza la sucursal configurada en `MP_STORE_ID`, disponible en Functions y en el contexto desplegado de Netlify. Crear una caja no crea una sucursal: la sucursal requiere datos físicos propios. Se mantiene el modelo de una cuenta vendedora de la plataforma; cada caja identifica un comercio Privy dentro de esa cuenta.

El nombre visible en la aplicación y el registro local conservan el email completo. Mercado Pago solo admite nombres alfanuméricos, guiones, guiones bajos y espacios, hasta 45 caracteres: por eso `comercio@example.com` se envía como `comercio example com`. El ID externo usa un hash estable del DID, vendedor y ambiente, independiente del email. [Restricciones oficiales de cajas](https://www.mercadopago.com.ar/developers/es/docs/qr-code/create-store-and-pos).

El backend persiste la petición antes de llamar `POST /v2/pos`, serializa el alta por comercio y reutiliza la misma clave y cuerpo tras fallos. Primero busca una caja existente para recuperar respuestas perdidas. Cada orden guarda su caja propia; conciliación, webhooks y entregas validan esa caja guardada, incluso para operaciones antiguas. El alta no crea órdenes de cobro ni envía USDC.

Para reutilizar una caja existente sin conocer todavía el DID Privy, aplicar también `20261014_merchant_pos_assignments.sql` (incluida en el comando de migraciones) y ejecutar `node --env-file=.env scripts/assign-merchant-pos.js <email> <external_id>`. El comando verifica la caja, vendedor y modo QR en Mercado Pago y registra la asignación pendiente en PostgreSQL. No crea ni renombra cajas. Al volver a iniciar sesión, `POST /merchant-pos` consulta el email en Privy y vincula atómicamente la caja al DID autenticado; nunca usa un email enviado por el cliente. Los reintentos reutilizan la asociación, otro DID no puede reclamarla y los cobros históricos conservan su caja original.

El administrador consulta todos los cobros Mercado Pago y movimientos de wallet de todos los comercios, filtrando comercio, fechas, estado, tipo y ambiente. El historial tiene paginación y la exportación CSV recorre todas las páginas. La transferencia de liquidación de un cobro Mercado Pago se muestra junto con ese cobro, sin contabilizarla nuevamente como otra operación. Los comercios consultan únicamente sus propios cobros; pueden cargar páginas anteriores a los últimos 100.

Las comisiones quedan registradas dos veces con propósitos distintos: `charges.fee_cents` conserva la comisión prevista al crear el QR; `commission_ledger` registra una sola comisión al completar la entrega USDC, en la misma transacción que el movimiento contable. La migración `20261013_commission_history.sql` recupera también las entregas completadas anteriormente, sin duplicarlas.

Los reportes separan comisiones registradas, previstas y en revisión. Una devolución posterior a la entrega conserva el registro histórico y aparece en revisión: no se inventa un reintegro automático de la comisión. Las cifras son comisiones brutas; no representan ganancia neta después de costos Mercado Pago/Solana. El período de operaciones usa su fecha de creación y el período de comisiones registradas usa su fecha de entrega USDC; los días del filtro son de Argentina.

API administrativa (Bearer Privy; validación de administrador en el servidor):

- `GET /payment-reports/access`: autorización e ID de la sesión.
- `GET /payment-reports/readiness`: diagnóstico de configuración y dependencias del entorno desplegado, solo lectura; requiere administrador. Disponible también desde el botón **Verificar configuración de cobros**.
- `GET /payment-reports/operations`: historial paginado; devuelve `operations` y `nextCursor`.
- `GET /payment-reports/summary`: totales generales y por comercio.

Filtros: `from`/`to` en formato `YYYY-MM-DD` (ambos días incluidos), `merchant` como DID Privy, `environment=test|production`, `source=mercadopago|wallet`, `status`, `limit` (hasta 200) y `cursor`. Cada cursor pertenece a los filtros usados y mantiene precisión de timestamps para no saltar operaciones.

- `POST /charges`: Bearer Privy + header `Idempotency-Key` UUID v4; cuerpo `{ "ars": "10000.00", "wallet": "<wallet-Solana-del-usuario>" }`. Monto máximo inicial: $1.000.000 ARS; entrega mínima: 0,01 USDC. Devuelve `{ charge }`, con `201` si existe trama QR o `202` si la creación sigue pendiente.
- `GET /charges` y `GET /charges/:id`: solo operaciones de la sesión y ambiente/red activos. Incluyen QR, importe bruto, comisión, cotización, USDC, orden, firma y estado; nunca secretos ni transacción firmada.
- `POST /charges/:id/cancel`: solicita cancelación; no presume cancelación hasta consultar Mercado Pago. Un pago que gana esa carrera se concilia normalmente.
- `POST /webhooks/mercadopago`: validación HMAC según Orders QR. El aviso solo dispara `GET /v1/orders/{id}`: importe, identidad, vendedor, moneda, caja y pago se verifican contra la operación guardada.

La cotización se fija al crear la intención y vence a los 15 minutos. La comisión ARS se redondea a centavos (mitad hacia arriba); USDC se redondea hacia abajo a seis decimales. Ejemplo: $10.000, cotización 1.650 → comisión $50 → entrega 6,030303 USDC. Un reintento conserva referencia, clave y cuerpo. Cambiar monto requiere una operación nueva después de resolver la anterior.

La creación del cobro, el preflight y el worker no imponen un saldo mínimo fijo de SOL. La tesorería sigue pagando las comisiones de red y la posible creación de la cuenta USDC del destinatario. Si la red rechaza una entrega por falta de fondos, la operación conserva su estado pendiente, su reserva USDC y, si ya existe, la misma transacción firmada para reintentar.

El webhook confirma recepción únicamente después de persistir. Un dispatcher cada minuto activa el worker background protegido por secreto; el mismo worker también se solicita después de iniciar un cobro o recibir un aviso. PostgreSQL permite recuperar trabajos aunque falle esa invocación. Las operaciones pendientes se consultan nuevamente para recuperar webhooks perdidos. La pantalla lee el backend cada cinco segundos.

El worker serializa por operación con locks PostgreSQL. Guarda la transacción Solana firmada **antes de transmitir**, vuelve a enviar el mismo wire ante timeouts y exige `finalized` para completar la entrega. Una firma vencida cuya ausencia no prueba que nunca se ejecutó queda en revisión; no se firma un segundo desembolso automáticamente. Historial y liberación de reserva se actualizan juntos en una transacción PostgreSQL.

## Incidencias, reembolsos y pausa

- Revisar `payment_incidents`, `payment_user_blocks`, `charges.last_error` y `payment_inbox.last_error`. No hay un panel administrativo nuevo; la revisión se realiza desde la base privada.
- Avisos de órdenes todavía desconocidas se conservan y reintentan. Tras siete días se marcan `quarantined=true` para revisión, sin borrarlos. Notificaciones duplicadas no duplican movimientos.
- Una devolución antes de firmar detiene la entrega y libera reserva. Si existe firma, se bloquean nuevos cobros del usuario y se abre incidencia: revisar Mercado Pago y Solana antes de resolver. Las transferencias USDC no se revierten automáticamente.
- Nunca borrar una firma o liberar una reserva ambigua para forzar un reintento. La resolución manual debe confirmar primero si hubo entrega. Una devolución posterior a una entrega conserva su historial; se gestiona fuera del circuito automático.
- Para pausar, establecer `PAYMENTS_ENABLED=false` y redesplegar. Seguir recibiendo avisos para conciliar y cancelar órdenes pendientes. No volver a desplegar código antiguo que exponga `/treasury` en mainnet.
- Las credenciales MP no se rotan a otro vendedor con órdenes pendientes; las operaciones conservan vendedor/caja/tesorería y bloquean procesamiento ante cambios incompatibles.

## Desarrollo y validación

`npm run payments:env` prepara el entorno local con `MP_ENVIRONMENT=test`, red devnet y pagos deshabilitados. Completar credenciales de vendedor de prueba, caja, secreto, RPC y cotización antes de habilitar pruebas manuales. El chequeo rechaza un vendedor real en el ambiente de prueba para evitar cobrar dinero real a cambio de tokens devnet.

Para probar el circuito local, ejecutar en orden:

```powershell
npm run payments:env
# Completar el .env privado. No habilitar cobros hasta terminar el chequeo.
npm run db:check:payments
# Aplicar las migraciones si faltan tablas, columnas o índices:
npm run db:migrate:payments
npm run db:check:payments
npm run payments:check
npm run dev:full
```

Abrir `http://localhost:8888` y habilitar ese origen en Privy. `dev:full` inicia frontend y functions juntos, con Vite en 5173 y functions en 9999; no requiere vincular el proyecto a una cuenta Netlify. Reiniciar después de cambiar variables. Para recibir webhooks reales del entorno de prueba, publicar mediante un túnel HTTPS el puerto **8888**, configurar su ruta `/webhooks/mercadopago` en la aplicación del vendedor de prueba y usar `PAYMENTS_BASE_URL=http://localhost:8888` para el worker local.

En producción, cargar las variables en el contexto Netlify que realmente despliega la rama `mercadopago`. `VITE_SOLANA_CLUSTER` debe estar disponible tanto en **Builds** como en **Functions**; las credenciales privadas solo deben estar disponibles del lado del servidor. El commit no carga el `.env` local en Netlify ni ejecuta las migraciones remotas.

Si `GET /charges` devuelve 503, consultar el JSON de respuesta y el registro `payments_failure` de la función `charges`. `payment_schema_missing` o `payment_schema_outdated` requiere aplicar ambas migraciones sobre la misma base usada por Netlify. `missing_aiven_pg_url` y `missing_aiven_pg_ca_cert` indican variables ausentes en Functions; `payment_database_tls_failed` indica un problema del certificado, y `payment_database_auth_failed` credenciales rechazadas. Los registros omiten mensajes SQL, URLs privadas y credenciales. No desactivar TLS para resolverlo.

Los errores `missing_*` identifican la variable faltante en la pantalla y el log, sin exponer su valor. En particular, `missing_eth_rpc_url` exige `ETH_RPC_URL` del servidor (distinto de `VITE_ETH_RPC`). Una ronda con datos inválidos produce `quote_invalid_round`; la antigüedad por sí sola no impide el cobro. `CHAINLINK_MAX_AGE_SECONDS` quedó obsoleta y se ignora. Las variables deben existir en Functions y en el contexto del deploy activo; cambiar el `.env` local no cambia Netlify. La eliminación del límite requiere desplegar esta versión del código.

Para exportar una billetera propia como tesorería, iniciar sesión con su usuario dueño y abrir **Más → Exportar billetera de tesorería**. Solo se listan billeteras Solana embebidas de Privy vinculadas a ese usuario; elegir la dirección completa y pulsar **Abrir exportación en Privy**. El SDK abre el modal seguro de Privy: MidatoPay no recibe, guarda ni registra la clave. Este acceso no depende del rol de administrador y no permite exportar billeteras de otros usuarios. Las billeteras externas o creadas únicamente en el servidor requieren su propio procedimiento de exportación. Guardar la clave Solana Base58 en `TREASURY_SECRET_KEY` de Netlify Functions, sin prefijo `VITE_`, redesplegar y verificar la dirección pública en `/treasury`. Exportar no cambia la tesorería configurada, no modifica cobros históricos ni transfiere fondos.

Un intento sin operación confirmada permite editar el importe conservando su clave de idempotencia. Si ya fue persistido, el servidor rechaza el cambio y la pantalla recupera la operación original mediante `GET /charges?attempt=<clave>`, limitado al usuario, ambiente y red actuales. Abrir la pantalla no inicia automáticamente un cobro.

`npm test` verifica importes, firmas, conciliación, límites de ambiente, fallos de transmisión y persistencia con PostgreSQL embebido sin base remota. `npm run build` compila el frontend. La integración productiva permanece pendiente de credenciales, migración remota, despliegue, financiación y prueba real autorizada.

`npm run db:check:payments` verifica tablas, columnas, índices y permisos con una transacción de solo lectura; no consulta operaciones ni modifica el esquema. Para preparar infraestructura local de prueba, `node --env-file=.env scripts/provision-mercadopago-test.js "Nombre caja de prueba"` crea o recupera una sucursal y caja del vendedor de prueba, reutiliza una ubicación ya registrada y actualiza sus IDs en `.env`. El script rechaza cuentas reales o una red distinta de devnet y no genera cobros ni transferencias.

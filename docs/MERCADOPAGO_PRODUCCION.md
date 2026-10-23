# Cobros Mercado Pago → USDC

La revisión técnica y la matriz actual de variables están en [REVISION_MERCADOPAGO_PREMERGE.md](REVISION_MERCADOPAGO_PREMERGE.md). Distingue las verificaciones locales de la validación externa que aún requiere un despliegue y una prueba autorizados.

El botón **Cobrar** y el comando de voz crean un QR dinámico de Mercado Pago. El vendedor recibe ARS; la tesorería prefinanciada envía USDC en Arc Mainnet a la wallet autenticada. La comisión de conversión es **0,5% del importe ARS**, descontada antes de convertir.

La implementación está preparada para producción, pero no configura credenciales externas ni habilita dinero real automáticamente. `PAYMENTS_ENABLED=false` impide crear órdenes nuevas y enviar USDC; el webhook y la conciliación de órdenes existentes siguen funcionando.

En Arc Mainnet solo se admite `MP_ENVIRONMENT=production`. El ambiente de prueba de Mercado Pago queda deshabilitado (`mp_test_requires_test_network`): un pago de sandbox no puede liberar USDC real.

## Configurar Netlify

El escaneo de secretos de Netlify omite únicamente `PAYMENTS_BASE_URL`, `MP_ENVIRONMENT`, `PAYMENTS_ENABLED`, `VITE_ARC_NETWORK` y `ETH_RPC_URL` (configurada con un RPC público). El resto permanece bajo control, incluidos `ARC_RPC` (puede llevar API key) y `MP_EXTERNAL_POS_ID`.

Para preparar el archivo privado productivo sin modificar las credenciales ya cargadas: `npm run payments:env:production`. Agrega los faltantes y genera `INTERNAL_WORKER_SECRET`; no imprime secretos. El archivo `.env.production` está ignorado por Git y no se carga automáticamente en Netlify.

1. Si la base es nueva, aplicar primero `db/schema.sql`. Con respaldo y acceso a PostgreSQL, ejecutar `npm run db:migrate:payments`. Las migraciones están en `db/migrations/`; añaden órdenes, avisos, incidencias, reservas, cajas, perfiles y envíos. Pueden repetirse.
2. Usar `.env.production.example` como lista de configuración del contexto **Production** de Netlify. Mantener credenciales reales fuera de Git, previews y logs.
3. Configurar `VITE_ARC_NETWORK=mainnet`, un RPC de Arc para Functions en `ARC_RPC` y, opcionalmente, un RPC público en `VITE_ARC_RPC` para la wallet de Privy. Privy, saldo, transacciones, explorer, reconciliador y tesorería comparten la red. El RPC verifica el chain ID `5042` antes de reservar fondos o preparar transacciones. USDC se usa por su interfaz ERC-20 `0x3600000000000000000000000000000000000000` (6 decimales).
4. Cargar `MP_ACCESS_TOKEN`, `MP_USER_ID`, `MP_STORE_ID` y `MP_WEBHOOK_SECRET` de una misma cuenta productiva argentina; `MP_ENVIRONMENT=production`. `MP_STORE_ID` es el ID numérico de una sucursal existente de esa cuenta. Las cajas se crean automáticamente por usuario Privy en modo atendido `pdv`. `MP_EXTERNAL_POS_ID` queda como configuración antigua y ya no se usa para nuevos cobros.
5. Cargar `TREASURY_SECRET_KEY` (clave privada EVM, `0x` + 64 hex) de una tesorería **dedicada** en Arc Mainnet, financiada con USDC. El mismo saldo paga los payouts y su gas. No operarla con otros sistemas: las reservas y los nonces solo conocen desembolsos de esta aplicación. Se reserva el USDC neto de cada cobro y se excluye una reserva fija de 0,05 USDC para gas.
6. Configurar `ETH_RPC_URL` en Ethereum Mainnet para consultar el feed `0xBb65fa58BDb7d33e4a3D1A40a7A9BD99E746367b`, y `CHAINLINK_MAX_AGE_SECONDS=90000` (25 horas: heartbeat publicado de 86400 segundos más una hora de margen). La variable es obligatoria: sin ella no se crean cobros. Una ronda más antigua rechaza el cobro con `quote_stale`. La lectura verifica además red Ethereum, descripción `USD / ARS`, respuesta positiva, ronda completa y timestamp válido. El respaldo fijo de la pantalla nunca autoriza cobros.
7. Mantener `CONVERSION_FEE_BPS=50`. Cargar `PAYMENTS_BASE_URL=https://<dominio-productivo>` e `INTERNAL_WORKER_SECRET` aleatorio de al menos 32 caracteres.
8. Desplegar con pagos deshabilitados. En Mercado Pago Developers → aplicación → Webhooks → Modo productivo, registrar `https://<dominio-productivo>/webhooks/mercadopago`, seleccionar **Order (Mercado Pago)** y guardar el secreto generado en Netlify. [Guía oficial](https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications?scope=prod).
9. Ejecutar `npm run payments:check` con la configuración productiva cargada en un `.env` privado. Consulta cuenta/caja, red (`arc_network`), liquidez de tesorería, feed y tablas; no crea órdenes ni transfiere fondos. Validar también recepción externa del webhook y disponibilidad de funciones background en el plan Netlify.
10. Habilitar `PAYMENTS_ENABLED=true`, volver a desplegar y realizar un cobro controlado autorizado. Confirmar pago real, webhook, entrega con recibo exitoso y una sola fila de historial. La compra y los movimientos reales no forman parte de las pruebas automatizadas.

La plataforma absorbe los gastos de Mercado Pago y el gas de Arc de los payouts, adicionales al 0,5%. Chainlink se usa como ARS por USD y se asume 1 USDC = 1 USD para la conversión. No hay compra automática de USDC ni retiro automático de ARS desde Mercado Pago.

## Operación y API

### Administrador e historial completo

Cada comercio corresponde a un usuario Privy. Configurar `PAYMENTS_ADMIN_USER_IDS` con los DIDs de los administradores separados por comas, por ejemplo `did:privy:usuario_admin`. Es una variable privada del backend, sin prefijo `VITE_`. El ID propio aparece en **Más**; también se obtiene del dashboard Privy. Con sesión autorizada aparece **Más → Operaciones y comisiones**.

### Caja por usuario Privy

La migración `20261014_merchant_pos.sql`, incluida en `npm run db:migrate:payments`, crea `merchant_payment_pos`. Guarda el DID Privy, ambiente, vendedor, email completo, sucursal, IDs de caja, estado y petición de creación con su clave de idempotencia.

Con `PAYMENTS_ENABLED=true`, al iniciar sesión la aplicación llama `POST /merchant-pos` con el token Privy. El backend obtiene el email directamente de Privy; no acepta un DID, email o caja aportados por el cliente. También asegura la caja antes del primer cobro, de modo que un alta pendiente pueda reintentarse. Sin email vinculado se exige vincular uno antes de cobrar.

Se reutiliza la sucursal configurada en `MP_STORE_ID`. Crear una caja no crea una sucursal: la sucursal requiere datos físicos propios. Se mantiene el modelo de una cuenta vendedora de la plataforma; cada caja identifica un comercio Privy dentro de esa cuenta.

El nombre visible en la aplicación y el registro local conservan el email completo. Mercado Pago solo admite nombres alfanuméricos, guiones, guiones bajos y espacios, hasta 45 caracteres: por eso `comercio@example.com` se envía como `comercio example com`. El ID externo usa un hash estable del DID, vendedor y ambiente. [Restricciones oficiales de cajas](https://www.mercadopago.com.ar/developers/es/docs/qr-code/create-store-and-pos).

El backend persiste la petición antes de llamar `POST /v2/pos`, serializa el alta por comercio y reutiliza la misma clave y cuerpo tras fallos. Primero busca una caja existente para recuperar respuestas perdidas. Cada orden guarda su caja propia; conciliación, webhooks y entregas validan esa caja guardada. El alta no crea órdenes de cobro ni envía USDC.

Para reutilizar una caja existente sin conocer todavía el DID Privy, aplicar también `20261014_merchant_pos_assignments.sql` (incluida en el comando de migraciones) y ejecutar `node --env-file=.env scripts/assign-merchant-pos.js <email> <external_id>`. El comando verifica la caja, vendedor y modo QR en Mercado Pago y registra la asignación pendiente en PostgreSQL. Al volver a iniciar sesión, `POST /merchant-pos` consulta el email en Privy y vincula atómicamente la caja al DID autenticado. Otro DID no puede reclamarla.

El administrador consulta todos los cobros Mercado Pago y movimientos de wallet de todos los comercios, filtrando comercio, fechas, estado, tipo y ambiente. El historial tiene paginación y la exportación CSV recorre todas las páginas. La transferencia de liquidación de un cobro se muestra junto con ese cobro, sin contabilizarla nuevamente. Los comercios consultan únicamente sus propios cobros.

Las comisiones quedan registradas dos veces con propósitos distintos: `charges.fee_cents` conserva la comisión prevista al crear el QR; `commission_ledger` registra una sola comisión al completar la entrega USDC, en la misma transacción que el movimiento contable.

Los reportes separan comisiones registradas, previstas y en revisión. Una devolución posterior a la entrega conserva el registro histórico y aparece en revisión. Las cifras son comisiones brutas; no representan ganancia neta después de costos de Mercado Pago y gas de Arc. El período de operaciones usa su fecha de creación y el período de comisiones registradas usa su fecha de entrega USDC; los días del filtro son de Argentina.

API administrativa (Bearer Privy; validación de administrador en el servidor):

- `GET /payment-reports/access`: autorización e ID de la sesión.
- `GET /payment-reports/readiness`: diagnóstico de configuración y dependencias del entorno desplegado, solo lectura; requiere administrador.
- `GET /payment-reports/operations`: historial paginado; devuelve `operations` (con `txHash`) y `nextCursor`.
- `GET /payment-reports/summary`: totales generales y por comercio.

Filtros: `from`/`to` en formato `YYYY-MM-DD` (ambos días incluidos), `merchant` como DID Privy, `environment=test|production`, `source=mercadopago|wallet`, `status`, `limit` (hasta 200) y `cursor`.

- `POST /charges`: Bearer Privy + header `Idempotency-Key` UUID v4; cuerpo `{ "ars": "10000.00", "wallet": "<wallet-Arc-del-usuario>" }`. Monto máximo inicial: $1.000.000 ARS; entrega mínima: 0,01 USDC. Devuelve `{ charge }`, con `201` si existe trama QR o `202` si la creación sigue pendiente.
- `GET /charges` y `GET /charges/:id`: solo operaciones de la sesión y ambiente/red activos. Incluyen QR, importe bruto, comisión, cotización, USDC, orden, hash de transacción (`txHash`) y estado; nunca secretos ni la transacción firmada.
- `POST /charges/:id/cancel`: solicita cancelación; no presume cancelación hasta consultar Mercado Pago.
- `POST /webhooks/mercadopago`: validación HMAC según Orders QR. El aviso solo dispara `GET /v1/orders/{id}`: importe, identidad, vendedor, moneda, caja y pago se verifican contra la operación guardada.

La cotización se fija al crear la intención y vence a los 15 minutos. La comisión ARS se redondea a centavos (mitad hacia arriba); USDC se redondea hacia abajo a seis decimales. Ejemplo: $10.000, cotización 1.650 → comisión $50 → entrega 6,030303 USDC.

La tesorería paga el gas de cada payout en USDC. La liquidez disponible para cobros es el saldo de la tesorería menos la reserva de gas (0,05 USDC) y menos las reservas pendientes. Si la red rechaza una entrega, la operación conserva su estado pendiente, su reserva USDC y, si ya existe, la misma transacción firmada para reintentar.

El webhook confirma recepción únicamente después de persistir y solicita inmediatamente el worker background protegido por secreto. El mismo worker se solicita al iniciar un cobro. Después de verificar el pago, sigue la entrega USDC dentro de esa invocación durante hasta dos minutos, consultando el recibo y retransmitiendo la misma transacción cada 2,5 segundos. Procesa hasta tres cobros en paralelo, con un lock por operación. Un dispatcher cada minuto y PostgreSQL recuperan trabajos si falla la invocación o la entrega sigue pendiente.

El worker asigna el nonce de la tesorería bajo un `pg_advisory_lock` (el mayor entre el conteo `pending` de la red y el último nonce guardado + 1), firma y guarda la transacción **antes de transmitir**, y retransmite exclusivamente los mismos bytes, también ante timeouts. La finalidad de Arc es determinística: un recibo con `status = 1` completa la entrega, registra el movimiento y la comisión y libera la reserva en una transacción PostgreSQL. Un recibo revertido (`arc_transaction_failed`) o un nonce consumido por otra transacción sin recibo de la propia (`arc_payout_not_landed`) quedan en revisión: no se firma un segundo desembolso automáticamente.

## Incidencias, reembolsos y pausa

- Revisar `payment_incidents`, `charges.last_error` y `payment_inbox.last_error`. La revisión se realiza desde la base privada.
- Avisos de órdenes todavía desconocidas se conservan y reintentan. Tras siete días se marcan `quarantined=true` para revisión, sin borrarlos. Notificaciones duplicadas no duplican movimientos.
- Una devolución antes de firmar detiene la entrega y libera reserva. Si existe transacción firmada, se abre una incidencia de esa operación: revisar Mercado Pago y Arc (hash y nonce) antes de resolver. Las transferencias USDC no se revierten automáticamente.
- Nunca borrar una transacción firmada ni liberar una reserva ambigua para forzar un reintento. La resolución manual debe confirmar primero si hubo entrega.
- Una revisión afecta al cobro, sin bloquear nuevos cobros del usuario. Cada cobro nuevo usa otra clave de idempotencia.
- Activity combina los movimientos confirmados con las intenciones de cobro pendientes o en revisión. Un pago ARS acreditado sin entrega USDC figura como entrega pendiente o en revisión, sin presentarlo como saldo recibido ni inventar un hash. Al completarse la entrega, la misma operación aparece una sola vez.
- La pantalla de **Cobrar con MIDATOPAY** muestra **Pago recibido** y permite **Nuevo cobro** desde que el backend verifica la acreditación. Activity presenta primero el importe ARS recibido y separa los **USDC pendientes de acreditación**. Al superar unos tres minutos desde `paid_at`, muestra una entrega demorada sin cambiar el estado persistido.
- Mientras se inicia otro QR, las entregas anteriores siguen actualizándose en el historial. Su finalización refresca Activity y el saldo sin interrumpir el nuevo cobro.
- El worker vuelve a observar transacciones guardadas en revisión por cambio de configuración o por no haber aterrizado. Si la orden sigue acreditada y aparece un recibo exitoso, registra una sola entrega y resuelve la incidencia técnica, incluso si la tesorería ya cambió. Esta recuperación no firma ni transmite otra transferencia.
- Para pausar, establecer `PAYMENTS_ENABLED=false` y redesplegar. Seguir recibiendo avisos para conciliar y cancelar órdenes pendientes.
- Las credenciales MP no se rotan a otro vendedor con órdenes pendientes; las operaciones conservan vendedor/caja/tesorería y bloquean procesamiento ante cambios incompatibles.

## Desarrollo y validación

`npm run payments:env` prepara el `.env` local con pagos deshabilitados. Como en Arc Mainnet no se admite el ambiente de prueba de Mercado Pago, el circuito completo de cobro con dinero de sandbox queda deshabilitado; las pruebas automatizadas (`npm test`) cubren el flujo con PostgreSQL embebido y RPC simulado.

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

Abrir `http://localhost:8888` y habilitar ese origen en Privy. `dev:full` inicia frontend y functions juntos, con Vite en 5173 y functions en 9999. Reiniciar después de cambiar variables.

En producción, cargar las variables en el contexto Netlify que realmente despliega la rama. `VITE_ARC_NETWORK` debe estar disponible tanto en **Builds** como en **Functions**; las credenciales privadas solo del lado del servidor. El commit no carga el `.env` local en Netlify ni ejecuta las migraciones remotas.

Si `GET /charges` devuelve 503, consultar el JSON de respuesta y el registro `payments_failure` de la función `charges`. `payment_schema_missing` o `payment_schema_outdated` requiere aplicar las migraciones sobre la misma base usada por Netlify. `missing_aiven_pg_url` y `missing_aiven_pg_ca_cert` indican variables ausentes en Functions; `payment_database_tls_failed` indica un problema del certificado, y `payment_database_auth_failed` credenciales rechazadas. No desactivar TLS para resolverlo.

Los errores `missing_*` identifican la variable faltante en la pantalla y el log, sin exponer su valor (por ejemplo `missing_arc_rpc` o `missing_eth_rpc_url`). `missing_chainlink_max_age_seconds` exige definir la antigüedad máxima de la cotización; un valor no entero o no positivo produce `invalid_chainlink_max_age_seconds`. `arc_rpc_network_mismatch` indica que `ARC_RPC` sirve otra cadena. No aumentar el máximo de antigüedad arbitrariamente para aceptar una ronda vieja.

Para exportar una billetera propia como tesorería, iniciar sesión con su usuario dueño y abrir **Más → Exportar billetera de tesorería**. Solo se listan billeteras EVM embebidas de Privy vinculadas a ese usuario; elegir la dirección completa y pulsar **Abrir exportación en Privy**. El SDK abre el modal seguro de Privy: MidatoPay no recibe, guarda ni registra la clave. Guardar la clave privada EVM (`0x…`) en `TREASURY_SECRET_KEY` de Netlify Functions, sin prefijo `VITE_`, redesplegar y verificar la dirección pública en `/treasury`. Exportar no cambia la tesorería configurada ni transfiere fondos.

Un intento sin operación confirmada permite editar el importe conservando su clave de idempotencia. Si ya fue persistido, el servidor rechaza el cambio y la pantalla recupera la operación original mediante `GET /charges?attempt=<clave>`.

`npm test` verifica importes, transacciones firmadas, nonces, conciliación, límites de ambiente, fallos de transmisión y persistencia con PostgreSQL embebido sin base remota. `npm run build` compila el frontend. La integración productiva permanece pendiente de credenciales, migración remota, despliegue, financiación y prueba real autorizada.

`npm run db:check:payments` verifica tablas, columnas, índices y permisos con una transacción de solo lectura. `scripts/provision-mercadopago-test.js` (alta de sucursal y caja de prueba) solo corre contra una red de prueba; en Arc Mainnet queda deshabilitado.

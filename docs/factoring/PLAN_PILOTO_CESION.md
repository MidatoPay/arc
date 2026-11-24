# Plan: piloto de cesión de facturas a un inversor

**Borrador para revisión; no ejecutar.**

Fecha: 11/11/2026. Branch: `factoring`. Decisiones de base: `DECISIONES_MOCK_CESION.md`.

## Problema

MidatoPay tiene que permitir que un emisor ceda una factura a un único inversor. Los pagos en pesos son reales y se hacen entre cuentas de 21 Millions. Cada factura tiene un NFT en Arc Mainnet que deja registrados, de forma pública, los términos y cada cambio de estado. Los pools de liquidez quedan descartados por motivos regulatorios.

## Solución

- **Factura:** se crea con un formulario («SIMULADA») o se sube el archivo y se lee el QR. El deudor tiene que estar en la lista curada.
- **Aceptación:** el deudor acepta de forma expresa, o tácita a los 21 días. Ahí la factura se publica y corren 72 horas para conseguir inversor.
- **Toma:** cuando un inversor acepta, MidatoPay calcula los montos (35% TNA, comisión del 2,5% del descuento) y ordena a 21 Millions dos retiros desde la cuenta del inversor: el neto al CVU del emisor y la comisión al CVU de MidatoPay.
- **Cesión:** con los dos retiros completados, la clave de cesión de MidatoPay pasa el NFT al inversor y se notifica al deudor.
- **Cobro:** desde el vencimiento, el deudor elige la factura en la app y se ordena el retiro del nominal a la cuenta del inversor. Sin pago, la factura pasa a mora al día siguiente.
- **Registro on-chain:** cada cambio de estado deja un evento en Postgres; un worker lo escribe en el contrato. El registro no bloquea el flujo de dinero, salvo la cesión del NFT, que va después del pago.

Diagramas de secuencia y de estados: `DECISIONES_MOCK_CESION.md`, sección 3.

## Tareas

### Task 1: Documento de decisiones

- **Objetivo:** `docs/factoring/DECISIONES_MOCK_CESION.md`.
- **Guía:** decisiones, fórmulas, ejemplos de ARS 100 y ARS 17 millones, flujo, estados, investigación, riesgos, supuestos y decisiones abiertas.
- **Tests:** cada columna de las tablas suma el nominal.
- **Demo:** el documento. **Hecho el 11/11/2026.**

### Task 2: Descartar los pools en los documentos existentes

- **Objetivo:** que el handoff y el ejemplo financiero reflejen el modelo sin pools.
- **Guía:**
  - En `FACTORING_HANDOFF.md`, marcar como descartadas las secciones de pools (5.4 a 5.6, 8.7, 9 y FD-08 a FD-13) y apuntar a `DECISIONES_MOCK_CESION.md`.
  - Ampliar la sección 6.3 con la Ley 27.440 **[V]** y pasar la RG 1150 a **[V]** con el comunicado oficial.
  - Actualizar `EJEMPLO_FINANCIERO.md` (secciones 4.2 y 6) con el nuevo esquema de comisión.
  - Regenerar `FLUJO_FACTORING_MIDATOPAY` y `EJEMPLO_FINANCIERO` en SVG y JPG, sin pools.
- **Tests:** revisión de consistencia entre documentos.
- **Demo:** documentos e imágenes coherentes con el modelo de un inversor por factura.

### Task 3: Cálculo de la cesión

- **Objetivo:** `src/invoiceCession.js`, módulo puro compartido entre cliente y servidor.
- **Guía:** montos en centavos con BigInt y redondeo definido. Tasa y comisión en puntos básicos como parámetros. Error si quedan 0 días o menos. Control de días hábiles para FCE con lista de feriados inyectable. El servidor recalcula siempre.
- **Tests:** `test/invoice-cession.test.js` con ARS 100 y ARS 17 millones a 30, 60 y 90 días, la suma igual al nominal, 0 días y redondeo.
- **Demo:** `node --test test/invoice-cession.test.js`.

### Task 4: Carga de facturas

- **Objetivo:** `src/invoiceQr.js` y un validador compartido para formulario y QR.
- **Guía:** lista cerrada de hosts del QR, Base64 tolerante a la variante URL-safe, CUIT con dígito verificador, montos mínimos, vencimiento futuro, marca de simulada y detección de FCE por `tipoCmp`.
- **Tests:** `test/invoice-qr.test.js` con casos válidos e inválidos de los dos orígenes.
- **Demo:** validar una factura de cada tipo.

### Task 5: Migración (sin aplicar)

- **Objetivo:** esquema de base de datos del piloto.
- **Guía:** tablas de facturas, deudores de la lista, perfiles de emisor e inversor con `customer_id` de 21 Millions, ofertas, órdenes de 21 Millions con `idempotency_key`, eventos on-chain pendientes y NFT. DDL idempotente. Registrar el archivo en `scripts/migrate-payments.js` y las tablas en `netlify/functions/lib/paymentDatabase.js`.
- **Tests:** aplicarla dos veces con PGlite y probar los índices únicos (una oferta activa por factura, una orden por clave).
- **Demo:** el test pasa. No se aplica a ninguna base.

### Task 6: Máquina de estados

- **Objetivo:** `netlify/functions/lib/invoiceCession.js`, sin dinero ni cadena.
- **Guía:** reloj inyectado. Aceptación tácita a los 21 días, publicación, vencimiento a las 72 horas, toma con bloqueo por factura e idempotencia, reglas FCE (tipo de inversor y 3 días hábiles) y mora.
- **Tests:** todas las transiciones válidas e inválidas con reloj falso y PGlite.
- **Demo:** el ciclo completo en un test.

### Task 7: Acceso y configuración

- **Objetivo:** `netlify/functions/lib/factoringAccess.js`.
- **Guía:** flags (`FACTORING_ENABLED` y similares), listas de emisores e inversores, deudores cargados fuera del repo, constatación en ARCA configurable, CVU de comisión, plazo de aceptación y de oferta. Documentar en `.env.example` y `.env.production.example`.
- **Tests:** cada combinación de flags y listas.
- **Demo:** los tests.

### Task 8: Endpoints del emisor y del deudor

- **Objetivo:** `netlify/functions/invoices.js`.
- **Guía:** alta, envío al deudor, aceptación o rechazo del deudor y listado de facturas a pagar. Autenticación antes de cualquier otra cosa. Redirects en `netlify.toml` y registro en `scripts/check-functions.js`.
- **Tests:** con PGlite: autenticación, aislamiento por usuario, factura duplicada y deudor fuera de la lista.
- **Demo:** llevar una factura hasta «publicada» con curl.

### Task 9: Cliente de 21 Millions

- **Objetivo:** `netlify/functions/lib/twentyOneMillions.js`.
- **Guía:** saldos, retiro en pesos con `Idempotency-Key`, consulta de órdenes y feeds de eventos y depósitos. Ambiente staging o production según la clave (`nx_test_` o `nx_live_`). La clave nunca se loguea.
- **Tests:** fetch inyectado con respuestas tomadas del contrato (`COMPLETED`, `PROCESSING`, 502, 503, 409 y saldo insuficiente).
- **Demo:** los tests, sin llamadas reales.

### Task 10: Toma de la factura por el inversor

- **Objetivo:** `netlify/functions/invoice-offers.js`.
- **Guía:** listado de ofertas con la TNA al momento de la consulta. Al aceptar: control de saldo, retiro del neto, retiro de la comisión, seguimiento de las órdenes y revisión manual si algo falla (reglas de pagos en `DECISIONES_MOCK_CESION.md`, 3.3).
- **Tests:** con 21 Millions simulado: dos inversores aceptando a la vez, reintentos sin duplicar y fallos parciales.
- **Demo:** una toma de punta a punta contra el simulado.

### Task 11: Pago del deudor

- **Objetivo:** que el deudor pague desde el vencimiento eligiendo la factura.
- **Guía:** retiro del nominal desde la cuenta del deudor al CVU del inversor; la factura queda cobrada cuando la orden se completa.
- **Tests:** no se puede pagar antes del vencimiento, se paga una sola vez y la factura queda cobrada.
- **Demo:** con el simulado.

### Task 12: Worker programado

- **Objetivo:** las transiciones que dependen del tiempo.
- **Guía:** aceptación tácita, vencimiento de ofertas, conciliación de órdenes con el feed de eventos y paso a mora. Schedule en `netlify.toml` y nombre agregado a la allowlist de `kickWorker`.
- **Tests:** con reloj falso.
- **Demo:** adelantar el reloj y ver los cambios de estado.

### Task 13: Pantalla del emisor

- **Objetivo:** crear o subir facturas, enviarlas y seguir sus estados y plazos.
- **Guía:** `src/invoices.js` y `src/InvoicesScreen.jsx`, estilos según el skill de frontend, textos en `en` y `es` de `src/i18n.jsx`.
- **Tests:** render del componente y `npm run build`.
- **Demo:** el emisor lleva una factura a «publicada».

### Task 14: Pantallas del inversor y del deudor

- **Objetivo:** el inversor ve las ofertas con su detalle numérico y acepta; el deudor ve sus facturas, las acepta o rechaza y paga.
- **Tests:** render de los componentes y `npm run build`.
- **Demo:** el ciclo completo en la app contra el 21 Millions simulado, con el dinero real desactivado.

### Task 15: Contrato de registro y cambio de ARC-RULES

- **Objetivo:** el ERC-721 y la regla que lo habilita.
- **Guía:**
  - Cambiar `ARC-RULES.md` para habilitar solo este contrato. **Requiere aprobación.**
  - Proyecto Foundry en `contracts/` con OpenZeppelin ERC-721, roles de registro y de cesión, función `cede`, transferencias comunes deshabilitadas, términos y eventos con montos y hashes, sin datos personales.
- **Tests:** `forge test`.
- **Demo:** los tests pasan. Todavía no se despliega.

### Task 16: Worker del registro on-chain

- **Objetivo:** escribir en el contrato la emisión, los eventos y la cesión.
- **Guía:** clave `FACTORING_REGISTRY_SECRET_KEY`, separada de la tesorería. Patrón de `settlePayout`. Verificación de los logs del receipt. Flag `FACTORING_NFT_ENABLED`.
- **Tests:** con RPC simulado: reenvío idéntico, nonce consumido y revisión manual.
- **Demo:** los tests.

### Task 17 (opcional): Constatación en ARCA

- **Objetivo:** cliente WSAA + WSCDC del handoff, detrás de un flag.
- **Guía:** según `FACTORING_HANDOFF.md`, secciones 3.3 y 8.5.
- **Tests:** respuestas SOAP de ejemplo con request inyectado.
- **Demo:** requiere el certificado de ARCA.

### Task 18: Despliegue y piloto

- **Objetivo:** correr una factura real de monto mínimo.
- **Guía:** **solo con autorización explícita**, porque es irreversible y mueve dinero real. Desplegar el contrato en Arc Mainnet, cargar la clave `nx_live_` de 21 Millions, habilitar a los usuarios del piloto.
- **Demo:** el NFT y sus eventos en `explorer.arc.io` y las órdenes completadas en 21 Millions.

## Cierre de cada tarea

Cada tarea cierra con `npm test`, `npm run build` y `npm run functions:check` cuando toca Functions. No se aplican migraciones ni se hace push sin pedido explícito.

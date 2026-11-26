# Factoring de facturas en MidatoPay: documento de traspaso

Fecha: 09/11/2026. Branch: `factoring`, creado desde `main` en `3670809`. Estado: análisis y diseño propuesto. No hay código de esta funcionalidad todavía.

> **Aviso, 11/11/2026:** los pools de liquidez quedaron descartados por motivos regulatorios. El modelo vigente es la cesión de cada factura a un único inversor: ver `DECISIONES_MOCK_CESION.md` y el borrador `PLAN_PILOTO_CESION.md`. Las secciones de pools (5.4 a 5.6, 8.7, 9 y FD-08 a FD-13) se van a reescribir en la tarea 2 del plan.
>
> **Imágenes, 26/11/2026:** `FLUJO_FACTORING_MIDATOPAY.svg/.jpg` y `EJEMPLO_FINANCIERO.svg/.jpg` muestran el modelo de pools y quedan como historial. Las vigentes son `FLUJO_CESION_INVERSOR.svg/.jpg` (flujo de la cesión) y `EJEMPLO_FINANCIERO_CESION.svg/.jpg` (ejemplo financiero).

Este documento reúne lo analizado sobre factoring de facturas electrónicas argentinas: producto, procedimientos, marco legal, competencia y diseño técnico sobre el código actual. Está escrito para que otro modelo o desarrollador continúe la implementación sin repetir la investigación.

## 0. Cómo usar este documento

### 0.1 Leyenda de verificación

Cada afirmación relevante lleva una marca:

- **[V]** Verificado el 09/11/2026 en una fuente oficial o primaria (texto normativo, documentación oficial, página del servicio).
- **[S]** Fuente secundaria (estudios jurídicos, prensa, SDKs de terceros) o tomado del análisis previo. Confirmar antes de depender de ello.
- **[P]** Propuesta de diseño. No está decidida.

Nada de este documento es asesoramiento legal. La sección 6 es un mapa para trabajar con un abogado de mercado de capitales.

### 0.2 Fuentes de verdad del repo

Antes de tocar código, leer `CLAUDE.md`, `ARC-RULES.md`, `README.md`, `.env.example`, `.env.production.example` y `docs/arc-migration/`. Los documentos de `docs/superpowers/` son contexto histórico de Arc Testnet: la lógica de producto vale, la implementación vigente es la del código.

Existe además un documento ejecutivo para CEO, CFO y CBO, `Midatopay_Pools_Factoring_Propuesta_Ejecutiva.docx`. No está en el repo.

### 0.3 Reglas no negociables (de `ARC-RULES.md` y de la regla de workspace `arc-first`)

1. Solo Arc Mainnet (chain ID `5042`). Las features de prueba quedan desactivadas en mainnet (`NETWORK.testnet === false`), pero no se borran.
2. Sin contratos propios: todo movimiento de USDC pasa por el contrato Memo. Sin token propio, AMM, bridge, oráculo propio ni **servicio de custodia**.
3. Solo transacciones EIP-1559 con piso de 20 gwei. La transacción firmada y su nonce se persisten antes del broadcast. Solo se re-difunden los mismos bytes. Un receipt fallido o un nonce consumido por otra transacción va a revisión manual. Los nonces de tesorería se asignan bajo lock de base de datos.
4. El resultado se verifica desde el log `Transfer` del receipt, no desde el pedido.
5. On-chain va lo mínimo: el pago y el memo `MIDATO|v1|…`. **CUIT, razón social, DNI y datos de la factura quedan en Postgres, nunca en el memo.**
6. Los secretos son solo server-side y nunca llevan prefijo `VITE_`.
7. No correr migraciones contra ninguna base ni hacer push sin pedido explícito.

Las reglas 2 y 5 condicionan directamente las fases 2 a 4 de este plan (ver 8.10 y FD-12/FD-13).

## 1. Objetivo y alcance

**Objetivo de producto.** Un comercio carga una factura electrónica que emitió a su cliente (PDF, JPG o PNG). MidatoPay lee el QR fiscal, extrae los datos, detecta duplicados y constata la autorización del comprobante con ARCA. En fases posteriores, el comercio puede pedir un adelanto sobre esa factura, financiado por un inversor y luego por un pool de liquidez en USDC con una estructura similar a Huma Institutional.

**Alcance del MVP (Fase 1) [P].** Carga del archivo, lectura del QR, vista previa editable, detección de duplicados, constatación con ARCA (WSCDC) desde el backend e historial de verificaciones. No mueve dinero.

**Fuera del MVP.** Lectura de productos e impuestos, OCR completo, adelantos, pools, tokens, cobranza al deudor y cesión legal.

## 2. Estado actual

- El código no tiene nada de CUIT, AFIP/ARCA, WSCDC, factoring, préstamos, KYC/KYB, subida de archivos, almacenamiento de blobs, OCR ni parseo de PDF.
- `factura` e `inv` en el código son referencias internas de pago (`transactions.factura`, `nuevaFactura()` en `src/arc.js`, `inv:` en memos). **No son facturas fiscales.** No reutilizar esos nombres para el comprobante de ARCA, para evitar confusiones.
- El "comercio" es el usuario Privy (`did:privy:…`), más `merchant_profiles(user_id, user_name, business_name)` y `merchant_payment_pos`. No hay datos fiscales del comercio.
- El branch `21millon` contiene el análisis de una billetera ARS/USDC con 21 Millions (`docs/21millon/`) y un laboratorio de su Partner API con alta KYC/KYB (`examples/21m-kyc/`). El análisis previo de factoring menciona que MidatoPay usaría cuentas de un PSPCP tercero bajo el modelo "PSPCP como Servicio". **Confirmar si ese proveedor es 21 Millions.** Su KYB podría ser la fuente de verificación del CUIT del comercio (FD-02).

## 3. Factura electrónica argentina: QR y ARCA

### 3.1 Por qué las facturas tienen QR

La RG 4892/2020 hizo obligatorio un código QR en los comprobantes electrónicos emitidos bajo la RG 4291. Rige desde el 24/12/2020, con un cronograma escalonado durante 2021 para quienes emiten por web service **[V]**. Es un QR fiscal para identificar y verificar el comprobante, no un QR de pago.

El QR codifica una URL con un JSON en Base64 en el parámetro `p` **[S]**:

```
https://www.afip.gob.ar/fe/qr/?p=<JSON en Base64>
```

El análisis previo citó el host `www.arca.gob.ar`. La página oficial pide verificar que se ingresa a `serviciosweb.afip.gob.ar` cuando se valida el QR **[V]**. **El parser debe aceptar una lista cerrada de hosts y probarse con QRs reales** (FD-17).

**Base64 no es una firma.** Un QR bien formado puede ser apócrifo. La lectura del QR solo extrae datos. La autenticidad se comprueba con la constatación en ARCA (3.3).

### 3.2 Campos del QR

Nombres según la especificación de la RG 4892, tomados de ejemplos de SDKs **[S]**. Verificar contra el PDF oficial de especificaciones de ARCA, que no se pudo leer en esta sesión.

| Campo | Tipo | Contenido | Validación propuesta [P] |
|---|---|---|---|
| `ver` | número | Versión del formato (1) | Igual a 1 |
| `fecha` | texto `YYYY-MM-DD` | Fecha de emisión | Fecha válida, no futura |
| `cuit` | número (11 dígitos) | CUIT del emisor | 11 dígitos y dígito verificador válido |
| `ptoVta` | número | Punto de venta | Entero de 1 a 99999 |
| `tipoCmp` | número | Tipo de comprobante (tabla de ARCA) | Entero en la tabla admitida |
| `nroCmp` | número | Número de comprobante | Entero de 1 a 99999999 |
| `importe` | número | Total en la moneda del comprobante | Mayor a 0, como máximo 2 decimales |
| `moneda` | texto | Código de moneda ARCA (`PES`, `DOL`, …) | 3 caracteres |
| `ctz` | número | Cotización | Mayor a 0 (1 para `PES`) |
| `tipoDocRec` | número, opcional | Tipo de documento del receptor (80 CUIT, 86 CUIL, 96 DNI, 99 sin identificar) **[S]** | Entero si existe |
| `nroDocRec` | número, opcional | Documento del receptor | Entero si existe |
| `tipoCodAut` | texto | `E` = CAE, `A` = CAEA | `E` o `A` |
| `codAut` | número (14 dígitos) | Código de autorización | 14 dígitos |

Dígito verificador del CUIT **[S]**: pesos `5,4,3,2,7,6,5,4,3,2` sobre los primeros 10 dígitos; `dv = 11 - (suma mod 11)`; si da 11 el dígito es 0; si da 10 el CUIT es inválido.

Precisión: `importe` llega como número JSON. Convertirlo a centavos enteros (`BIGINT`) sin aritmética de punto flotante acumulada, con el mismo criterio de `decimalUnits` en `netlify/functions/lib/paymentCore.js`.

**Lo que el QR no trae:** razón social y domicilio del emisor, productos, cantidades, precios unitarios, desglose de IVA y otros impuestos, vencimiento comercial ni condiciones de pago. Esos datos salen del texto del PDF, de OCR o de carga manual.

### 3.3 Constatación con ARCA: WSCDC `ComprobanteConstatar`

El servicio oficial de Constatación de Comprobantes es SOAP **[V]**:

- Producción: `https://servicios1.afip.gov.ar/wscdc/service.asmx`, SOAPAction `http://servicios1.afip.gob.ar/wscdc/ComprobanteConstatar` **[V]**.
- Homologación: `https://wswhomo.afip.gov.ar/WSCDC/service.asmx` **[S]**. En homologación solo se constatan comprobantes emitidos en homologación **[S]**.

Request (`Auth` + `CmpReq`) **[V]**:

| Campo WSCDC | Origen en el QR |
|---|---|
| `Auth.Token`, `Auth.Sign`, `Auth.Cuit` | Ticket de acceso de WSAA y CUIT de MidatoPay |
| `CbteModo` | `tipoCodAut`: `E` → `CAE`, `A` → `CAEA` **[S]** |
| `CuitEmisor` | `cuit` |
| `PtoVta` | `ptoVta` |
| `CbteTipo` | `tipoCmp` |
| `CbteNro` | `nroCmp` |
| `CbteFch` | `fecha`, en formato `yyyymmdd` **[S]** |
| `ImpTotal` | `importe` |
| `CodAutorizacion` | `codAut` |
| `DocTipoReceptor`, `DocNroReceptor` | `tipoDocRec`, `nroDocRec` |
| `Opcionales` | Según el tipo de comprobante |

Response **[V]**: `CmpResp` (eco de los datos), `Resultado`, `Observaciones[]` (`Code`, `Msg`), `FchProceso`, `Events[]` y `Errors[]`. Los valores esperados de `Resultado` son `A` (aprobado) y `R` (rechazado) **[S]**.

**Qué no devuelve:** el PDF, los productos, el estado de pago, si la factura fue cedida o si existe una nota de crédito posterior que la anule.

**Autenticación WSAA [S]:**

1. MidatoPay necesita su propio CUIT, un certificado X.509 emitido por ARCA y la relación con el servicio `wscdc` dada de alta.
2. Se arma un TRA (XML con `uniqueId`, `generationTime`, `expirationTime` y `service=wscdc`), se firma como CMS/PKCS#7 con el certificado y la clave privada, y se envía a `LoginCms` de WSAA.
3. WSAA devuelve un ticket de acceso (TA) con `token` y `sign`, válido unas 12 horas.
4. Si se pide un TA nuevo mientras hay uno vigente, WSAA lo rechaza. **El TA debe cachearse de forma persistente**, porque las Functions no comparten memoria.

La consulta web pública tiene CAPTCHA. Para automatizar hay que usar el web service.

### 3.4 Otros servicios

- **WSFEv1 `FECompConsultar`** consulta comprobantes emitidos por el CUIT autenticado **[S]**. Sirve solo si el comercio delega a MidatoPay el acceso a su CUIT. No es un mecanismo para descargar facturas de terceros, y no trae detalle de ítems.
- **Factura de Crédito Electrónica MiPyME (FCE).** Usa tipos de comprobante propios, del 201 al 213 **[S]**. Tiene un régimen legal y de circulación distinto (6.3). La app debe detectarla por `tipoCmp` y no tratarla como una factura común.

### 3.5 Qué prueba cada control

| Control | Prueba | No prueba |
|---|---|---|
| Lectura del QR | Qué datos dice el comprobante sobre sí mismo | Que sea auténtico |
| Constatación WSCDC aprobada | Que ARCA autorizó un comprobante con esos datos | Que la operación subyacente exista, que siga impaga, que no esté cedida ni anulada por una nota de crédito |
| Conformidad del deudor [P] | Que el cliente reconoce la deuda y el vencimiento | Que vaya a pagar |
| Notificación de la cesión [P] | Oponibilidad frente al deudor y terceros (6.2) | Solvencia del deudor |

Por eso la interfaz muestra **dos indicadores separados**:

| Indicador | Valores | Qué informa |
|---|---|---|
| Lectura | Datos extraídos / Requiere revisión / Confirmado por el comercio | Calidad de la lectura del archivo |
| ARCA | Pendiente / Constatada / Con observaciones / Rechazada / Error de consulta | Resultado de WSCDC |

Una lectura correcta del QR nunca se muestra como validación fiscal.

## 4. Flujo funcional del MVP (Fase 1)

1. El comercio sube un PDF, JPG o PNG. Se conserva el archivo original y se calcula su SHA-256.
2. El cliente busca el QR: `BarcodeDetector` si existe y `jsQR` como respaldo, la misma técnica de `src/QrScanner.jsx`. Para PDF, se renderiza la primera página (y si no aparece, las siguientes) a un canvas (FD-06).
3. Se parsea y valida el payload (3.2) con un módulo compartido entre cliente y servidor. El servidor vuelve a parsear y validar: nunca confía en datos ya extraídos por el cliente.
4. Si no hay QR o no se puede leer, la carga sigue con carga manual de los mismos campos y queda en "Requiere revisión".
5. Detección de duplicados (4.1).
6. El comercio revisa la vista previa, corrige si hace falta y confirma. Puede cargar el vencimiento comercial, que no está en el QR.
7. El backend constata con WSCDC. Guarda resultado, observaciones, errores y fecha de proceso en un registro de verificaciones que solo crece.
8. Si ARCA no responde, la constatación queda pendiente y un worker la reintenta con backoff.

**Fase 1b [P].** Leer el texto del PDF (extracción directa si el PDF tiene texto, OCR si es imagen) y cruzarlo con el QR: CUIT, número, fecha y total. Si difieren, la factura pasa a revisión. Las opciones de extracción están en FD-06.

### 4.1 Duplicados

- Clave de comprobante: CUIT emisor + tipo + punto de venta + número.
- **Fase 1:** único por comercio (`user_id` + clave) y por archivo (`user_id` + SHA-256).
- **Fase 2:** la misma clave no puede tener más de un adelanto activo en toda la plataforma, sin importar quién la cargó (índice único parcial sobre los adelantos activos).
- MidatoPay no puede detectar si la factura se financió fuera de la plataforma. Eso se cubre con la notificación de la cesión y la conformidad del deudor (6.2).

### 4.2 Requisito de titularidad

Para factorear, la factura debe ser una cuenta por cobrar del comercio: el CUIT emisor debe ser el CUIT verificado del comercio. Hoy la app no guarda ni verifica CUITs (FD-01, FD-02). En Fase 1 se puede cargar y constatar sin esa verificación, pero la factura no puede pasar a Fase 2 sin ella.

## 5. Modelo de negocio: factoring y pools tipo Huma

### 5.1 Huma Institutional (referencia principal) [V]

**Tipos de pool:**

- Línea de crédito rotativa.
- Línea de crédito respaldada por cuentas por cobrar: cada retiro requiere presentar una factura aprobada, y se aplica un advance rate menor al 100%.
- Crédito por factoring de cuentas por cobrar: el prestatario recibe un adelanto equivalente a un porcentaje de la factura.

**Roles:**

| Rol | Función |
|---|---|
| Protocol Owner (multisig) | Administra el protocolo, alta y baja de Pool Owners y pausers |
| Pausers | Pueden pausar el protocolo. Solo el Protocol Owner despausa |
| Pool Owner | Crea y configura el pool, elige el Evaluation Agent y define comisiones |
| Pool Operators | Revisan KYC/KYB y acreditación, y aprueban inversores |
| Evaluation Agent (EA) | Aprueba créditos y, en pools de facturas, la calidad de cada factura. Declara el default y reestructura |
| Lenders | Aportan capital al tramo senior o junior |
| Borrowers | Piden financiamiento y repagan |

**Alineación de incentivos.** El Pool Owner y el EA deben depositar capital antes de que el pool acepte fondos de terceros. El EA además tiene un mínimo en el tramo junior.

**Tramos.** Senior y junior, con un ratio máximo de apalancamiento. Ejemplo de la documentación: 4:1 significa al menos 20% junior y como máximo 80% senior; mientras los defaults no superen el 20%, el principal senior queda cubierto. Hay dos modos de rendimiento: senior fijo, o ajustado por riesgo (una parte del rendimiento senior pasa al junior).

**First loss cover.**

- Cubre pérdidas antes de que lleguen a los inversores.
- Orden de uso: colateral extra del prestatario, seguro y fondo de reserva del Pool Owner y el EA.
- Cobertura típica entre 2% y 10%.
- Hasta alcanzar el máximo, el rendimiento de la cobertura y las comisiones de los administradores se reinvierten en ella.
- Las recuperaciones vuelven en orden inverso: senior, junior y por último la cobertura.

**Rescates.** Se agrupan por época, alineada con el período de pago. Primero se atiende el senior sin romper el ratio máximo, a prorrata, y lo no cubierto pasa a la época siguiente.

**Inversores.** Todos los pools son permisionados. El inversor pasa KYC/KYB y acreditación (con Securitize), firma los documentos que define el Pool Owner (cuestionario del inversor, lender agreement) y es aprobado por el Pool Owner o los Operators.

**Contratos.** Los acuerdos legales se firman fuera de la blockchain. Los smart contracts ejecutan límites, plazos, tasas y la distribución de pérdidas. Declarar un default en el protocolo no equivale a ejecutar judicialmente una factura.

### 5.2 Polytrade Finance [V]

- Flujo: originar (el prestatario sube facturas, órdenes de compra y documentos de envío), suscripción asistida por IA con puntaje de riesgo y term sheet, sindicación (las cuentas por cobrar aprobadas se tokenizan como participaciones ERC-6960) y verificación y liquidación (documentos de envío y avisos bancarios; el repago vuelve por un vault on-chain).
- Senior on-chain a través de un marketplace, con solo conectar una wallet. Junior de primera pérdida, reservado a prestamistas registrados.
- El senior se respalda en TRADE, el token de Polytrade, por el doble de su valor, con reservas publicadas on-chain en Polygon.
- Es su propuesta publicada. No confirma que acepte facturas argentinas ni que ofrezca una API para MidatoPay.

### 5.3 Encaje para MidatoPay [S]

| Objetivo | Referencia |
|---|---|
| Un comercio sube una factura y pide anticiparla | Flujo de Polytrade, centrado en documentos |
| Agrupar comercios y financiar una cartera | Pools y tramos de Huma Institutional |
| Fraccionar facturas para inversores | ERC-6960 de Polytrade (bloqueado por ARC-RULES y CNV, ver 6.4) |
| Liquidez para liquidaciones y pagos | Huma |

Huma y Polytrade son referencias de estructura y posibles infraestructuras. Para usarlos como fuente de capital hay que preguntarles por la elegibilidad de empresas argentinas y facturas en ARS, la moneda del adelanto y del repago, quién asume el riesgo ARS/USDC, quién evalúa al deudor y cobra, la cesión, los tickets mínimos, los costos, el acceso por API y las redes soportadas (MidatoPay opera solo en Arc).

### 5.4 Modelos de fondeo

| Modelo | Cómo funciona | A favor | En contra |
|---|---|---|---|
| A. Por factura | El comercio presenta la factura, se aprueba y recién ahí un inversor la compra | Sin capital ocioso, precio por riesgo individual, contrato simple con un factor identificado | Tiempo de fondeo incierto, peor experiencia, más operación por factura, riesgo de agregación de emisiones en oferta privada (6.4) |
| B. Pool prefondeado | Los inversores depositan antes; el pool publica advance rate y tasa de descuento por categoría de riesgo, y desembolsa al aprobar | Adelanto inmediato, escala, precio conocido de antemano | Capital ocioso que reduce el rendimiento, exige política de crédito sólida, encuadre regulatorio más exigente (captación, valor negociable) y custodia |
| C. Híbrido | Un inversor ancla compromete una línea que se usa a demanda, más un pool chico prefondeado para las facturas que cumplen criterios automáticos | Valida la operación sin capital ocioso grande y deja la experiencia lista para escalar | Dos circuitos para operar y documentar |

**Recomendación del análisis previo [S]:** validar las primeras operaciones con un inversor ancla, por factura o con línea comprometida (A o C), y después mantener un pool pequeño prefondeado (B). Fondear un pool privado y tokenizar sus participaciones son dos decisiones regulatorias separadas.

### 5.5 Economía de una operación (ejemplo ilustrativo) [P]

El ejemplo completo a 30, 60 y 90 días en pesos y en dólares, con tasas de referencia de noviembre de 2026, el lado del inversor y del pool con tramos, está en `EJEMPLO_FINANCIERO.md`. El ejemplo de abajo usa otra convención (tasa mensual sobre el anticipo con aforo) y solo muestra la mecánica.

Fórmulas:

- `anticipo = nominal × advance_rate`
- `descuento = anticipo × tasa_mensual × días / 30`
- `comisión = nominal × fee_rate`
- Al cobrar el nominal: el financiador recupera `anticipo + descuento`, MidatoPay cobra la comisión, y el remanente (aforo) vuelve al comercio.

Ejemplo con cifras ficticias: factura de ARS 1.000.000 a 60 días, advance rate 85%, tasa de descuento 4% mensual y comisión 1%.

| Concepto | ARS |
|---|---|
| Anticipo | 850.000 |
| Descuento (850.000 × 4% × 2) | 68.000 |
| Comisión MidatoPay | 10.000 |
| Cobro del nominal | 1.000.000 |
| El financiador recupera | 918.000 |
| Remanente para el comercio | 72.000 |
| Costo total para el comercio | 78.000 sobre 850.000 anticipados durante 60 días |

**Riesgo cambiario.** Si la factura es en ARS y el pool fondea en USDC, una devaluación durante el plazo es pérdida del pool salvo que se cubra. Las opciones están en FD-09. El repo ya tiene un feed USD/ARS de Chainlink (`src/priceFeed.js`) para la cotización del momento, pero no resuelve el riesgo durante el plazo.

### 5.6 Roles propuestos para MidatoPay [P]

| Rol Huma | Equivalente propuesto | Nota |
|---|---|---|
| Pool Owner | MidatoPay o el vehículo (fiduciario) | Depende de la estructura legal (6.4) |
| Evaluation Agent | Comité de crédito de MidatoPay con reglas automáticas | Debería aportar capital propio a la primera pérdida |
| Pool Operators | Operaciones y Cumplimiento | KYC/KYB de inversores y comercios |
| Lenders | Inversor ancla, luego inversores calificados | Límites de oferta privada (6.4) |
| Borrower | Comercio (factoreado) | Necesita CUIT verificado y KYB |
| Sin equivalente en Huma | Deudor cedido (cliente del comercio) | Paga la factura. Su riesgo es el riesgo principal |

### 5.7 Procedimientos operativos [P]

| Paso | Qué ocurre | Responsable | Registro |
|---|---|---|---|
| 1. Alta del comercio | KYB, CUIT verificado, firma del contrato marco de factoraje | Cumplimiento | Expediente KYB, contrato firmado |
| 2. Presentación | Carga de la factura, lectura y constatación ARCA (Fase 1) | Comercio + sistema | `invoices`, verificaciones |
| 3. Elegibilidad | Tipo de comprobante admitido, no FCE (o circuito FCE), plazo, monto, límites por comercio y por deudor, concentración | Sistema + EA | Decisión con motivo |
| 4. Evaluación | Riesgo del deudor y del comercio, historial, conformidad del deudor si aplica | EA | Puntaje y términos |
| 5. Oferta | Advance rate, tasa, comisión, aforo, con o sin recurso. El comercio acepta | Sistema + comercio | Anexo por factura firmado |
| 6. Cesión | Notificación fehaciente al deudor con instrucción de pago | Operaciones | Constancia de notificación |
| 7. Re-constatación | Nueva consulta WSCDC inmediatamente antes de desembolsar | Sistema | Verificación con fecha |
| 8. Desembolso | USDC al wallet del comercio (8.10) | Financiador / sistema | Tx en Arc, memo opaco |
| 9. Seguimiento | Vencimientos, recordatorios, notas de crédito posteriores | Operaciones | Alertas |
| 10. Cobro | El deudor paga al factor. Conversión si corresponde. Distribución: financiador, comisión, remanente | Operaciones + sistema | Conciliación |
| 11. Mora y default | Período de gracia, gestión de cobro, recurso contra el comercio si se pactó, declaración de pérdida | EA + legal | Incidente y pérdida asignada por tramos |

## 6. Marco legal y regulatorio argentino

Hay tres capas que se resuelven por separado: cómo se adquiere el crédito, cómo se capta a los inversores y qué representa un token. Inscribirse como PSAV o usar un smart contract no habilita por sí solo el negocio.

### 6.1 Qué representa un token

| Diseño | Encuadre a analizar | Consecuencia |
|---|---|---|
| Registro digital interno de una factura | Contrato de factoraje o cesión | El registro no reemplaza la transmisión jurídica |
| Token de un crédito individual | Naturaleza del derecho, emisión, circulación y oferta | No asumir que se puede vender libremente |
| Token de participación en un pool | Posible valor negociable o contrato de inversión (Ley 26.831, art. 2) **[S]** | Régimen de oferta pública o privada |
| Token de un título de fideicomiso financiero autorizado | Representación digital bajo CNV | Vía regulada para una cartera |

Un token transferible que da participación en el rendimiento de un pool exige analizar el encuadre de valor negociable, aunque se lo llame NFT, recibo o token de utilidad **[S]**.

### 6.2 Adquisición de la factura común: factoraje y cesión

- **Código Civil y Comercial, arts. 1421 a 1428 (factoraje).** El factor se obliga a adquirir por un precio los créditos del giro comercial del factoreado, y puede anticipar fondos asumiendo o no el riesgo **[S, texto del art. 1421 confirmado en una reproducción no oficial]**. El contrato debe identificar los créditos, sus importes, fechas de emisión y vencimiento; admite aforos; la transmisión se notifica al deudor **[S]**.
- **Arts. 1620 a 1623 (cesión):** eficacia frente a terceros desde la notificación al deudor cedido por instrumento público o privado de fecha cierta, preferencia entre cesionarios sucesivos y efectos ante el concurso o la quiebra del cedente **[S]**. Es la base para prevenir el doble financiamiento.
- **Consecuencia para el producto:** leer el QR o constatar el CAE no cede nada. Hace falta un contrato marco, un anexo por factura y la notificación al deudor.

### 6.3 Factura de Crédito Electrónica MiPyME (Ley 27.440)

- Tiene un régimen específico, un registro propio y efectos de título ejecutivo **[S]**.
- Art. 12: negociación en mercados autorizados por la CNV **[S]**. La CNV reglamentó su negociación con la RG 780/2019 **[S]**.
- Art. 13: permite plataformas de factoraje, cesión o descuento sin autorización como mercado, si los compradores son exclusivamente entidades financieras o proveedores no financieros de crédito **[S]**. **Esa excepción no se traslada a un pool abierto de inversores DeFi.**
- Circula por Agente de Depósito Colectivo o por el Sistema de Circulación Abierta **[S]**.
- **Consecuencia:** la FCE y la factura común no son instrumentos equivalentes en la app (FD-07).

### 6.4 Captación de inversores y tokenización (CNV)

**Oferta privada, RG CNV 1088/2025 (Normas CNV, Título XX, Cap. I, vigente desde el 25/10/2025) [V]:**

- Potenciales inversores por emisión: ilimitados si son entidades financieras, proveedores no financieros de crédito, agentes habilitados, SGR o aseguradoras; hasta 50 inversores calificados más y hasta 30 no calificados.
- Adquirentes por emisión: hasta 35, de los cuales como máximo 15 no calificados.
- Las emisiones dentro de 3 meses se suman como una sola. En fideicomisos financieros, el fiduciante cuenta como emisor.
- Difusión: reuniones promocionales de hasta 50 potenciales inversores a la vez. Prohibidas la publicidad web dirigida a residentes, la publicidad en medios y las invitaciones masivas automatizadas (mails, redes, listas).
- Reventa: no se puede transferir a calificados por 3 meses ni a no calificados por 6 meses, salvo transferencias fuera del país.
- La documentación de venta debe informar la restricción de transferencia y que la oferta no está autorizada por la CNV.
- **Consecuencias:** poner contraseña a una página o dividir emisiones no alcanza. En el modelo A, cada factura vendida a inversores podría contar como emisión y agregarse.

**Tokenización:**

- RG 1069/2025 (13/06/2025): representación digital de títulos de fideicomisos financieros y cuotapartes de fondos cerrados con oferta pública **[S]**.
- RG 1081/2025 (20/08/2025): amplió a acciones, obligaciones negociables y CEDEAR **[S]**.
- RG 1150/2026: amplió a valores con autorización automática y prorrogó el sandbox hasta el 31/12/2027 **[S]**, según varias fuentes coincidentes. También se cita la RG 1087 **[S]**.
- El PSAV interviniente debe estar inscripto en todas las categorías **[S]**.

**Vía a evaluar [P]:** cartera de créditos → fideicomiso financiero → títulos de deuda senior y certificados de participación subordinados → representación digital autorizada. Es una propuesta de estructura, no una autorización existente.

### 6.5 Intermediación financiera y crédito

- **Ley 21.526 de Entidades Financieras [S]:** recibir fondos del público y prestarlos habitualmente puede encuadrar como intermediación financiera no autorizada. Que el aporte sea en USDC no lo descarta.
- **Proveedores No Financieros de Crédito (BCRA) [S]:** quien financie habitualmente debe evaluar su inscripción y régimen informativo. No atribuir ese rol a MidatoPay de forma automática: depende de quién es el financiador real.

### 6.6 BCRA: proveedores de servicios de pago

- Desde 2023 los PSPCP no pueden realizar ni facilitar a sus clientes operaciones con activos digitales no regulados por la autoridad nacional competente y autorizados por el BCRA **[S]**. El análisis previo ubica esa prohibición en el punto 4.6 del texto ordenado vigente al 04/11/2026 **[S]**.
- La Com. "A" 8432/2026 (06/05/2026) incorporó al "PSPCP como Servicio": el PSPCP ofrece cuentas a clientes de un tercero que las usan desde la interfaz de ese tercero **[S]**. El tercero tomador debe informar a sus clientes qué PSP provee la cuenta, y sus procesos e interfaces deben respetar las obligaciones del servicio **[S]**.
- **Consecuencia:** convertir saldos de cuentas de pago a USDC para invertir en pools no puede darse por habilitado. Registrar un PSAV no autoriza los activos ni levanta esa restricción. Hay que validarlo con el proveedor de cuentas (¿21 Millions?, ver sección 2) y con abogados.

### 6.7 PSAV y prevención de lavado

- **RG CNV 1058/2025 [S]:** régimen de PSAV para intercambio, transferencia, custodia y servicios vinculados con ofertas de activos virtuales. El encuadre depende de las funciones efectivamente prestadas. PSAV, fiduciario y agente de mercado son roles distintos.
- **UIF Res. 49/2024 [S]:** sujetos obligados PSAV.
- **UIF Res. 200/2024 (19/12/2024) [S]:** emisores de tarjetas, operadores y proveedores de servicios de cobros y/o pagos, y proveedores no financieros de crédito. Exige, según el sujeto, identificación del cliente y del beneficiario final, origen de fondos, monitoreo y reportes.
- **Datos personales (Ley 25.326) [S]:** las facturas incluyen datos del receptor (DNI o CUIT). Definir la base legal, la retención y el acceso (FD-15).

### 6.8 Paquete contractual propuesto [P]

| Documento | Qué resuelve |
|---|---|
| Contrato del vehículo o pool | Patrimonio, administración, tramos y distribución de pérdidas |
| Acuerdo de inversión | Derechos del inversor, rendimiento objetivo, rescates y restricciones de transferencia |
| Contrato marco de factoraje | Relación con el comercio: anticipos, descuentos, aforo, garantías, recurso |
| Anexo por factura | Crédito adquirido, importe, precio, vencimiento e identificador interno |
| Notificación de la cesión | Eficacia frente al deudor y terceros |
| Acuerdo de cobranza y recupero | Quién cobra, concilia y actúa ante la mora |
| Condiciones del token (solo Fase 4) | Qué derecho representa y cómo se vincula con los documentos legales |

Para cada operación debe poder responderse: quién debe pagar, quién tiene derecho a reclamar, qué documento lo acredita y quién actúa si el pago no llega.

### 6.9 Preguntas para el dictamen legal

1. ¿Quién compra el crédito: MidatoPay, el inversor ancla o un fiduciario?
2. ¿Contra quién reclama el inversor, y qué pasa ante el incumplimiento del deudor o la insolvencia del comercio o de MidatoPay?
3. ¿Cómo se ordenan los tramos y la reserva, y quién es titular del respaldo?
4. ¿Oferta privada u oferta pública, y con qué límites de transferencia?
5. ¿En qué moneda se fondea, se desembolsa y se repaga? ¿Cómo se cubre el riesgo ARS/USDC y cuál es el tratamiento cambiario?
6. ¿Qué rol regulatorio tiene cada parte: MidatoPay, el PSP proveedor de cuentas, el financiador, el fiduciario, el PSAV y los agentes?
7. ¿El circuito puede operar sin que el PSPCP "facilite" operaciones con activos digitales?
8. ¿Cómo se trata la FCE MiPyME frente a la factura común?

## 7. Competencia y referencias

| Actor | Tipo | Relevancia |
|---|---|---|
| Huma Finance (Institutional) **[V]** | PayFi y crédito privado on-chain | Modelo de pools, roles, tramos y first loss a replicar |
| Polytrade Finance **[V]** | Financiamiento comercial con tokenización ERC-6960 | Flujo documental por factura y suscripción con IA |
| Centrifuge **[S]** | Pools multi-tramo de activos reales | Referencia de tramos junior/senior |
| Goldfinch **[S]** | Crédito on-chain con backers de primera pérdida | Referencia de capital de primera pérdida |
| AmFi **[S]** | Pools con junior aportado por el originador (5% a 25%) | Referencia de subordinación exigida al originador |
| invoition, invoitrade, bill.com.ar **[S]** | Plataformas argentinas de negociación de FCE (citadas en 2021) | Competencia local directa en FCE. Verificar vigencia y oferta actual |
| Bancos, SGR y mercados (descuento de cheques y eCheq) | Financiamiento PyME tradicional | Sustituto principal en Argentina. Fija la referencia de tasa |

Diferencial posible de MidatoPay [P]: el comercio ya cobra con MidatoPay (QR, Mercado Pago, USDC en Arc). Ese historial de cobros sirve como dato para la suscripción, y el adelanto llega como USDC al mismo wallet.

**Pendiente:** un relevamiento actualizado de competidores argentinos, con tasas y requisitos.

## 8. Diseño técnico sobre el código actual

### 8.1 Convenciones a respetar

- **Endpoints v1:** `export function createXHandler(adapters={})` y `export const handler=createXHandler()`. Plantilla: `netlify/functions/merchant-profile.js`.
- **Orden dentro del handler:** autenticar con `authenticatePayment(event)` antes de tocar DB, env, ARCA o RPC; validar el método (405); parsear JSON (`invalid_json`, 400); validar campos sin aceptar claves extra.
- **Errores:** `PaymentError(code, status)` con códigos en snake_case. Respuestas con `json()` y `errorResponse()` de `lib/paymentRuntime.js`. Toda query filtra por `user_id`, y el cliente nunca envía su `user_id`.
- **Registro de la Function:** redirects `/<nombre>` y `/<nombre>/*` en `netlify.toml`, antes del catch-all de la SPA. Agregar el nombre a la lista de `scripts/check-functions.js`: sin token debe responder 400, 401, 403 o 405.
- **Migraciones:** `db/migrations/YYYYMMDD_descripcion.sql` con `BEGIN; … COMMIT;` y DDL idempotente (`IF NOT EXISTS`). Agregar el archivo a la lista de `scripts/migrate-payments.js` y las tablas a `netlify/functions/lib/paymentDatabase.js`. **No aplicarla sin pedido explícito.**
- **Tests:** `node:test` con PGlite, adapters inyectados y sin red. Aplicar la migración dos veces para probar que es idempotente. Patrón en `test/merchant-profile.test.js` y `test/transfers.test.js`.
- **UI:** casi todo en `src/App.jsx`. Navegación con `const [tab,setTab]=useState("home")` (línea 2750). Pantallas extraídas en archivos propios con estilos inline y un objeto `C` de colores local. Ver `.agents/skills/frontend-assistant/SKILL.md`.
- **i18n:** claves en `en` y `es` de `src/i18n.jsx`. `zh` cae a `en`.
- **Verificación:** `npm test`, `npm run build` y `npm run functions:check`. No hay lint. Un solo archivo de tests: `node --test test/<archivo>.test.js`.

### 8.2 Piezas nuevas de la Fase 1 [P]

| Pieza | Ubicación | Notas |
|---|---|---|
| Parser y validador del QR fiscal | `src/invoiceQr.js` | Puro y sin dependencias. Lo usan cliente y servidor. Lista cerrada de hosts y path `/fe/qr/`. Base64 tolerante a la variante URL-safe. Validación estricta de 3.2 |
| Lectura del archivo en el navegador | `src/invoiceFile.js` | Imagen → canvas → `BarcodeDetector`/`jsQR`. PDF → render con `pdfjs-dist` (dependencia nueva, FD-06) |
| Cliente WSAA + WSCDC | `netlify/functions/lib/arcaWscdc.js` | `request` inyectable. Firma CMS (FD-04). Cache persistente del TA |
| Flag de acceso | `netlify/functions/lib/factoringAccess.js` | Copia de `lib/transferAccess.js`: `FACTORING_ENABLED` y `FACTORING_ALLOWED_USER_IDS` |
| Endpoint | `netlify/functions/invoices.js` | Routing por regex sobre `event.path`, como `transfers.js` |
| Worker de constatación | `netlify/functions/invoices-dispatch.js` (schedule) + `invoices-worker-background.js` | Agregar el nombre a la allowlist de `kickWorker` (`lib/paymentRuntime.js`, línea 100). Validar con `internalAuthorized`. Lock `pg_try_advisory_lock` por factura y backoff con `attempts` / `next_attempt_at` / `last_error` |
| Migración | `db/migrations/YYYYMMDD_invoices.sql` | Ver 8.3 |
| Hook y pantalla | `src/invoices.js`, `src/InvoicesScreen.jsx` | Token Bearer de Privy como `src/merchantProfile.js`. Nuevo `tab==="invoices"` con entrada desde Perfil o Inicio |
| Tests | `test/invoice-qr.test.js`, `test/invoices.test.js`, `test/arca-wscdc.test.js` | Parser con casos válidos e inválidos. Endpoint con PGlite (auth previa, aislamiento por usuario, duplicados). WSCDC con respuestas SOAP de ejemplo |

### 8.3 Modelo de datos (borrador) [P]

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('qr','manual')),
  issuer_cuit text NOT NULL CHECK (issuer_cuit ~ '^[0-9]{11}$'),
  cbte_tipo integer NOT NULL,
  pto_vta integer NOT NULL CHECK (pto_vta BETWEEN 1 AND 99999),
  cbte_nro bigint NOT NULL CHECK (cbte_nro BETWEEN 1 AND 99999999),
  issued_on date NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  currency text NOT NULL,            -- código ARCA: PES, DOL, ...
  fx_rate numeric,                   -- ctz del QR
  receiver_doc_type integer,
  receiver_doc_number text,
  auth_mode text CHECK (auth_mode IN ('CAE','CAEA')),
  auth_code text CHECK (auth_code ~ '^[0-9]{14}$'),
  qr_payload jsonb,                  -- JSON decodificado tal como vino
  is_fce boolean NOT NULL DEFAULT false,
  due_on date,                       -- vencimiento comercial, carga manual
  extraction_status text NOT NULL CHECK (extraction_status IN ('extracted','needs_review','confirmed')),
  arca_status text NOT NULL DEFAULT 'pending'
    CHECK (arca_status IN ('pending','authorized','observed','rejected','error')),
  arca_checked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, issuer_cuit, cbte_tipo, pto_vta, cbte_nro)
);

CREATE TABLE IF NOT EXISTS invoice_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  user_id text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL,         -- FD-03
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sha256)
);

-- Registro que solo crece: una fila por consulta a ARCA.
CREATE TABLE IF NOT EXISTS invoice_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  service text NOT NULL CHECK (service = 'wscdc'),
  arca_environment text NOT NULL CHECK (arca_environment IN ('homologacion','produccion')),
  result text,                       -- Resultado: A / R
  observations jsonb,
  errors jsonb,
  events jsonb,
  processed_at text,                 -- FchProceso tal como lo devuelve ARCA
  requested_at timestamptz NOT NULL DEFAULT now()
);

-- Ticket de acceso de WSAA compartido entre Functions. token y sign son credenciales de corta vida.
CREATE TABLE IF NOT EXISTS arca_access_tickets (
  service text NOT NULL,
  arca_environment text NOT NULL,
  cuit text NOT NULL,
  token text NOT NULL,
  sign text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (service, arca_environment, cuit)
);

COMMIT;
```

Para la Fase 2 se agregan [P]:

- `merchant_tax_profiles`: CUIT del comercio, fuente y fecha de verificación (FD-02).
- `advance_requests`: factura, términos ofrecidos (advance rate, tasa y comisión en bps), estado, financiador y decisión con motivo. Índice único parcial sobre la clave del comprobante mientras el adelanto esté activo (4.1).
- `advances`: desembolso on-chain con el mismo esquema de columnas de `charges` (`idempotency_key UNIQUE`, `tx_hash UNIQUE`, `signed_tx`, `nonce`, `status`, `attempts`, `next_attempt_at`, `last_error`), más incidencias de revisión manual.
- `transactions.advance_id`, con FK e índice único parcial, igual que `charge_id` y `transfer_id`.

### 8.4 Endpoints (borrador) [P]

| Método y ruta | Uso |
|---|---|
| `GET /invoices` | Lista del comercio, con indicadores de lectura y de ARCA. Incluye `enabled` según el flag |
| `GET /invoices/:id` | Detalle con historial de verificaciones |
| `POST /invoices` | Alta: payload del QR o campos manuales, más el archivo en base64 dentro del JSON. Exige el header `Idempotency-Key` (UUIDv4, como `transfers`) |
| `PATCH /invoices/:id` | Corrección y confirmación en "Requiere revisión", y carga de `due_on` |
| `POST /invoices/:id/verify` | Re-constatación a pedido, con límite de frecuencia |

**Subida de archivos:**

- Usar una Function v1, que recibe el body en base64. `netlify/functions/lib/fetchAdapter.js` (v2) lee `request.text()` y corrompe los binarios.
- El límite de payload de las Functions síncronas de Netlify es de alrededor de 6 MB **[S]**. Con el overhead de base64, limitar el archivo a unos 4 MB y validarlo en cliente y servidor.
- Verificar en el servidor el tipo real por magic bytes (`%PDF`, JPEG `FF D8 FF`, PNG `89 50 4E 47`), no solo el `Content-Type`.

### 8.5 ARCA: configuración [P]

Variables nuevas, solo server-side. Documentarlas en `.env.example` y `.env.production.example`:

| Variable | Contenido |
|---|---|
| `ARCA_ENVIRONMENT` | `homologacion` o `produccion` |
| `ARCA_CUIT` | CUIT de MidatoPay que consulta |
| `ARCA_CERTIFICATE` | Certificado X.509 en PEM, con `\n` escapados como `AIVEN_PG_CA_CERT` |
| `ARCA_PRIVATE_KEY` | Clave privada en PEM. El nombre contiene `PRIVATE_KEY` para que `scripts/public-env-policy.js` rechace una versión `VITE_` accidental |

ARCA tiene su propio ambiente de homologación, que no depende de la red Arc. En desarrollo, el código puede apuntar a homologación de ARCA y seguir sobre Arc Mainnet, porque la Fase 1 no mueve dinero.

El cliente WSCDC mapea `Resultado` y `Observaciones` a `arca_status`:

- `A` sin observaciones → `authorized`.
- `A` con observaciones → `observed`.
- `R` → `rejected`.
- Fallas de red, SOAP o WSAA → `error`, con reintento.

Nunca loguear `token`, `sign`, el certificado ni el XML completo.

### 8.6 Flag y despliegue

La funcionalidad queda oculta detrás de `FACTORING_ENABLED` / `FACTORING_ALLOWED_USER_IDS`. El endpoint devuelve `enabled` y el cliente oculta la entrada si es `false`, igual que `GET /transfers`.

### 8.7 Desembolsos y pools (Fases 2 a 4): restricciones del repo

| Tema | Restricción actual | Implicancia |
|---|---|---|
| Firma de desembolsos | `TREASURY_SECRET_KEY` está dedicada a Mercado Pago. `nextTreasuryNonce` (`lib/paymentWorker.js`, línea 11) solo mira `charges`. `docs/MERCADOPAGO_PRODUCCION.md` pide una tesorería exclusiva | Usar una clave aparte (por ejemplo `FACTORING_POOL_SECRET_KEY`) o extender nonces y reservas de liquidez a la tabla `advances` |
| Patrón de desembolso | `settlePayout`, `followPayout` y `finalizeDelivery` en `lib/paymentWorker.js` | Replicarlo: nonce bajo `pg_advisory_lock`, persistir antes de difundir, re-difundir bytes idénticos, verificar con `usdcTransfers` del receipt y revisión manual |
| Memo | Sin datos personales on-chain | `armarMemo({inv:'adv_<uuid>', kind:'factoring_advance', usdc})`. Sin CUIT, número de factura ni razón social |
| Historial | `transactions` con `UNIQUE(user_id, network, hash)` | `kind='factoring_advance'` y `advance_id` |
| Capital de inversores | ARC-RULES prohíbe servicios de custodia | Una wallet de MidatoPay que reciba USDC de inversores es custodia. Ver FD-12 |
| Pool on-chain o tokens | ARC-RULES prohíbe contratos propios y token propio | Un vault de tramos o un token ERC-6960 requiere cambiar ARC-RULES de forma explícita, auditar y tener una estructura CNV aprobada (Fase 4) |

**Opciones para la Fase 2 sin custodia [P]:**

1. El inversor ancla es el factor legal y desembolsa desde su propia wallet. MidatoPay origina, verifica, prepara la transacción y registra.
2. El capital queda en un vehículo con fiduciario, y MidatoPay solo instruye.
3. Usar un protocolo externo (por ejemplo Huma) con MidatoPay como originador o EA. Requiere confirmar que opera en Arc o decidir una excepción a la regla de red.

## 9. Plan por fases y criterios de aceptación [P]

| Fase | Contenido | Requisitos previos | Criterio de cierre |
|---|---|---|---|
| 0. Decisiones | Dictamen legal (6.9), FD-01 a FD-06, certificado y CUIT para WSCDC en homologación | Ninguno | Decisiones registradas en la sección 10 |
| 1. Carga y constatación | 8.2 a 8.6, sin dinero | FD-03, FD-04, FD-05, FD-06 | Un comercio habilitado sube una factura real de homologación y ve los dos indicadores. Duplicados rechazados. ARCA caído no rompe la carga. Tests, build y `functions:check` en verde |
| 1b. Lectura del contenido | Texto del PDF u OCR y cruce con el QR | FD-06 | Discrepancias de CUIT, número, fecha o total mandan a revisión |
| 2. Adelanto con inversor ancla | KYB y CUIT del comercio, solicitud, oferta, contrato y anexo, notificación al deudor, re-constatación, desembolso USDC, seguimiento y cobro | Dictamen favorable, FD-08 a FD-12 y FD-14, contratos firmados | Ciclo completo con una factura real: desembolso verificado por receipt, cobro conciliado y remanente devuelto |
| 3. Pool prefondeado | Tramos, first loss, política de elegibilidad, rescates por época y onboarding de inversores (KYC/KYB) | Estructura legal del vehículo, FD-12 resuelta | Contabilidad de tramos conciliada contra los saldos on-chain |
| 4. Tokenización | Representación digital de participaciones | Autorización CNV y cambio explícito de ARC-RULES | Fuera de alcance hasta entonces |

**Primer trabajo sugerido para el próximo modelo.** `src/invoiceQr.js` más `test/invoice-qr.test.js`. No necesita decisiones abiertas, dependencias nuevas, migraciones ni secretos. Después, la migración como archivo (sin aplicarla) y el endpoint con PGlite detrás del flag.

## 10. Decisiones abiertas

| ID | Decisión | Propuesta inicial | Responsable sugerido |
|---|---|---|---|
| FD-01 | ¿Facturas emitidas por el comercio (cuentas por cobrar) o también recibidas? | Solo emitidas para factoring. Las recibidas solo como constatación | Producto |
| FD-02 | Verificación del CUIT del comercio | KYB del proveedor de cuentas (¿21 Millions?) o constancia de ARCA | Cumplimiento + Ingeniería |
| FD-03 | Almacenamiento del archivo original y retención | Netlify Blobs (dependencia nueva `@netlify/blobs`), Postgres `bytea` o S3 | Ingeniería + Legal |
| FD-04 | Firma CMS para WSAA | `node-forge` o `pkijs` (dependencia nueva) frente a un servicio tercero (por ejemplo Afip SDK, que implica compartir el certificado) | Ingeniería |
| FD-05 | CUIT, certificado y alta del servicio `wscdc` de MidatoPay | Tramitar primero en homologación | Administración + Ingeniería |
| FD-06 | Lectura de PDF y OCR | `pdfjs-dist` en el cliente para el QR. Para el contenido: texto del PDF, OCR o un modelo de visión server-side (ya existe `ANTHROPIC_API_KEY`), con evaluación de privacidad | Ingeniería + Legal |
| FD-07 | Tratamiento de la FCE MiPyME | Fase 1: cargar y constatar con marca `is_fce`. No apta para el circuito de cesión común | Legal |
| FD-08 | Modelo de fondeo inicial e inversor ancla | Modelo A o C con un inversor identificado | CEO + CFO + CBO |
| FD-09 | Moneda del anticipo y del repago, y riesgo ARS/USDC | Opciones: el pool asume y lo cobra en la tasa; solo facturas en `DOL`; repago indexado a USD; pool en ARS | CFO + Legal |
| FD-10 | Con o sin recurso, aforo y cobranza | Con recurso en las primeras operaciones; cobranza notificada al deudor | CFO + Legal |
| FD-11 | Canal de cobro en ARS y conversión a USDC | Validar con el PSP (sección 6.6) | CFO + Legal + proveedor |
| FD-12 | Custodia del capital y del desembolso | Factor con wallet propia (8.7, opción 1) | CEO + Legal + Ingeniería |
| FD-13 | Contratos y tokens on-chain | Fuera de alcance hasta tener la estructura CNV. Requiere cambiar ARC-RULES | CEO + Legal |
| FD-14 | Política de crédito | Tipos admitidos, plazo máximo, montos, límites por comercio y por deudor, concentración | EA / CFO |
| FD-15 | Datos personales del receptor | Minimizar: guardar solo lo necesario para constatar y cobrar. Definir retención | Legal |
| FD-16 | Pricing | Advance rate, tasa de descuento y comisión por categoría de riesgo | CFO |
| FD-17 | Hosts admitidos en el QR | `www.afip.gob.ar`, `afip.gob.ar`, `www.arca.gob.ar`, `arca.gob.ar`, `serviciosweb.afip.gob.ar`, con path `/fe/qr/`. Confirmar con QRs reales | Ingeniería |

## 11. Riesgos principales

- **Factura apócrifa con QR bien formado.** Se mitiga con WSCDC.
- **Factura auténtica sin operación real** (facturas de favor o venta inexistente). Se mitiga con la conformidad del deudor, el historial de cobros del comercio y límites por deudor.
- **Nota de crédito posterior** que reduce o anula la factura financiada. WSCDC no lo informa. Se mitiga con la notificación de la cesión, cláusulas del contrato marco y re-constatación antes del desembolso.
- **Doble financiamiento fuera de MidatoPay.** Se mitiga con la notificación fehaciente y la prioridad del primer cesionario notificado (6.2).
- **Devaluación ARS/USDC durante el plazo** (FD-09).
- **Concentración en pocos deudores.**
- **Regulatorio:** oferta pública irregular, intermediación no autorizada, restricción de los PSPCP sobre activos digitales y custodia sin encuadre.
- **Operativo:** ARCA o WSAA no disponibles, vencimiento del certificado, TA no cacheado.
- **Privacidad:** datos del receptor en archivos y en la base.

## 12. Glosario

- **CAE / CAEA:** código de autorización electrónico, anticipado en el caso del CAEA.
- **WSAA:** servicio de autenticación de los web services de ARCA. Emite el TA (ticket de acceso: `token` + `sign`).
- **WSCDC:** web service de Constatación de Comprobantes.
- **WSFEv1:** web service de Factura Electrónica.
- **FCE MiPyME:** Factura de Crédito Electrónica MiPyME (Ley 27.440).
- **ADC / SCA:** Agente de Depósito Colectivo y Sistema de Circulación Abierta, los circuitos de circulación de la FCE.
- **Factor / factoreado / deudor cedido:** quien compra el crédito, quien lo vende y quien debe pagarlo.
- **Advance rate:** porcentaje del nominal que se anticipa.
- **Aforo:** diferencia entre el nominal y el anticipo, que protege al factor y vuelve al comercio al cobrar.
- **Con / sin recurso:** si el comercio responde o no ante el impago del deudor.
- **Tramo senior / junior:** capas de capital con distinta prioridad de cobro y de pérdida.
- **First loss cover:** capital que absorbe pérdidas antes que los inversores.
- **Evaluation Agent (EA):** quien aprueba créditos y facturas y declara defaults.
- **Época (epoch):** período en el que se procesan los rescates.
- **PSAV:** Proveedor de Servicios de Activos Virtuales (CNV).
- **PSPCP:** Proveedor de Servicios de Pago que ofrece Cuentas de Pago (BCRA).
- **PNFC:** Proveedor No Financiero de Crédito (BCRA).
- **FF:** fideicomiso financiero.

## 13. Fuentes

Oficiales y primarias, consultadas el 09/11/2026:

- [ARCA: Código QR, conceptos generales](https://www.afip.gob.ar/fe/qr/) y [vigencia y aplicación de la RG 4892](https://afip.gob.ar/fe/qr/vigencia-y-aplicacion.asp)
- [ARCA WSCDC: operación ComprobanteConstatar](https://servicios1.afip.gov.ar/wscdc/service.asmx?op=ComprobanteConstatar)
- [ARCA: manual del desarrollador de Factura Electrónica (WSFEv1)](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf)
- [CNV Normas, Título XX, Cap. I, oferta privada (texto según RG 1088/2025)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/215000-219999/219405/texact-TituloXX-CapI.htm)
- [Huma Institutional: tipos de pool](https://docs.huma.finance/products/huma-institutional/introduction/pool-types.md), [roles](https://docs.huma.finance/products/huma-institutional/introduction/admin-roles.md), [P&L de tramos](https://docs.huma.finance/products/huma-institutional/tranches/pnl.md), [rescates](https://docs.huma.finance/products/huma-institutional/tranches/redemption.md), [first loss covers](https://docs.huma.finance/products/huma-institutional/first-loss-covers.md), [lenders](https://docs.huma.finance/products/huma-institutional/user-manuals/lenders.md) y [Evaluation Agent](https://docs.huma.finance/products/huma-institutional/user-manuals/pool-admins/evaluation-agent.md)
- [Polytrade Finance](https://finance.polytrade.app/) y [EIP-6960 Dual Layer Token](https://eips.ethereum.org/EIPS/eip-6960)

Secundarias, a confirmar contra el texto oficial:

- [Afip SDK: QR en Node.js](https://afipsdk.com/blog/crear-qr-de-afip-en-nodejs/) y [constatación de comprobantes](https://docs.afipsdk.com/siguientes-pasos/web-services/constatacion-de-comprobantes)
- [FactuARCA: lector de QR (RG 4892)](https://factuarca.app/herramientas/lector-qr-factura)
- [CCyC art. 1421](https://leyes-ar.com/codigo_civil_y_comercial/1421.htm)
- [Ley 27.440 (InfoLEG)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/310000-314999/310084/norma.htm) y [CNV: reglamentación de la FCE (RG 780)](https://www.cnv.gov.ar/SitioWeb/Prensa/Post/1300/1300reglamentacion-de-factura-de-credito-electronica-mipymes)
- [Allende & Brea: RG 1069/2025](https://allende.com/bancario/la-comision-nacional-de-valores-regula-la-tokenizacion-de-valores-negociables-06-25-2025/), [Barreiro: RG 1081/2025](https://www.bodlegal.com/la-cnv-amplia-el-regimen-de-tokenizacion/) y [El Observador: RG 1150](https://www.elobservador.com.uy/argentina/economia-y-negocios/la-cnv-amplio-el-regimen-tokenizacion-y-completo-el-bing-bang-regulatorio-n6047207)
- [Marval: Com. "A" 8432/2026, PSPCP como Servicio](https://www.marval.com/Publicacion/nueva-regulacion-sobre-proveedores-de-servicios-de-pago-17601)
- [Lexology: prohibición a PSPCP sobre activos digitales (2023)](https://www.lexology.com/library/detail.aspx?g=e1ccd6f7-8856-45c6-b827-21bee4752105)
- [Allende & Brea: UIF Res. 200/2024](https://allende.com/bancario/nueva-reglamentacion-de-la-uif-aplicable-a-proveedores-de-servicios-de-cobros-y-o-pagos-12-20-2024/)
- [Centrifuge: pools multi-tramo](https://docs.centrifuge.io/learn/multi-tranche-system/), [Goldfinch: borrower pools](https://docs.goldfinch.finance/goldfinch/goldfinch-v1/guides/participating-in-borrower-pools) y [AmFi: tramos](https://docs.amfi.finance/home/platform-mechanics/opportunities/amfi-pools/junior-and-senior-tranches)
- [Roadshow: plataformas fintech de FCE (2021)](https://www.roadshow.com.ar/facturas-de-credito-electronica-crecen-las-plataformas-fintech-para-financiar-a-las-pyme/)

El contenido de las fuentes se resumió y parafraseó para este documento.

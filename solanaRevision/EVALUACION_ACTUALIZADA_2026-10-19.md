# MidatoPay: evaluación actualizada

Fecha: 19 de octubre de 2026. Base local: commit `c62e550`, más el contenido presente del README y los documentos del workspace.

**Evaluación independiente estimada: 75/100. Referencia anterior: 66/100.**

MidatoPay presenta hoy una propuesta más clara y una implementación mejor respaldada: el cliente paga pesos mediante Mercado Pago y el comercio recibe USDC en Solana. La frescura de cotizaciones vuelve a estar controlada, el README está en inglés y la evidencia comercial incluye una carta de un supermercado. El siguiente salto depende de demostrar uso repetido por comercios, margen por operación y una operación de tesorería sostenible.

Esta revisión no constituye una nueva calificación de Superteam, Colosseum ni Solana Foundation. El [informe original](v4-2026-10-16.pdf), aunque incluye jurados y un panel de inversión simulados, se identifica como una guía preparada por Superteam Argentina que no reemplaza la evaluación oficial de Colosseum.

## Alcance y criterio de evidencia

Se contrastaron las 30 páginas del informe anterior con el [README](../README.md), [datosadicionales.md](../datosadicionales.md), código de cobros y transferencias, migraciones, pruebas, configuración de CI, documentación operativa y las dos cartas de `business-lois/`. Se inspeccionaron visualmente ambas cartas y se consultó en modo lectura la transacción mainnet enlazada en el README.

La existencia de código demuestra implementación. Una prueba automatizada demuestra el comportamiento cubierto por esa prueba. Una transferencia mainnet demuestra una operación on-chain. Una carta demuestra interés declarado. Para acreditar adopción hacen falta comercios identificados como externos al equipo, operaciones recurrentes y resultados del piloto.

No se verificaron una demo o un pitch nuevos, los formularios de postulación, perfiles del equipo, variables del despliegue, contratos con proveedores, rotación histórica de claves ni métricas privadas de producción. El sitio y los exploradores no entregaron contenido legible a la herramienta web; la comprobación on-chain se realizó directamente por RPC. Las observaciones sobre videos del informe anterior quedan **sin nueva verificación**.

## 1. Puntaje comparable con la devolución anterior

Se conservan pesos y escala de 0 a 4 del informe. Cálculo: suma de `peso × nota / 4`. Las notas representan mi juicio sobre la evidencia disponible.

| Dimensión | Peso | Antes | Ahora | Puntos actuales | Fundamento |
|---|---:|---:|---:|---:|---|
| Problema e insight | 20 | 3/4 | 3/4 | 15,00 | El problema del comercio está mejor expresado. Sigue faltando un caso medido que cuantifique el beneficio y el uso posterior del USDC. |
| Producto y ejecución | 25 | 3/4 | 3/4 | 18,75 | Hay mejoras de continuidad del cobro, recuperación y envíos patrocinados. El circuito real ya había sido reconocido; falta verificar la nueva demo y uso externo sostenido para llegar a 4. |
| Diferenciación y uso de Solana | 15 | 2/4 | 3/4 | 11,25 | Está mejor fundamentado el rol de USDC nativo, gas pagado por la plataforma y trazabilidad. Los envíos patrocinados tienen implementación y pruebas. Squads y Solana Pay continúan pendientes. |
| Negocio y distribución | 15 | 3/4 | 3/4 | 11,25 | El precio es consistente en README y flujo de cobro; hay dos cartas de interés. Aún no se acreditan adopción del canal, margen positivo ni un piloto en marcha. |
| Calidad y seguridad | 10 | 2/4 | 3/4 | 7,50 | Se corrigió el control de antigüedad de Chainlink y pasaron 147 pruebas. La clave de tesorería sigue en un firmante de servidor y faltan evidencias operativas externas. |
| Comunicación | 10 | 2/4 | 3/4 | 7,50 | README en inglés, arquitectura, comisión, referencias mainnet e instalación. Falta reunir demo, pitch, equipo y límites operativos en una presentación consistente. |
| Equipo y continuidad | 5 | 3/4 | 3/4 | 3,75 | Se mantiene la valoración previa como antecedente; el trabajo técnico es visible. No se verificaron nuevos perfiles ni dedicación de los integrantes. |
| **Total** | **100** | **66,25** | | **75,00** | **Mejora de 8,75 puntos; el informe anterior redondeaba a 66.** |

El aumento en uso de Solana también corrige una penalización excesiva del informe anterior: emplear transferencias SPL estándar puede ser adecuado para este producto. No hace falta un programa propio para justificar la red. La evidencia nueva fortalece la experiencia y el control operativo; la defensibilidad comercial sigue por demostrar.

## 2. Qué observaciones cambiaron

| Observación del 16/10 | Estado actual | Evidencia y límite |
|---|---|---|
| Cotización sin límite de antigüedad | **Resuelta en código y pruebas** | `validateRound` en [priceFeed.js](../src/priceFeed.js) exige un máximo positivo y rechaza rondas viejas. `paymentQuoteSettings` exige la variable; `createCharge` bloquea la reserva ante `quote_stale`. Hay pruebas del umbral y del rechazo sin reserva. No se inspeccionó la configuración desplegada. |
| README en español y evidencia técnica difícil de encontrar | **Resuelta en el README** | Inglés, diagrama, flujo, comisión, instalación, tesorería y firma mainnet. Las guías operativas siguen en español. |
| Comisión contradictoria de 1,05% y 0,5% | **Resuelta en lo inspeccionado; parcial en el conjunto de la entrega** | README, `quoteCharge`, inserción, restricción de base, pantalla de cobro y recibo usan 0,5%. No se revisaron pitch ni formularios externos. |
| Falta la carta de supermercados | **Mejoró parcialmente** | [Supermercado Soler](../business-lois/Carta_Intencion_Wang_Midatopay.pdf) tiene fecha 26/11/2025 y firma manuscrita visible. Solicita una demostración y evaluar un piloto. No documenta 15 supermercados ni uso actual. |
| Carta de Deenex sin firma | **Pendiente de evidencia verificable** | La [carta disponible](../business-lois/Carta_Intencion_Deenex_MidatoPay.pdf) termina con nombre y cargo impresos; no se aprecia firma manuscrita ni se verificó una firma digital. Expresa intención no vinculante y condicionada a disponibilidad comercial. |
| 500 locales en la carta frente a más de 1.000 en el pitch | **Alineada en README y documento complementario** | Se usan 500 locales declarados por Deenex en mayo y una proyección de 2.000 para diciembre de 2026. No se confirmó su cifra actual ni se verificó el pitch. Ninguna de esas cifras representa comercios activos de MidatoPay. |
| El comercio necesita SOL | **Cubierto en la implementación del flujo principal** | Tesorería paga liquidaciones y creación del ATA. Los envíos desde la wallet del usuario tienen patrocinio, firma del usuario, cuota diaria y presupuesto. La integración específica Kora/Privy de patrocinio sigue siendo roadmap; el patrocinio propio ya existe. |
| Demo anterior simulada | **Sin nueva verificación** | No hay en el README un enlace a una demo actual que permita cerrar esta observación. No se asume que el video actual siga siendo el antiguo. |
| Hot wallet única y reposición manual | **Pendiente** | [treasuryPayout.js](../netlify/functions/lib/treasuryPayout.js) firma con una clave de servidor. La guía confirma ausencia de compra automática de USDC y retiro automático de ARS. |
| Solana Pay con reference y Squads | **Pendiente** | Continúan como futuras integraciones en `src/i18n.jsx`. El memo ya permite trazabilidad, pero el enlace con la orden fiat depende también del sistema privado. |
| Rotación de la clave de Anthropic expuesta anteriormente | **Sin nueva verificación** | La política de build rechaza variables privadas con prefijo público. Esto no demuestra que se haya revocado una credencial histórica. |
| Equipo completo y roles visibles | **Pendiente en el README** | Falta una sección de equipo con integrantes, responsabilidades, experiencia y enlaces verificables. |

## 3. Fortalezas verificadas del producto actual

**El circuito de cobro tiene controles sustantivos.** La notificación HMAC no autoriza por sí misma un desembolso: se consulta la orden canónica y se contrastan importe, vendedor, caja, moneda, referencia y pago. Las reservas de USDC se toman bajo bloqueo; hay idempotencia en base y proveedor. El worker persiste firma y bytes antes de transmitir, retransmite los mismos bytes y exige `finalized` para registrar entrega y comisión. Una firma ambigua pasa a revisión. Fuentes: [paymentCore.js](../netlify/functions/lib/paymentCore.js), [paymentService.js](../netlify/functions/lib/paymentService.js), [paymentWorker.js](../netlify/functions/lib/paymentWorker.js).

**La presentación del cobro se acerca al trabajo real de un comercio.** Distingue acreditación en pesos de entrega USDC, permite iniciar el siguiente cobro y sigue actualizando entregas previas. La demora estimada no transforma arbitrariamente el pago en fallido ni suma un saldo pendiente al disponible. Fuentes: [chargeStatus.js](../src/chargeStatus.js), [MercadoPagoCharge.jsx](../src/MercadoPagoCharge.jsx), `test/charge-received.test.js` y `test/payment-activity.test.js`.

**Los envíos tienen una ruta controlada de patrocinio.** La wallet principal se verifica; se comprueba que el mensaje firmado sea el preparado, se exige firma del usuario y se guarda la autorización completa antes de emitirla. Los límites son dos envíos diarios por usuario y red, además del presupuesto global. El acceso general está deshabilitado por defecto y admite un piloto por DID autorizado. Son capacidades de código, no evidencia de disponibilidad general en producción. Fuentes: [USDC_TRANSFERS.md](../docs/USDC_TRANSFERS.md), `lib/transferService.js`, `lib/transferWorker.js` y `test/transfers.test.js`.

**La evidencia mainnet es comprobable.** Se consultó `getTransaction` con compromiso `finalized` en el RPC público mainnet de Solana para la [firma del README](https://explorer.solana.com/tx/3hsY2qzqthv6VHXPuNC7F1cvGCq333Gkk5SDyJbWVaeFbEEYaDyco6pzEY72qjip8BKZUPNCp22w16G1STchL4hv). El resultado mostró:

| Campo | Resultado observado |
|---|---|
| Fecha del bloque | 16/10/2026, 13:25:20 UTC |
| Slot | `457653370` |
| Error | `null` |
| Origen y fee payer | Tesorería `7pCp94zA14dSoQC9wiqoNiPtS96XXEEirAqwbrYmbL5L` |
| Token | USDC mainnet, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Transferencia | `0.016606 USDC`, con `TransferChecked` y seis decimales |
| Memo | `kind:charge_mercadopago`, referencia `mp_f72f4b26d568490d8bab300f89d988f7`, `amt:27.00`, `fx:1617.47` |
| Comisión de red | `5000` lamports |

El monto coincide con la fórmula de cobro: ARS 27,00 menos ARS 0,14 de comisión redondeada, dividido por 1617,47 y truncado a seis decimales. Esta consistencia refuerza la evidencia técnica. La cadena por sí sola no acredita el pago de Mercado Pago, la identidad comercial del receptor ni recurrencia de ventas; para eso se necesita contrastar la orden y el historial operativo.

## 4. Qué impide una evaluación de 80 o más

### Margen y reposición de liquidez

Definir una comisión es un avance de claridad. La sostenibilidad sigue sin estar demostrada. El [README](../README.md) indica que MidatoPay absorbe Mercado Pago y Solana; la [guía operativa](../docs/MERCADOPAGO_PRODUCCION.md) aclara que el USDC se prefinancia y no se recompra automáticamente.

Por operación hace falta calcular, en una misma moneda y sobre importes realmente ejecutados:

`Margen = comisión cobrada − costo efectivo MP − costo de convertir/reponer USDC − costo de red/ATA − otros costos variables y pérdidas`.

En el ejemplo de ARS 10.000, el ingreso bruto es ARS 50. Si los costos variables totales exceden ARS 50, la operación pierde dinero. No se afirma que la tarifa efectiva de Mercado Pago tenga un valor determinado: no se aportaron liquidaciones ni condiciones contractuales que permitan calcularlo.

Además del margen, falta medir cuánto capital necesita la tesorería entre la entrega USDC y la disponibilidad/reinversión del dinero fiat. Más volumen también implica más necesidad de liquidez.

### Política de precio y disponibilidad

Restaurar el límite de 25 horas cierra el hallazgo concreto de cotizaciones sin antigüedad máxima. **No garantiza que la cotización sea ejecutable al reponer USDC ni elimina todo arbitraje.** La aplicación acepta cualquier máximo entero positivo configurado; `90000` es el valor documentado, no un techo fijo del código.

Chainlink recomienda verificar timestamps y aplicar controles adicionales; también advierte sobre horarios de operación de feeds Forex. Fuentes: [monitoreo de feeds](https://docs.chain.link/data-feeds/overview) y [selección de feeds y horarios](https://docs.chain.link/data-feeds/selecting-data-feeds). La página específica USD/ARS devolvió 403; en esta revisión no se reconfirmó su heartbeat. El valor de 86400 segundos consta en código y en la verificación documentada del repositorio del 14/10.

La mejora pendiente es demostrar que la cotización usada cubre el precio efectivo de reposición, contemplar cierres/feriados y definir pausas por desvío o falta de liquidez. Conviene corregir la afirmación absoluta de `datosadicionales.md` de que un precio viejo ya no puede arbitrarse.

### Demanda frente a adopción

Las cartas mejoran la evidencia de interés, pero falta el paso comercial: fecha de piloto, locales aceptados, condiciones y resultados. La de Soler es anterior al producto actual; corresponde reconfirmar interés y registrar la prueba. La red declarada de Deenex es una posibilidad de distribución, cuyo uso por MidatoPay todavía debe demostrarse.

Un piloto de 3 a 5 comercios durante una semana, con número de cobros, volumen, comercios que repiten, tiempos de entrega, incidencias y margen observado, aportaría más evidencia que sumar otra integración de roadmap. Es una propuesta de validación, no una garantía de puntaje.

### Custodia y encuadre operativo

La arquitectura mantiene una clave de tesorería en servidor. Las reservas evitan que la aplicación prometa el mismo saldo dos veces; no limitan por sí mismas el daño de una clave comprometida. Falta acreditar límites de exposición de la hot wallet, custodia de reservas, reposición, alertas y respuesta a incidentes. Squads puede cubrir parte de ese objetivo; su mera mención no lo acredita.

También sigue el modelo de una cuenta vendedora de plataforma con cajas por comercio, descrito en [merchantPos.js](../netlify/functions/lib/merchantPos.js) y la guía operativa. No se encontró documentación de validación contractual con Mercado Pago ni del encuadre con un socio regulado o esquema propio. No se infiere del código que el modelo esté autorizado o prohibido. Para la diligencia actual corresponde contrastar documentación vigente, incluido el [registro público de PSAV](https://www.cnv.gov.ar/SitioWeb/RegistrosPublicos/Psav) y la [información oficial de CNV](https://www.argentina.gob.ar/node/420252), en vez de repetir únicamente la referencia histórica RG 994/2024 del PDF.

### Presentación todavía fragmentada

El README puede explicar el producto en una lectura, pero todavía no ofrece demo, pitch ni equipo. Algunas piezas dan señales incompatibles con el estado actual:

- `datosadicionales.md` informa 16 archivos y 115 pruebas; esta copia tiene 20 archivos de pruebas y la ejecución produjo 147 casos aprobados.
- `src/i18n.jsx` mantiene patrocinio de fees como pendiente, aunque existe patrocinio propio; conviene distinguirlo de la futura integración Kora.
- Hay textos en inglés de Activity que todavía mencionan Devnet de forma fija.
- El README habla de acreditación en segundos; el flujo actual contempla una estimación de tres minutos y demoras. Hace falta publicar tiempos medidos, distinguiendo recepción fiat, confirmación y finalización.
- `CLAUDE.md` dice que no hay pruebas y describe el circuito anterior. Los documentos de Arc son antecedentes de otro despliegue y requieren una identificación histórica clara para no confundir al revisor.

## 5. Lectura por tipo de evaluador

Estos son juicios orientativos de esta revisión, no opiniones atribuidas a las organizaciones.

| Perspectiva | Lectura actual | Evidencia que cambiaría la decisión |
|---|---|---|
| Colosseum, producto/startup | Hay una tesis clara y capacidad de ejecución; merece una demo y conversación de seguimiento. El historial mainnet ya estaba reconocido en la devolución anterior. | Demo actual, un caso de comercio con números, uso repetido y margen/capital requeridos. |
| Superteam, acompañamiento local | Se cerraron tareas concretas de documentación y precio; hay una base técnica para acompañar un piloto. | Carta de canal verificable, comercios seleccionados, roles públicos y un plan operativo con responsables. |
| Ecosistema Solana | El comercio recibe USDC nativo con trazabilidad y sin cargar SOL para cobrar; la red cumple una función económica concreta. | Volumen recurrente de comercios externos, uso posterior del USDC, custodia de reservas y conciliación interoperable cuando la necesiten. |
| Inversor pre-seed | El avance de ingeniería reduce incertidumbre técnica. Sigue abierta la incertidumbre sobre distribución, margen, capital y permisos operativos. | Resultados del piloto, condiciones del canal y reposición, costos reales y documentación contractual. |

Los [criterios publicados por Colosseum](https://colosseum.com/hackathon) consideran equipo/mercado, insight, ejecución, mercado, comunicación, viabilidad y tracción. La [guía de Superteam Argentina](https://superteam.ar/stack/hackathon) refuerza demo funcional, problema real y modelo de negocio. Por eso más bibliotecas o un programa Anchor no producirían por sí mismos el próximo salto.

No actualizo el 15% de probabilidad de inversión del panel simulado anterior: no hay información suficiente para convertir estos cambios en una probabilidad fiable de inversión, premio o posición relativa.

## 6. Próximos pasos que más cambian la evaluación

| Orden | Entregable | Criterio para considerarlo logrado |
|---|---|---|
| 1 | Demo del producto actual y enlace en el README | Se ven QR Mercado Pago, acreditación fiat, entrega USDC y firma/memo mainnet de la misma operación. Identificar las pruebas y respetar los tiempos reales. |
| 2 | Ficha de un comercio y piloto acordado | Caso con problema cuantificado, responsable, fecha y 3 a 5 locales aceptados; después, resultados de una semana y testimonios verificables. |
| 3 | Economía por cobro y plan de reposición | Liquidación real MP, precio ejecutado de compra USDC, costos de red/ATA, margen y capital necesario al volumen esperado. |
| 4 | Paquete comercial consistente | Deenex con firma verificable y condiciones del piloto; reconfirmación de Soler; distinguir red del socio, proyección y clientes activos. Usar 0,5% mientras sea la tarifa implementada. |
| 5 | Controles operativos de fondos | Límite de hot wallet, reserva y reposición documentadas, alertas y evidencia de revisión contractual/regulatoria pertinente. |
| 6 | Presentación pública coherente | Enlaces a pitch y demo, equipo/roles, contadores de pruebas actualizados, distinción entre capacidades implementadas y roadmap. |

Para superar 80 con esta rúbrica hace falta evidencia suficiente para subir al menos una dimensión relevante a 4. Si producto y ejecución subieran de 3 a 4, el total sería 81,25. Eso requiere una demostración consistente y aprendizaje de uso real; grabar un video por sí solo no acredita esa nota. Si aún no se concede el aumento de uso de Solana por falta de validación desplegada, el escenario conservador sería 71,25.

## 7. Verificación realizada

| Comprobación | Resultado y alcance |
|---|---|
| `npm test` | **147 aprobadas, 0 fallos, 0 omitidas**. Incluye PostgreSQL embebido, reservas, idempotencia, antigüedad de cotización, recibos, recuperación, wallet principal y transferencias patrocinadas. |
| `npm run build` | **Aprobado**. Se observaron advertencias de herramientas, incluida una opción de optimización obsoleta de Vite. |
| `npm run functions:check` | **Aprobado**. Empaquetó 19 Functions; los endpoints protegidos ensayados rechazaron solicitudes sin autenticación. Hubo advertencias de `import.meta` en empaquetado CJS. |
| Consulta de firma mainnet | **Aprobada**, únicamente lectura RPC, sin firmas ni movimientos de fondos. |
| Cartas de interés | **Leídas y renderizadas**. Soler con firma manuscrita visible; Deenex con nombre/cargo impresos. No se autentificaron los firmantes. |
| CI remoto y dependencias | Se leyó el workflow con matriz devnet/mainnet. No se comprobó su ejecución remota actual ni se ejecutó una auditoría de dependencias. |

Las verificaciones locales usaron Node `v24.19.0`; el README y CI especifican Node 22. No se repitió aquí la matriz completa bajo Node 22 ni se validó un despliegue autenticado. Estos controles respaldan los comportamientos cubiertos y no equivalen a una auditoría integral de seguridad o a certificación productiva.

**Dictamen:** el estado actual justifica una mejora frente al informe de octubre y una nueva revisión con demo. La evidencia permite defender 75/100 como estimación independiente. El trabajo de mayor valor ahora es convertir la capacidad técnica en una operación comercial medible y sostenible.

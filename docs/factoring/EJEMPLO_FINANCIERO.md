# Ejemplo financiero: adelanto de facturas a 30, 60 y 90 días

Fecha: 09/11/2026. Complementa `FACTORING_HANDOFF.md` (sección 5).

> **Aviso, 11/11/2026:** los pools quedaron descartados; el modelo y el cálculo vigentes (cesión a un único inversor, 35% TNA y comisión del 2,5% del descuento) están en `DECISIONES_MOCK_CESION.md`. Las secciones 4.2 y 6 ya describen el modelo vigente; las cifras exactas en centavos están en `PLAN_IMPLEMENTACION_PILOTO.md` (sección 6.3).
>
> **Imágenes, 26/11/2026:** `EJEMPLO_FINANCIERO.svg/.jpg` muestra el modelo de pools y queda como historial. La vigente es `EJEMPLO_FINANCIERO_CESION.svg/.jpg`, con el cálculo de la cesión a un único inversor.

**Las cifras son ilustrativas.** Sirven para discutir precios y estructura con CEO, CFO y CBO. No son una oferta ni una tasa aprobada. Las tasas de referencia del mercado cambian todos los meses y hay que recalibrarlas antes de usarlas.

## 1. Convenciones y supuestos

- Interés simple, base 365 días, tasa nominal anual vencida (TNA). Es la convención del plazo fijo y de los cheques del MAV, así que las tasas se pueden comparar directamente.
- TEA = (1 + TNA × días / 365) ^ (365 / días) − 1. Supone que la operación se renueva a la misma tasa.
- **Flujo de la operación:**
  1. El comercio cede una factura de nominal N.
  2. El pool le paga hoy el neto: `N / (1 + tasa_comercio × días / 365)`.
  3. Al vencimiento, el deudor paga N.
  4. El pool recupera `neto × (1 + tasa_pool × días / 365)`. MidatoPay se queda con el resto, que es su margen.
- No hay aforo en el caso base. La sección 3.4 muestra la variante con aforo.
- **No se incluyen impuestos:** IVA sobre intereses y comisiones, impuesto a los débitos y créditos bancarios, Ingresos Brutos ni Ganancias de los inversores. El tratamiento lo tiene que confirmar el CFO con el contador.

**Parámetros:**

| Parámetro | Pesos | Dólares (USDC) |
|---|---|---|
| Nominal de la factura | ARS 100.000 | USD 10.000 |
| Tasa de descuento al comercio (TNA) | 30 d: 34%; 60 d: 36%; 90 d: 38% | 30 d: 13%; 60 d: 14%; 90 d: 15% |
| Margen de MidatoPay | 4 pp anuales | 2,5 pp anuales |
| Tasa que gana el pool (TNA) | 30 d: 30%; 60 d: 32%; 90 d: 34% | 30 d: 10,5%; 60 d: 11,5%; 90 d: 12,5% |
| Pérdida esperada (anual, sobre capital colocado) | 2% | 1,5% |

Criterio de las tasas en pesos: la TAMAR (23,56%) más un spread que crece con el plazo, de entre 6,5 y 10,5 pp para el pool. Es una factura común, sin aval de SGR y sin mercado secundario, así que tiene que pagar más que un cheque avalado.

## 2. Tasas de referencia del mercado (noviembre 2026)

| Instrumento | Tasa | Fuente |
|---|---|---|
| Plazo fijo en pesos a 30 días, promedio del sistema | 21,18% TNA (04/11/2026) | BCRA vía El Tablero |
| BADLAR / TAMAR | 21,5% / 23,56% TNA (04/11/2026) | BCRA vía El Tablero |
| Adelantos en cuenta corriente, promedio del sistema | 25,66% TNA (04/11/2026) | BCRA vía El Tablero |
| Cheques de pago diferido avalados en pesos (MAV) | 24,5% a 28% TNA (operaciones de octubre de 2026) | Boletines diarios de la BCR |
| Índice de Financiamiento PyME (VetaCap) | 27,76% TNA (agosto de 2026) | Rosario3 |
| Descuento de cheques a 30 días en Banco Nación | 23% TNA (anunciado en 2026) | Urgente24 |
| Líneas bancarias en dólares (productores) | 5% a 13% anual (octubre de 2026) | El Litoral / BCR |
| Plazo fijo en dólares | 0,61% promedio y 1,80% la mejor tasa (10/11/2026) | BCRA vía tuplazofijo |
| Aave V3, suministro de USDC | 3,8% a 5,2% APY (2026) | eco.com con datos de DeFiLlama |
| Huma PayFi Strategy Token (PST) | 8% APY (09/11/2026) | huma.finance |

## 3. Lado de la empresa que adelanta la factura

### 3.1 Factura de ARS 100.000

| Plazo | Tasa de descuento (TNA) | TEA | Recibe hoy | Costo total | Costo sobre el nominal |
|---|---|---|---|---|---|
| 30 días | 34% | 39,84% | ARS 97.281,45 | ARS 2.718,55 | 2,72% |
| 60 días | 36% | 41,87% | ARS 94.412,83 | ARS 5.587,17 | 5,59% |
| 90 días | 38% | 43,80% | ARS 91.432,87 | ARS 8.567,13 | 8,57% |

### 3.2 Factura de USD 10.000

| Plazo | Tasa de descuento (TNA) | TEA | Recibe hoy | Costo total | Costo sobre el nominal |
|---|---|---|---|---|---|
| 30 días | 13% | 13,80% | USD 9.894,28 | USD 105,72 | 1,06% |
| 60 días | 14% | 14,85% | USD 9.775,04 | USD 224,96 | 2,25% |
| 90 días | 15% | 15,87% | USD 9.643,33 | USD 356,67 | 3,57% |

### 3.3 Comparación con las alternativas de la empresa

- **En pesos,** 34% a 38% está entre 6 y 14 pp por encima de un cheque avalado en el MAV (24,5% a 28%) y del adelanto en cuenta corriente promedio (25,66%). El producto compite con esas tasas solo para comercios que no tienen línea bancaria ni aval de SGR, o que no reciben cheques de sus clientes. Si la factura es una FCE o lleva aval, la tasa podría acercarse a la del MAV.
- **En dólares,** 13% a 15% queda en el extremo alto de las líneas bancarias (5% a 13%). Esas líneas piden calificación crediticia y garantías. El adelanto de facturas compite por velocidad y por acceso, no por precio.
- **El costo crece casi proporcional al plazo.** A 90 días el comercio paga el 8,57% del nominal en pesos y el 3,57% en dólares.

### 3.4 Variante con aforo: USD 10.000 a 60 días con anticipo del 90%

El aforo no cambia la tasa. Reduce el dinero adelantado y protege al pool si el deudor paga menos, por ejemplo por una nota de crédito o un descuento comercial.

| Concepto | USD |
|---|---|
| Anticipo (90% del nominal) | 9.000,00 |
| Interés descontado (14% TNA, 60 días) | 202,46 |
| El comercio recibe hoy | 8.797,54 |
| El pool recupera al vencimiento | 8.963,85 |
| Margen de MidatoPay | 36,15 |
| Remanente que se devuelve al comercio si el deudor paga el 100% | 1.000,00 |

| El deudor paga | Pool | MidatoPay | Comercio (remanente) |
|---|---|---|---|
| 100% (10.000) | 8.963,85 | 36,15 | 1.000,00 |
| 95% (9.500) | 8.963,85 | 36,15 | 500,00 |
| 90% (9.000) | 8.963,85 | 36,15 | 0,00 |
| 85% (8.500) | 8.500,00 (pierde 463,85) | 0,00 | 0,00 |

Con un aforo del 10%, el pool no pierde mientras el deudor pague al menos el 89,6% del nominal.

## 4. Lado del inversor

### 4.1 Compra por factura (modelo A del documento de traspaso)

El inversor fondea una factura puntual y cobra cuando paga el deudor. El capital trabaja todo el plazo de la operación.

| Factura | Plazo | Invierte hoy | Cobra al vencimiento | Ganancia | TNA | TEA | TNA neta de pérdida esperada |
|---|---|---|---|---|---|---|---|
| ARS 100.000 | 30 días | 97.281,45 | 99.680,17 | 2.398,72 | 30% | 34,50% | 28% |
| ARS 100.000 | 60 días | 94.412,83 | 99.379,20 | 4.966,37 | 32% | 36,60% | 30% |
| ARS 100.000 | 90 días | 91.432,87 | 99.098,20 | 7.665,33 | 34% | 38,61% | 32% |
| USD 10.000 | 30 días | 9.894,28 | 9.979,67 | 85,39 | 10,5% | 11,02% | 9% |
| USD 10.000 | 60 días | 9.775,04 | 9.959,83 | 184,79 | 11,5% | 12,07% | 10% |
| USD 10.000 | 90 días | 9.643,33 | 9.940,55 | 297,23 | 12,5% | 13,10% | 11% |

Visto como descuento: el inversor compra la factura de ARS 100.000 a 30 días pagando el 97,28% del nominal. MidatoPay retiene el 0,32% del nominal al cobro.

**Lo que no muestra la tabla:** entre una operación y la siguiente, el capital puede quedar sin colocar. Ese es el tema de la sección 4.2.

### 4.2 Cesión a un único inversor (modelo vigente del piloto)

Los pools prefondeados con tramos (el antiguo modelo B) quedaron descartados por motivos regulatorios (`DECISIONES_MOCK_CESION.md`). En el piloto, cada factura se cede entera a un único inversor, que paga en pesos desde su cuenta de 21 Millions: el neto va directo al CVU del emisor y la comisión al CVU de MidatoPay. No hay capital ocioso ni tramos.

Supuestos vigentes: 35% TNA base 365 desde la toma hasta el vencimiento, comisión de MidatoPay del 2,5% del descuento a cargo del inversor y redondeo al centavo, mitad hacia arriba (D-01).

Factura de ARS 17.000.000 (los mismos centavos que `PLAN_IMPLEMENTACION_PILOTO.md`, sección 6.3):

| Concepto | 30 días | 60 días | 90 días |
|---|---|---|---|
| Descuento | 475.366,18 | 924.870,47 | 1.350.567,47 |
| Acreditación al emisor | 16.524.633,82 | 16.075.129,53 | 15.649.432,53 |
| Comisión MidatoPay | 11.884,15 | 23.121,76 | 33.764,19 |
| Desembolso del inversor | 16.536.517,97 | 16.098.251,29 | 15.683.196,72 |
| Ganancia del inversor | 463.482,03 | 901.748,71 | 1.316.803,28 |
| TNA del inversor | 34,10% | 34,08% | 34,05% |

El inversor gana algo menos que la tasa de descuento porque paga la comisión. Con montos mínimos (ARS 100) el redondeo al centavo pesa más: ver la tabla de ARS 100 en el plan.

La sección 4.3 compara rendimientos de tramos senior y junior del modelo descartado; queda como contexto de mercado.

### 4.3 Comparación con las alternativas del inversor

**En pesos:**

- El senior al 27% le gana al plazo fijo (21,18%) por unos 6 pp.
- Pero compite contra el cheque avalado del MAV (24,5% a 28%), que tiene garantía de SGR y mercado secundario. Para ser atractivo, el senior necesita una garantía comparable (first loss visible, aval) o una tasa por encima de la de los avalados.

**En dólares:**

- El senior al 7% supera al plazo fijo en dólares (0,61% a 1,80%) y a Aave en USDC (3,8% a 5,2%).
- Queda por debajo del PST de Huma (8%), que diversifica entre varios negocios y declara 0% de defaults.
- Un pool de facturas argentinas tiene más riesgo que el PST de Huma. Atraer capital senior en USDC probablemente exija más del 8%, y eso solo cierra con utilización alta (modelo A o C) o con tasas al comercio más altas.

## 5. Cómo se reparte el descuento

| Operación | Costo para el comercio | Gana el pool | Margen de MidatoPay |
|---|---|---|---|
| ARS 100.000 a 30 días | 2.718,55 | 2.398,72 | 319,83 |
| ARS 100.000 a 60 días | 5.587,17 | 4.966,37 | 620,80 |
| ARS 100.000 a 90 días | 8.567,13 | 7.665,33 | 901,80 |
| USD 10.000 a 30 días | 105,72 | 85,39 | 20,33 |
| USD 10.000 a 60 días | 224,96 | 184,79 | 40,17 |
| USD 10.000 a 90 días | 356,67 | 297,23 | 59,45 |

MidatoPay cobra su margen del pago del deudor. Si el deudor no paga, MidatoPay tampoco cobra, lo que alinea incentivos con el pool.

## 6. Moneda del piloto

El piloto opera solo en pesos: el desembolso del inversor, el neto al emisor, la comisión y el cobro al deudor son retiros bancarios en ARS de 21 Millions. No hay fondeo en USDC ni conversión, así que la operación no tiene riesgo cambiario. El registro on-chain en Arc no mueve fondos.

El análisis anterior de un pool en USDC que financiaba facturas en pesos quedó descartado junto con los pools. Si en el futuro se fondea en dólares, el riesgo cambiario vuelve y hay que elegir entre las alternativas de FD-09 del documento de traspaso.

## 7. Ticket mínimo y escala para MidatoPay

**Ticket mínimo.** Supuestos: costo operativo de USD 10 por factura (constatación, notificación de la cesión, conciliación y soporte) y un tipo de cambio de ARS 1.545 por USD. El ticket mínimo para que el margen cubra ese costo es:

| Plazo | Ticket mínimo en USD | Ticket mínimo en ARS |
|---|---|---|
| 30 días | USD 4.867 | ARS 4.699.375 |
| 60 días | USD 2.433 | ARS 2.349.688 |
| 90 días | USD 1.622 | ARS 1.566.458 |

- Una factura de ARS 100.000 (unos USD 65) deja a MidatoPay ARS 620,80 a 60 días, unos USD 0,40. No cubre el costo de procesarla. Sirve como ejemplo de cálculo, no como operación viable.
- La factura de USD 10.000 es viable a cualquier plazo con estos supuestos.

**Escala.** Con un margen de 2,5 pp anuales, cada USD 1.000.000 colocado en facturas durante un año genera unos USD 25.000 para MidatoPay, antes de pérdidas y costos. Con 4 pp en pesos, ARS 1.000 millones colocados generan ARS 40 millones.

**FCE.** Desde el 14/04/2026, una MiPyME que vende a una gran empresa debe emitir FCE para comprobantes desde ARS 5.549.862 (Contadores en Red, a confirmar). Una factura de USD 10.000 (unos ARS 15,5 millones) entre esas partes sería una FCE, que tiene un circuito propio (documento de traspaso, sección 6.3).

## 8. Conclusiones para la discusión

1. **En pesos, el negocio cierra para el comercio sin acceso a crédito,** pero el margen frente al inversor es angosto. El comercio paga 34% a 38%, y el inversor senior puede conseguir 24,5% a 28% con cheques avalados. Conviene empezar por factura (modelo A) o sumar un aval o una primera pérdida visible.
2. **En dólares, la utilización decide el modelo.** Al 85% el senior rinde 7%, por debajo del 8% de Huma PST. Esto apoya empezar con un inversor ancla y fondeo por factura o línea comprometida (modelos A o C) y prefondear recién con volumen estable.
3. **Plazos cortos y tickets chicos no cubren el costo operativo.** Hace falta un ticket mínimo, o una comisión fija además de la tasa.
4. **El tramo junior protege al senior** con una relación 4:1. MidatoPay debería tener parte del junior para alinear incentivos, como exige Huma a su Evaluation Agent.
5. **El aforo protege de la dilución** (notas de crédito y descuentos) sin cambiar la tasa.
6. **Mezclar facturas en pesos con fondeo en USDC** requiere una decisión explícita sobre el riesgo cambiario.

## 9. Cómo recalcular

- Neto para el comercio: `N / (1 + tasa_comercio × d / 365)`.
- Recupero del pool: `neto × (1 + tasa_pool × d / 365)`.
- Margen de MidatoPay: `N − recupero del pool`.
- TEA: `(1 + TNA × d / 365) ^ (365 / d) − 1`.
- Pool con tramos (un año):
  - `bruto = colocado × tasa_pool + no_colocado × tasa_ociosa`
  - `disponible = capital + bruto − pérdidas`
  - El senior cobra primero, hasta `capital_senior × (1 + objetivo)`. El junior cobra el resto, con un mínimo de cero.
- Devaluación máxima para un objetivo en USD: `(1 + tasa_ARS × d / 365) × (1 − costo)^2 / (1 + objetivo_USD × d / 365) − 1`.

## Fuentes

- [El Tablero: tasas del BCRA (plazo fijo, BADLAR, TAMAR, adelantos)](https://eltablero.ar/tasas)
- [BCR: boletín diario de cheques de pago diferido, 05/10/2026](https://www.bcr.com.ar/sites/default/files/2026-10/20261005bv.pdf) y [16/10/2026](https://www.bcr.com.ar/sites/default/files/2026-10/20261016bv.pdf)
- [Rosario3: Índice de Financiamiento PyME de agosto de 2026](https://www.rosario3.com/ecos365/ecos365/noticias/credito-para-pymes-cuanto-cuesta-financiarse-y-que-puede-pasar-con-las-tasas-20260922-0003.html)
- [Urgente24: Banco Nación baja tasas para pymes](https://urgente24.com/dinero/banco-nacion-baja-tasas-pymes-y-sacude-el-tablero-del-credito-n621915)
- [El Litoral: tasas de financiamiento de productores](https://www.ellitoral.com/campolitoral/productores-echeqs-campanaagricola-credito-bolsadecomercioderosario-mercadoargentinodevalores-sistemabancario-santafe-financiamiento-mav-tasas-canje-pagares-tarjetasagropecuarias-mipymes-bcr_0_V2U9LwbFur.html)
- [tuplazofijo: tasas de plazo fijo en dólares](https://www.tuplazofijo.com.ar/plazos-fijos/tasas/dolares/)
- [eco.com: protocolos de préstamo DeFi en 2026](https://eco.com/support/en/articles/15254000-best-defi-lending-protocols-2026-tvl-rates-risk-compared)
- [Huma Finance](https://huma.finance/)
- [Huma Institutional: P&L de tramos](https://docs.huma.finance/products/huma-institutional/tranches/pnl.md)
- [Contadores en Red: monto mínimo de FCE desde abril de 2026](https://contadoresenred.com/factura-de-credito-electronica-mipyme-monto-minimo-a-partir-de-abril-2026/)

Las tasas de mercado se tomaron de las fuentes indicadas y se resumieron para este documento.

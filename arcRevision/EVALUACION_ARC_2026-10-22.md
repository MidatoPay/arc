# MidatoPay en Arc: evaluación actualizada

Fecha: 22 de octubre de 2026. Base local: rama `fv-migracionArc` (migración a Arc Mainnet), más el README y los documentos del workspace.

Esta revisión reemplaza la del 19/10/2026, hecha sobre la versión anterior de la app en otra red. Conserva la misma rúbrica y las observaciones comerciales, que no dependen de la red, y actualiza lo que cambia con Arc. No constituye una calificación oficial de ningún programa ni jurado. El [informe externo original](v4-2026-10-16.pdf) corresponde a la versión anterior y se conserva como antecedente.

## Alcance y criterio de evidencia

Se contrastaron el [README](../README.md), [datosadicionales.md](../datosadicionales.md), el código de cobros y transferencias, migraciones, pruebas, configuración de CI, documentación operativa y las dos cartas de `business-lois/`.

La existencia de código demuestra implementación. Una prueba automatizada demuestra el comportamiento cubierto por esa prueba. Una transacción en mainnet demuestra una operación on-chain. Una carta demuestra interés declarado. Para acreditar adopción hacen falta comercios externos al equipo, operaciones recurrentes y resultados de un piloto.

**Diferencia principal con la revisión anterior:** la versión anterior tenía una transacción real en mainnet verificada por RPC. La versión Arc todavía **no tiene operaciones en Arc Mainnet**: la app es nueva, la base de datos productiva no existe todavía y la tesorería no está fondeada. Esa evidencia hay que volver a generarla.

## 1. Puntaje con la misma rúbrica

Se conservan pesos y escala de 0 a 4. Cálculo: suma de `peso × nota / 4`. Las notas representan juicio sobre la evidencia disponible.

| Dimensión | Peso | Nota | Puntos | Fundamento |
|---|---:|---:|---:|---|
| Problema e insight | 20 | 3/4 | 15,00 | Igual que antes: el problema del comercio está bien expresado; falta un caso medido. |
| Producto y ejecución | 25 | 2/4 | 12,50 | El circuito está implementado y probado para Arc, pero sin operación real en Arc Mainnet ni demo de esta versión. Con una operación real verificable vuelve a 3/4. |
| Diferenciación y uso de la red | 15 | 3/4 | 11,25 | USDC como dinero y gas, finalidad determinística y memo on-chain encajan con el producto. El comercio no necesita un segundo token. |
| Negocio y distribución | 15 | 3/4 | 11,25 | Sin cambios: comisión consistente y dos cartas de interés; falta piloto en marcha y margen demostrado. |
| Calidad y seguridad | 10 | 3/4 | 7,50 | 193 pruebas aprobadas, nonces bajo lock, persistencia antes de transmitir, verificación por recibo, chain ID en cada RPC y bloqueo de pagos sandbox en mainnet. Sigue la clave de tesorería en un firmante de servidor. |
| Comunicación | 10 | 3/4 | 7,50 | README, reglas y guías actualizados para Arc. Faltan demo, pitch y equipo. |
| Equipo y continuidad | 5 | 3/4 | 3,75 | Sin cambios verificados. |
| **Total** | **100** | | **68,75** | **Escenario con una operación real en Arc Mainnet verificada: 75,00.** |

## 2. Qué cambia con Arc

| Tema | Estado en la versión Arc | Evidencia y límite |
|---|---|---|
| Moneda de gas | **Resuelto por diseño** | El gas se paga en USDC. La tesorería paga el gas de los payouts y reserva 0,05 USDC para eso. El usuario paga el gas de sus propios envíos, mostrado antes de confirmar. |
| Finalidad | **Simplificado** | Un recibo exitoso es final; no hay estados intermedios ni conteo de confirmaciones. |
| Reintentos y nonces | **Cubierto en código y pruebas** | Nonce de tesorería bajo `pg_advisory_lock`; retransmisión de los mismos bytes; un nonce consumido por otra transacción pasa a revisión. `test/payout-follow.test.js`, `test/payments.test.js`. |
| Envíos de usuarios | **Cubierto en código y pruebas** | El servidor prepara la transacción, la wallet embebida la firma, el servidor exige que sea idéntica y del remitente, la simula y la guarda antes de transmitir. Sin cuota diaria ni patrocinio. `test/transfers.test.js`. |
| Pagos sandbox | **Bloqueado** | `MP_ENVIRONMENT=test` no puede liberar USDC real en mainnet (`mp_test_requires_test_network`). |
| Escáner | **Portado** | URIs EIP-681 de USDC en Arc, direcciones EVM y links de cobro MidatoPay. `test/arc-chain.test.js`. |
| Evidencia on-chain | **Pendiente** | No hay todavía transacciones de MidatoPay en Arc Mainnet. |
| Firma de Privy | **Sin verificación real** | La firma silenciosa (`signTransaction` sin UI) y que Privy no altere gas ni nonce se probaron solo con claves efímeras y RPC simulado. |

## 3. Observaciones que siguen vigentes

Estas observaciones de la revisión anterior no dependen de la red:

- **Margen y reposición de liquidez.** Falta calcular por operación: `margen = comisión − costo efectivo MP − costo de convertir/reponer USDC − gas − otros costos y pérdidas`, y el capital que necesita la tesorería entre la entrega USDC y la disponibilidad del dinero fiat.
- **Política de precio.** El límite de 25 horas de Chainlink cierra el hallazgo de cotizaciones viejas, pero no garantiza que la cotización sea ejecutable al reponer USDC ni contempla cierres o feriados del mercado.
- **Demanda frente a adopción.** Las cartas muestran interés; falta fecha de piloto, locales, condiciones y resultados. La de Soler es anterior al producto actual; la de Deenex no muestra firma manuscrita verificable.
- **Custodia y encuadre operativo.** La tesorería es una clave de servidor. Faltan límites de exposición, custodia de reservas, reposición, alertas, respuesta a incidentes y la validación contractual/regulatoria del modelo de cuenta vendedora con cajas por comercio.
- **Presentación.** Faltan demo, pitch y sección de equipo.

## 4. Próximos pasos que más cambian la evaluación

| Orden | Entregable | Criterio para considerarlo logrado |
|---|---|---|
| 1 | Primera operación real en Arc Mainnet | Base productiva migrada, tesorería fondeada, un cobro real con QR Mercado Pago, acreditación fiat y entrega USDC con recibo y memo verificables en el explorer. |
| 2 | Demo de la versión Arc enlazada en el README | La misma operación de punta a punta, con tiempos reales. |
| 3 | Validación de envíos con la cuenta piloto | Firma silenciosa de Privy en Arc, gas mostrado igual al cobrado, saldo insuficiente para importe + gas. |
| 4 | Ficha de un comercio y piloto acordado | 3 a 5 locales, una semana, cobros, volumen, repetición, incidencias y margen observado. |
| 5 | Economía por cobro y plan de reposición | Liquidación real MP, precio de compra USDC, gas, margen y capital necesario. |
| 6 | Controles operativos de fondos | Límite de hot wallet, reserva y reposición documentadas, alertas. |

## 5. Verificación realizada

| Comprobación | Resultado y alcance |
|---|---|
| `npm test` | **193 aprobadas, 0 fallos** (27 archivos). PostgreSQL embebido, claves efímeras y RPC de Arc simulado. |
| `npm run build` | **Aprobado.** Advertencias de tamaño de chunks de Privy. |
| `npm run functions:check` | **Aprobado.** 21 Functions empaquetadas; los endpoints protegidos rechazan solicitudes sin autenticación. |
| Operaciones en Arc Mainnet | **No ejecutadas.** No se firmaron transacciones reales ni se movieron fondos. |
| Cartas de interés | Sin cambios respecto de la revisión anterior. |

Las verificaciones usaron Node 22. No equivalen a una auditoría integral de seguridad ni a certificación productiva.

**Dictamen:** la migración deja la base técnica lista para Arc Mainnet, con controles de liquidación iguales o más simples que antes. La evaluación vuelve al nivel anterior en cuanto exista una operación real verificable en Arc. El trabajo de mayor valor sigue siendo convertir la capacidad técnica en una operación comercial medible.

# Matriz de capacidades de 21 Millions

Fecha: 31/10/2026. Estado: levantamiento inicial; ninguna capacidad verificada directamente en sandbox. Alcance: ARS/USDC para el segmento que se confirme.

[Índice del paquete](README.md) · [Requisitos de origen](REQUERIMIENTOS_FUNCIONALES_INICIALES.md) · [Guion de verificación](GUION_PRUEBAS_SANDBOX.md)

## 1. Evidencia y condición de inclusión

La unidad de verificación es una capacidad para un segmento, moneda, red y ambiente. Que una operación funcione con un titular no demuestra soporte para comercios, otras redes o producción.

| Nivel | Evidencia requerida | Qué permite afirmar |
|---|---|---|
| E0 | Necesidad de MidatoPay o propuesta sin documentación directa | Capacidad por investigar. |
| E1 | Referencia indirecta del plan anterior | Dato preliminar que requiere cotejo. |
| E2 | Documentación vigente identificada, operación y condiciones localizadas | Soporte documentado; todavía sin prueba ni habilitación confirmada. |
| E3 | Habilitación confirmada para MidatoPay en el ambiente y segmento específicos | Capacidad autorizada para intentar la prueba bajo sus condiciones. |
| E4 | Prueba ejecutada con evidencia de resultado y límites conocidos | Capacidad demostrada en ese sandbox, para ese alcance. |

Los niveles son acumulativos. Una prueba aislada sin documentación o alcance confirmado no alcanza E4. La fecha y versión forman parte de la evidencia.

Para construir el adaptador pueden usarse capacidades E2/E3, manteniendo deshabilitada su exposición ordinaria. Un recorrido se presenta como integrado y demostrado cuando todas sus dependencias obligatorias alcanzan E4. Un escenario simulado se registra por separado y no eleva este nivel.

## 2. Inventario funcional

En todas las filas la habilitación para MidatoPay y la disponibilidad en sandbox están **sin confirmar**. «Sin mapear» significa que no se conoce la operación de API; no se inventa una ruta o un método HTTP.

| ID | Capacidad a verificar | Requisitos de origen | Evidencia actual | Operación API | Disposición para esta etapa |
|---|---|---|---|---|---|
| CAP-01 | Autenticación del partner y alcance de sus credenciales | AC-02, OP-02 | E0 | Sin mapear | Prerrequisito de toda conexión. Separar de login del usuario MidatoPay. |
| CAP-02 | Alta y KYC de persona; consulta de resultado | AC-01, ID-01, ID-03, AD-01 | E0 | Sin mapear | Obligatoria si el segmento inicial es persona. |
| CAP-03 | Alta y KYB de entidad, representantes y beneficiarios finales | ID-02, ID-03, AD-01, AD-02 | E0 | Sin mapear | Obligatoria si el segmento inicial es comercio con ese tipo de titular. |
| CAP-04 | Apertura/vinculación de cuenta y sujeto alcanzado por unicidad | CT-01, CT-03, AD-02 | E1: unicidad CUIT/CUIL por partner referida por el plan; apertura sin verificar | Sin mapear | Obligatoria; resolver cuenta individual u otro modelo antes de implementarlo. |
| CAP-05 | Saldos por moneda, disponibilidad y actualización | CT-02 | E0 | Sin mapear | Obligatoria; no inferir saldo disponible desde saldo total. |
| CAP-06 | Datos e instrucciones para recibir ARS | IN-01 | E0 | Sin mapear | Obligatoria para el ciclo candidato; no asumir CVU/CBU/alias. |
| CAP-07 | Consulta de movimientos y detección de depósitos por consultas periódicas | IN-02, HI-01, OP-07 | E1: consultas periódicas según el plan | Sin mapear | Obligatoria para detectar ingresos y conciliar; verificar cobertura y referencias. |
| CAP-08 | Cotización ARS → USDC y condiciones de precio | CO-01 | E0 | Sin mapear | Obligatoria para conversión del ciclo candidato. |
| CAP-09 | Ejecución y resultado de conversión ARS → USDC | CO-02 | E0 | Sin mapear | Obligatoria para el ciclo candidato; verificar ambas contrapartidas. |
| CAP-10 | Cotización y ejecución USDC → ARS | CO-01, CO-02 | E0 | Sin mapear | Condicional; verificar por separado de CAP-08/CAP-09. |
| CAP-11 | Transferencia/retiro ARS a destino admitido | TR-01, TR-03, TR-05 | E0 | Sin mapear | Una salida candidata; no presuponer envíos internos o externos equivalentes. |
| CAP-12 | Datos y detección de ingreso USDC, red y confirmación | IN-01, IN-03 | E0 | Sin mapear | Extensión condicional; nunca asumir redes del producto Arc existente. |
| CAP-13 | Transferencia/retiro USDC, red, costos y resultado | TR-02, TR-03, TR-05 | E0 | Sin mapear | Otra salida candidata; verificar admisión por red y destino. |
| CAP-14 | Consulta de resultado por identificador/referencia, incluido resultado incierto | TR-03, CO-02, OP-08 | E0 | Sin mapear | Prerrequisito del seguimiento de escrituras; verificar búsqueda cuando no se recibió un ID externo. |
| CAP-15 | Idempotencia nativa para instrucciones financieras | TR-03, CO-04, OP-08 | E0 | Sin mapear | Garantía a investigar; documentar alcance, retención y reuso. Si no existe, aplicar tratamiento conservador descrito en arquitectura. |
| CAP-16 | Límites, costos, precisión, redondeos y reservas | TR-05, CO-01, OP-09 | E0 | Sin mapear | Obligatoria por canal; no asumir consulta dinámica de todos estos datos. |
| CAP-17 | Evidencia/comprobante de ejecución y detalle histórico | TR-04, HI-01, AD-05 | E0 | Sin mapear | Obligatoria para mostrar resultados; diferenciar recibo del proveedor y constancia de MidatoPay. |
| CAP-18 | Cierre, disposición del saldo y exportación histórica | CT-04, AD-10 | E0 | Sin mapear | Documentar dependencia; fuera de las pantallas iniciales de escritura. |
| CAP-19 | Representantes, equipos y permisos nativos | EQ-01, EQ-02, EQ-03 | E0 | Sin mapear | Fuera del primer recorrido; no asumir roles provistos por 21M. |
| CAP-20 | Conversión automática nativa o autorización para instruirla | CO-03, CO-04, AD-07 | E0 | Sin mapear | Fuera del primer recorrido; se empieza por conversión manual. |
| CAP-21 | Cobro QR | IN-05 | E1: futura según el plan | Sin mapear | Excluida hasta documentación y habilitación actualizadas. |
| CAP-22 | Webhooks | IN-02, NO-01 | E1: futura según el plan | Sin mapear | Excluida como dependencia inicial; conservar consultas periódicas. |
| CAP-23 | Programación y pagos por lotes nativos | AD-06 | E1: no documentados según el plan | Sin mapear | Excluida; no se construye programación propia en esta etapa. |
| CAP-24 | Restricción/congelamiento de fondos y levantamiento | OP-06, AD-08 | E1: sin función documentada atribuida en el plan | Sin mapear | No ofrecer controles sobre fondos; restringir app no equivale a congelar saldo. |
| CAP-25 | Validación de titularidad del destino | TR-01, TR-02, TR-06 | E1: sin función documentada atribuida en el plan | Sin mapear | No prometerla; verificar restricciones de destinos antes de habilitar salidas. |

## 3. Correspondencia con casos y evidencia esperada

| Capacidades | Caso de uso | Pruebas previstas | Evidencia mínima a buscar |
|---|---|---|---|
| CAP-01 | CU-01 | SB-01, SB-02, SB-24 | Configuración sandbox confirmada, autenticación y separación por titular. |
| CAP-02, CAP-03 | CU-02 | SB-03, SB-04 | Datos de prueba, estados y trazabilidad de aprobación o revisión. |
| CAP-04 | CU-03 | SB-05 | Titular, cuenta, moneda y respuesta ante solicitud duplicada. |
| CAP-05 | CU-04 | SB-06, SB-20 | Saldo reportado, semántica de disponibilidad y fecha de observación. |
| CAP-06, CAP-07 | CU-05, CU-10, CU-12 | SB-07, SB-08, SB-22, SB-23 | Depósito acreditado, movimiento estable y consulta repetida sin duplicación. |
| CAP-08, CAP-09, CAP-16 | CU-06 | SB-09, SB-10, SB-11, SB-12, SB-28, SB-29 | Condiciones aceptadas y débitos/créditos/costos de la conversión. |
| CAP-10 | CU-06 | SB-25 | Evidencia propia de USDC → ARS, si se incluye. |
| CAP-11, CAP-25 | CU-07 | SB-13, SB-12, SB-28 | Destino admitido, autorización, débito y resultado comprobado. |
| CAP-12 | CU-08 | SB-14, SB-16 | Red, instrucciones y criterio de acreditación confirmado. |
| CAP-13, CAP-25 | CU-09 | SB-15, SB-16, SB-28 | Red/destino admitidos, costo, monto recibido y resultado. |
| CAP-14, CAP-15 | CU-11 | SB-17, SB-18, SB-19, SB-21, SB-27 | Referencia estable, resultado tras respuesta incierta y semántica de reintentos. |
| CAP-17 | CU-10 | SB-23 | Diferencia entre solicitud y ejecución; detalle sin datos de otros titulares. |
| CAP-18 a CAP-24 | Fuera o soporte futuro | SB-30 | Funciones no habilitadas y límites comunicados; sin afirmación de soporte nativo. |

SB-26 prueba la separación de adaptadores propios. No verifica una capacidad de 21M. SB-30 comprueba que funciones no habilitadas no puedan ejecutarse aunque se invoque el backend directamente.

## 4. Ficha que debe completarse por capacidad

| Campo | Valor inicial o regla |
|---|---|
| ID de capacidad, segmento, moneda, red y ambiente | Completar por combinación; no reutilizar confirmación de otro alcance. |
| Documento y versión, origen y fecha de consulta | Pendiente; distinguir OpenAPI compartido de versión vigente. |
| Operación documentada | Pendiente: método/ruta o referencia del proveedor, parámetros y respuestas relevantes. |
| Disponibilidad nativa o tarea de MidatoPay | Pendiente; explicitar si requiere construir lógica propia y si está autorizada. |
| Habilitación MidatoPay | Pendiente: alcance y evidencia de la confirmación. |
| Sandbox | Pendiente: URL confirmada, datos de prueba, simulación de ingresos/fallas y diferencias con producción. |
| Límites y costos | Pendiente: por operación, moneda, segmento y horario si corresponde. |
| Dinero y estados | Pendiente: precisión, saldos afectados, reservas, redondeo, estados finales y restituciones. |
| Duplicados y resultados inciertos | Pendiente: identificadores, búsqueda, idempotencia, vencimiento y procedimiento de soporte. |
| Evidencia de prueba | Sin ejecutar: referencia SB, fecha, responsable, IDs de prueba, resultado y observaciones depuradas. |
| Nivel alcanzado y decisión | E0/E1 según inventario; incluir, condicionar o excluir con motivo y responsable. |

## 5. Responsables y orden de resolución

Producto selecciona el segmento y el recorrido. La relación con 21M obtiene documentación y alcance habilitado; Ingeniería mapea operaciones y garantías; Finanzas valida saldos, costos y contrapartidas; Operaciones valida seguimiento y diferencias.

Primero se verifican CAP-01, CAP-02 o CAP-03, CAP-04, CAP-05, CAP-06, CAP-07 y CAP-14. Luego CAP-08/CAP-09 y al menos una salida CAP-11/CAP-13, con CAP-15/CAP-16/CAP-17 según el riesgo y las garantías disponibles.

Si falta un paso del ciclo, el resultado puede ser una demo parcial identificada. No se declara completada una billetera integrada ARS/USDC.

## 6. Fuentes

La fuente funcional es el [documento inicial](REQUERIMIENTOS_FUNCIONALES_INICIALES.md) y la instrucción del CTO de limitar esta etapa a capacidades del proveedor. La [web oficial de 21M](https://www.21millions.com/en), consultada el 31/10/2026, describe oferta comercial y disponibilidad sujeta a onboarding y jurisdicción; no se usa como evidencia E2 de una operación API. La documentación técnica, confirmaciones de habilitación y evidencias de sandbox siguen pendientes.


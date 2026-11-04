# Alcance funcional del mock y la integración sandbox

Fecha: 31/10/2026. Estado: propuesta lista para revisar; implementación y pruebas pendientes.

[Índice](README.md) · [Capacidades](MATRIZ_CAPACIDADES_21M.md) · [Casos y aceptación](CASOS_USO_ESTADOS_ACEPTACION.md)

## 1. Objetivo y resultado esperado

Construir una experiencia de billetera ARS/USDC que permita recorrer alta o vinculación, consulta de saldo, ingreso ARS, conversión manual a USDC y al menos una salida habilitada, con historial y seguimiento del resultado. La disponibilidad del proveedor determina qué tramos pueden integrarse.

Este alcance reduce el catálogo inicial para un prototipo verificable. Los P0 del documento base se refieren a primera operación con fondos reales; no convierten todas esas funciones en trabajo obligatorio de este mock. Se conservan los requisitos para producción y los acuerdos de producto sobre personas/comercios, equipos y conversión automática opcional.

## 2. Segmento y titularidad

Se implementará primero un segmento confirmado por 21M: persona o comercio, con un titular y un operador autorizado. La selección está pendiente en DEC-01. No se presupone soporte minorista por una oferta comercial dirigida a empresas.

Antes de conectar altas se debe confirmar:

- Quién contrata, quién posee el dinero y qué cuenta informa el saldo.
- Si existe cuenta individual por cliente u otro modelo. Una cuenta agregada del partner no puede presentarse como cuentas individuales sin respaldo; cambiar ese modelo requiere revisar alcance, registro de fondos y obligaciones.
- Cómo se vincula una identidad MidatoPay con el titular y la cuenta de 21M.
- A quién aplica la unicidad de CUIT/CUIL por partner.
- Qué persona puede operar por el titular y qué verificación lo habilita.

Si el sandbox solo dispone de cuentas precreadas, puede probarse una vinculación de cuentas de prueba. El alta/KYC quedará identificado como no demostrado.

## 3. Modalidades de trabajo

| Modalidad | Datos y ejecución | Uso | Qué demuestra |
|---|---|---|---|
| Simulación local | Identidades, fondos y resultados ficticios; adaptador simulador sin conexiones financieras | Validar UX, reglas propias, estados y errores | Comportamiento de MidatoPay bajo supuestos documentados. No verifica 21M. |
| Integración sandbox | Cuenta y operaciones de prueba de 21M, con configuración y alcance confirmados | Validar las capacidades disponibles | Resultado observado en ese sandbox; no demuestra producción. |

La modalidad pertenece a la cuenta, operación y evidencia. Cambiar de modalidad no transforma una operación simulada en una de sandbox. Ante una falla del sandbox no se sustituye silenciosamente por éxito simulado.

Se propone identificar el ambiente en la cabecera del prototipo y en las constancias de prueba. No se muestran controles de infraestructura ni credenciales en el recorrido del usuario.

## 4. Recorrido candidato y dependencias

| Paso | Resultado funcional | Capacidades requeridas | Caso | Inclusión |
|---|---|---|---|---|
| 1 | Acceso y titular/contexto válidos | CAP-01 y autorización propia de MidatoPay | CU-01 | Base propia obligatoria. Login y autenticación del partner son distintos. |
| 2 | Alta y verificación, o vinculación explícita de cuenta precreada | CAP-02 o CAP-03; CAP-04 | CU-02, CU-03 | Según segmento y sandbox. Vincular no acredita que se probó el alta. |
| 3 | Saldos por moneda e instrucciones ARS verificables | CAP-05, CAP-06 | CU-04, CU-05 | Base del ciclo integrado. |
| 4 | Ingreso ARS y detección por consulta periódica | CAP-07 | CU-05 | Base; sin webhook supuesto. |
| 5 | Cotización y conversión manual ARS → USDC | CAP-08, CAP-09, CAP-16 | CU-06 | Base si se confirma; sin esto la demo no prueba conversión ARS/USDC. |
| 6 | Salida por un canal admitido | CAP-11 o CAP-13, CAP-16 y restricciones de CAP-25 | CU-07 o CU-09 | Al menos una salida para declarar ciclo completo. |
| 7 | Resultado, movimientos y constancia | CAP-07, CAP-14, CAP-17 | CU-10, CU-11 | Base; no sustituir ejecución por solicitud aceptada. |
| 8 | Seguimiento de pendientes y conciliación mínima | CAP-05, CAP-07, CAP-14 | CU-12 | Base operativa para demostrar resultados y diferencias. |

Si la única salida admitida es ARS después de convertir a USDC, también se necesita CAP-10 para volver a ARS. Una salida ARS realizada antes de la conversión no demuestra disposición del saldo USDC.

Extensiones condicionales: recibir USDC (CAP-12), salida USDC si se eligió inicialmente ARS (CAP-13), conversión inversa (CAP-10) y salida ARS si se eligió inicialmente USDC (CAP-11). Cada una se valida por separado, incluidas redes y tipos de destino.

CAP-14 y el tratamiento de CAP-15 condicionan las escrituras. Si no existe forma suficiente de determinar qué ocurrió, se podrá demostrar la revisión manual en simulación, pero no declarar resuelto el recorrido financiero integrado.

## 5. Pantallas propuestas

| Pantalla | Información y acciones | Casos | Estados que debe cubrir |
|---|---|---|---|
| Acceso y contexto | Acceso, titular, cuenta y ambiente de prueba | CU-01, CU-03 | Sin sesión, no autorizado, pendiente de vinculación, listo. |
| Verificación | Datos y documentación admitidos, estado y siguiente paso | CU-02 | Requerido, enviado, revisión, habilitado, rechazado o no demostrado. |
| Inicio | ARS y USDC separados, actualización y accesos a operaciones habilitadas | CU-04 | Disponible, pendiente de actualización, sin información, restricción confirmada. |
| Recibir | Instrucciones por moneda/red confirmada y movimiento recibido | CU-05, CU-08 | Sin instrucciones, listo para recibir, pendiente, acreditado, revisión. |
| Convertir | Origen, destino, cotización, neto, costos, vigencia y confirmación | CU-06 | Cotizando, cotización válida, vencida, enviando, pendiente, resultado o revisión. |
| Enviar/retirar | Destino permitido, moneda/red, importe, costos y confirmación | CU-07, CU-09 | Datos incompletos, listo, saldo/límite insuficiente, enviando, resultado o revisión. |
| Actividad y detalle | Movimientos, operación relacionada, estado, referencias y constancia | CU-10, CU-11 | Vacío, cargando, pendiente, completado, rechazado, fallido, resultado incierto. |
| Vista operativa mínima | Pendientes, detalle de intentos, última consulta, diferencias y responsable | CU-12 | Sin diferencias, pendiente de datos, diferencia abierta, resolución documentada. |

Las acciones de una capacidad no habilitada se ocultan o se muestran no disponibles con explicación comprensible. El backend aplica el mismo control. La vista operativa es de consulta y gestión de casos; no permite editar saldos ni declarar ejecución sin evidencia.

## 6. Reglas funcionales comunes

1. Toda operación pertenece a un titular, cuenta, proveedor y ambiente y requiere autorización vigente.
2. El saldo financiero proviene de información de 21M; una intención local no acredita dinero ni equivale a reserva del proveedor.
3. Antes de confirmar se muestran monto, moneda, red si aplica, costos y neto. Si faltan condiciones necesarias, no se habilita confirmar.
4. Un doble clic o reenvío de la misma intención recupera la misma operación interna. Dos pagos legítimos iguales pueden ser operaciones distintas.
5. Una respuesta incierta mantiene seguimiento y revisión; no genera un segundo envío automático sin garantías verificadas.
6. Solo se comunica ejecución con evidencia concluyente. Una falla no implica por sí sola que el saldo fue restituido.
7. Los fondos simulados, los de sandbox y los del producto existente permanecen diferenciados.
8. Se conservan referencias y evidencia suficiente para explicar cada resultado sin exponer secretos ni documentación sensible.

## 7. Disposición de los diez temas adicionales

| Tema del catálogo inicial | Tratamiento en el mock |
|---|---|
| AD-01 — elegibilidad | Requisitos del segmento elegido y datos de prueba; validación de habilitación real pendiente con 21M. |
| AD-02 — titular/entidad/usuario | Identificación y autorización mínimas obligatorias; múltiples contextos y doble representación fuera hasta resolver el modelo. |
| AD-03 — venta/cobro | Fuera: se trabaja con depósitos y referencias de movimientos, sin conciliación comercial por venta. |
| AD-04 — devolución comercial | Fuera: se prueba seguimiento de fallas y restituciones informadas, sin ofrecer reversión de un cobro. |
| AD-05 — documentación | Historial y constancias mínimas; resúmenes contables y tratamiento impositivo fuera de la UI inicial. No se consideran resueltos para producción. |
| AD-06 — proveedores/lotes | Fuera: sin agenda de proveedores, programación ni lotes. |
| AD-07 — cambios de condiciones | Aceptación de cada cotización y condiciones mostradas; gestión de cambios contractuales y automatismos fuera. |
| AD-08 — representación extraordinaria | Fuera del autoservicio; registrar dependencia del procedimiento de soporte, sin controles de disposición extraordinaria. |
| AD-09 — accesibilidad | Lectura, etiquetas, navegación y confirmaciones comprensibles en las pantallas incluidas; alternativas de KYC sujetas al proveedor. |
| AD-10 — migración/salida | Sin migrar usuarios o fondos existentes; documentar límites de retiro/cierre y usar cuentas de prueba separadas. |

También quedan fuera equipos con aprobaciones complejas, conversión automática, QR, webhooks, tarjetas, crédito, rendimientos, nuevas monedas y enrutamiento entre proveedores. Los controles propios de autenticación, autorización, trazabilidad y protección de datos siguen siendo necesarios.

## 8. Criterios de avance y cierre

| Hito | Condición de salida | Resultado admisible |
|---|---|---|
| Alcance revisable | Segmento, recorrido y dependencias identificados; dudas registradas | Este documento y la matriz preparados. |
| Mock local | Casos seleccionados implementados con simulador, estados y pruebas propias | Demo funcional simulada, sin afirmar soporte de 21M. |
| Consultas sandbox | Evidencia de acceso, cuenta, saldo y movimientos para el alcance confirmado | Demo integrada de consulta. |
| Escrituras sandbox | Condiciones, autorización, resultado, prevención de duplicados y recuperación verificados | Demo de conversión/salida con evidencia propia. |
| Ciclo completo | Ingreso ARS, conversión a USDC, disposición posterior por salida admitida e historial conciliado; pruebas obligatorias aprobadas | Mock integrado del ciclo definido. |

La producción queda fuera de estos hitos. Si una función no está en sandbox, se registra como no demostrada; una simulación útil no elimina esa brecha.

## 9. Pendientes que impiden fijar el alcance definitivo

DEC-01, DEC-02, DEC-03, DEC-04 y DEC-05 siguen abiertos. Se requieren contrato y documentación vigentes, segmento admitido, canales/redes, fondos de prueba, semántica de saldos/costos y recuperación de instrucciones inciertas. La ausencia de estos insumos limita la integración, pero no impide revisar los casos ni implementar un simulador identificado.


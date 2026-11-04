# Casos de uso, estados y criterios de aceptación

Fecha: 31/10/2026. Estado: especificación funcional propuesta; correspondencias con estados de 21M pendientes.

[Índice](README.md) · [Alcance](ALCANCE_MOCK_SANDBOX.md) · [Matriz](MATRIZ_CAPACIDADES_21M.md) · [Pruebas](GUION_PRUEBAS_SANDBOX.md)

## 1. Reglas comunes

| Regla | Comportamiento requerido |
|---|---|
| Titular y autorización | Acceso MidatoPay y credencial de partner son distintos. Todo recurso debe autorizarse por titular/cuenta en backend, incluso consultas y comprobantes. |
| Contexto financiero | Cuenta, proveedor, ambiente, activo y red cuando aplique acompañan cada instrucción y resultado. No se compensan saldos entre proveedores, cuentas o ambientes. |
| Información monetaria | Importes exactos con moneda y precisión confirmadas; costos pueden estar en otra moneda. Mostrar total debitado y neto recibido con la regla aplicable. No calcular dinero con aproximaciones binarias. |
| Saldo | Presentar fuente y actualización. Disponibilidad, restricciones y reservas solo cuando exista evidencia de su semántica. La comprobación local no garantiza saldo en el momento de ejecutar. |
| Confirmación | Requiere condiciones completas y autorización vigente; cambios materiales de monto, destino, red, costo o cotización invalidan aceptación previa. |
| Intención e intentos | Una intención tiene ID propio estable; varios intentos técnicos no crean varias operaciones de negocio. Un nuevo pago intencional puede tener igual importe y destino que otro anterior. |
| Reintentos | Reintentar una lectura no equivale a reintentar una escritura. Una escritura con respuesta incierta queda en seguimiento hasta conocer el resultado o tener garantía documentada para repetir la misma instrucción. |
| Resultado | Aceptación HTTP o de solicitud no prueba ejecución financiera. Una falla no prueba ausencia de débito ni restitución. |
| Evidencia | Conservar referencias y observaciones depuradas. No exponer credenciales, documentación de identidad ni datos de otros titulares. |
| Cobertura | Si una capacidad no está habilitada, no se ejecuta desde UI ni backend. El simulador no acredita disponibilidad de 21M. |

## 2. Estados propios y traducción pendiente

Los nombres siguientes son internos a MidatoPay. No son estados atribuidos a 21M. La traducción se completa con evidencia por tipo de operación; si un estado externo no se conoce, conservarlo y abrir revisión, sin inferir éxito o fracaso.

### 2.1. Identidad, cuenta y cotización

| Objeto | Estados internos propuestos | Regla |
|---|---|---|
| Verificación | No iniciada, requerida, enviada, en revisión, habilitada, rechazada, desconocida | Habilitada exige resultado aplicable al titular/segmento. Acceso a la app no habilita movimientos. |
| Cuenta | No vinculada, apertura pendiente, operativa, restringida, cerrada, desconocida | Alcance de restricción y operación permitida dependen de evidencia del proveedor. |
| Cotización | Solicitada, válida, vencida, sustituida, utilizada, desconocida | Si no se conoce vigencia o precio ejecutable no se presenta como cotización garantizada. Utilizada no implica conversión completada. |
| Lectura de saldo | Actualizada, desactualizada, no disponible | Fecha de observación no equivale a fecha de actualización del proveedor; distinguirlas cuando existan ambas. |

### 2.2. Operación financiera

| Estado | Origen o condición | Conducta del usuario y de Operaciones |
|---|---|---|
| Borrador | Preparación propia, sin envío | Puede editarse o descartarse. |
| Lista para confirmar | Datos y condiciones comprobados localmente | Puede autorizarse; volver a validar al enviar. |
| Enviando | Intención persistida, intento en curso | Deshabilitar reenvío de esa intención. Si se pierde respuesta, pasar a resultado incierto. |
| Pendiente | Evidencia de que el proveedor recibió la instrucción; resultado final no disponible | Consultar estado y mostrar progreso sin prometer ejecución. |
| Completada | Evidencia concluyente del resultado financiero requerido | Mostrar comprobante y movimientos; conciliar contrapartidas. |
| Rechazada | Evidencia concluyente de que esa instrucción no fue aceptada para ejecutar | Explicar causa disponible; verificar cualquier efecto sobre saldo. Una nueva intención requiere nueva autorización. |
| Fallida | Evidencia concluyente de fallo en ejecución | Seguir débitos/restauraciones; no dar por restituido el saldo automáticamente. |
| Resultado incierto | Timeout, pérdida de respuesta, referencia desconocida, estado externo no mapeado o evidencia contradictoria | Consultar y, si no alcanza, revisar con proveedor. No ofrecer reenvío automático. |

Se permiten transiciones directas a completada/rechazada/fallida cuando hay evidencia suficiente; no se exige observar todos los estados intermedios. Un error de transporte o una consulta «no encontrado» no demuestra rechazo. Una respuesta antigua no debe reemplazar evidencia más reciente; una contradicción se registra como incidencia, conservando el resultado previamente observado.

Los estados completada, rechazada y fallida son finales para la instrucción según la evidencia disponible. Si 21M documenta correcciones posteriores, se registran como nuevas observaciones o movimientos relacionados y se revisa la traducción. No se borra el historial.

El efecto monetario se controla por separado: sin efecto confirmado, débito observado, crédito observado, restitución pendiente/confirmada o efecto desconocido. Estas categorías pueden describir distintas monedas de la misma operación. Una operación completada con un movimiento faltante puede originar una diferencia de conciliación sin inventar la contrapartida.

## 3. Casos de uso

### CU-01 — Acceder y operar en un contexto autorizado

Actor: usuario MidatoPay. Origen: AC-02, CT-03, OP-02. Dependencia: CAP-01 para conexión del partner; autorización del usuario a cargo de MidatoPay. Pruebas: SB-01, SB-02, SB-24, SB-30.

Precondición: usuario identificado o recorrido de acceso disponible. Flujo: autenticar, resolver vínculo con titular/cuenta de prueba, comprobar permisos y cargar capacidades del contexto. Resultado: solo recursos autorizados quedan accesibles.

Criterios de aceptación:

- Dado un usuario sin vínculo con una cuenta, cambiar su identificador en una solicitud no permite leer saldo, historial ni comprobantes ni cursar acciones.
- Una credencial válida del partner nunca sustituye la autorización del usuario sobre el titular.
- Vencida o revocada la sesión, se impiden nuevas acciones; una operación ya cursada conserva seguimiento interno y no se elimina.

### CU-02 — Registrar y verificar al titular

Actor: solicitante o representante. Origen: AC-01, ID-01, ID-02, ID-03, AD-01, AD-02. Dependencias: CAP-02 o CAP-03. Pruebas: SB-03, SB-04.

Precondición: segmento, documentación y titularidad confirmados. Flujo: informar requisitos, recabar datos de prueba y aceptaciones, enviar por el mecanismo admitido y seguir resultado. Resultado: estado visible con siguiente paso; la habilitación no se presume.

Criterios de aceptación:

- Un expediente enviado o en revisión no se presenta como aprobado ni permite acciones no habilitadas.
- Un rechazo o pedido de información muestra el alcance comunicable y permite la subsanación que efectivamente admita el proveedor.
- En comercio se distinguen entidad, representante y usuario operador. Si el sandbox solo ofrece cuenta precreada, el alta se marca no demostrada.

### CU-03 — Abrir o vincular la cuenta

Actor: titular o representante habilitado; Operaciones para revisión. Origen: CT-01, CT-03, AD-02. Dependencia: CAP-04. Pruebas: SB-05.

Precondición: titular identificado y condiciones de apertura o vinculación confirmadas. Flujo: comprobar si ya existe vínculo, solicitar apertura o vincular cuenta de prueba por procedimiento autorizado, seguir estado y registrar identificadores. Resultado: cuenta y titular inequívocos.

Criterios de aceptación:

- Repetir una solicitud de apertura o vinculación no produce silenciosamente otra cuenta; una respuesta incierta se investiga antes de repetir.
- La unicidad de CUIT/CUIL se aplica al sujeto y alcance que confirme 21M; no se crean registros paralelos para eludirla.
- Una cuenta agregada no se muestra como cuenta individual de cliente sin modelo funcional y autorización comprobados.

### CU-04 — Consultar saldos

Actor: titular u operador autorizado. Origen: CT-02. Dependencia: CAP-05. Pruebas: SB-06, SB-20.

Precondición: cuenta vinculada. Flujo: consultar saldos, representar cada moneda con su semántica y registrar observación. Resultado: saldo legible con antigüedad y disponibilidad conocida.

Criterios de aceptación:

- ARS y USDC se muestran separados; USDC no se etiqueta como depósito bancario USD.
- Una falla de consulta conserva la última observación como desactualizada o informa indisponibilidad; nunca reemplaza por cero ni inventa actualización.
- No se habilita «enviar todo» o disponibilidad inferida si no pueden calcularse costos y fondos utilizables de forma comprobable.

### CU-05 — Recibir ARS y detectar acreditación

Actor: titular, pagador de prueba y Operaciones. Origen: IN-01, IN-02, IN-03. Dependencias: CAP-06, CAP-07. Pruebas: SB-07, SB-08, SB-22.

Precondición: datos para recibir confirmados y mecanismo sandbox de ingreso conocido. Flujo: mostrar instrucciones, generar ingreso por herramienta admitida del sandbox, consultar movimientos y seguir acreditación. Resultado: depósito visible una sola vez y saldo contrastable.

Criterios de aceptación:

- Mostrar instrucciones o la declaración del pagador no acredita dinero. Se requiere evidencia del proveedor.
- Consultas repetidas, páginas superpuestas o reinicio del seguimiento no duplican el movimiento. Referencias iguales con contenido contradictorio abren diferencia.
- Importe y moneda del movimiento reflejan el ingreso observado; los no identificados quedan en revisión sin asociarlos arbitrariamente a ventas.

### CU-06 — Cotizar y convertir manualmente

Actor: titular u operador habilitado. Origen: CO-01, CO-02. Dependencias: CAP-08, CAP-09, CAP-16 y seguimiento CAP-14/CAP-15. Para sentido inverso: CAP-10. Pruebas: SB-09, SB-10, SB-11, SB-12, SB-17, SB-18, SB-25, SB-28, SB-29.

Precondición: cuenta habilitada, sentido de conversión admitido y condiciones completas. Flujo: ingresar monto, consultar cotización, mostrar débito total/neto/costos/vigencia, aceptar, persistir intención, enviar y seguir resultado. Resultado: operación y movimientos vinculados o pendiente explicado.

Criterios de aceptación:

- Cotización vencida o condiciones modificadas requieren nueva aceptación; no se ejecuta bajo un precio nuevo silenciosamente.
- Saldo insuficiente, límite o precisión no admitida impiden confirmar o se muestran como rechazo comprobado, sin inventar crédito.
- La misma intención confirmada dos veces recupera la misma operación; si el envío queda incierto, no se genera otra conversión automática.
- Completar exige evidencia de ejecución y conciliación de débitos, créditos y costos; una contrapartida faltante se registra como diferencia.
- USDC → ARS se prueba por separado. No se infiere de que funcione ARS → USDC.

### CU-07 — Enviar o retirar ARS

Actor: titular u operador autorizado. Origen: TR-01, TR-03, TR-04, TR-05. Dependencias: CAP-11, CAP-14, CAP-16, CAP-17 y restricciones de CAP-25; CAP-15 según garantía disponible. Pruebas: SB-13, SB-12, SB-17, SB-18, SB-27, SB-28, SB-29.

Precondición: canal y destino admitidos, saldo y condiciones comprobables. Flujo: identificar destino, monto y costos, confirmar, persistir instrucción, enviar y seguir resultado. Resultado: solicitud distinguida de ejecución y fondos conciliables.

Criterios de aceptación:

- Se muestran datos del destinatario solo con su fuente real; no se afirma titularidad verificada si CAP-25 no la confirma.
- Cambiar destino, importe o costos invalida la autorización anterior.
- Rechazo, fallo o demora no se presentan como dinero recibido por el destino; restitución solo se anuncia con evidencia.
- Si falta saldo, límite o una condición necesaria, el backend impide el envío aunque se omita la UI.

### CU-08 — Recibir USDC por una red admitida

Actor: titular y pagador de prueba. Origen: IN-01, IN-03. Dependencias: CAP-12, CAP-07 si corresponde al mecanismo confirmado. Pruebas: SB-14, SB-16.

Precondición: activo, red, instrucciones y criterio de acreditación confirmados. Flujo: mostrar destino y red, producir ingreso solo por mecanismo sandbox autorizado, seguir estado y acreditar según evidencia. Resultado: movimiento de ingreso con contexto completo.

Criterios de aceptación:

- No se ofrecen redes no confirmadas ni se reutiliza la dirección del producto Arc existente por similitud.
- Una transacción enviada o un hash aportado por el usuario no bastan para afirmar saldo disponible en 21M.
- Si el proveedor usa identificadores adicionales al destino, se muestran como obligatorios. No se promete recuperación de fondos enviados por una red incorrecta.

### CU-09 — Enviar o retirar USDC

Actor: titular u operador autorizado. Origen: TR-02, TR-03, TR-04, TR-05. Dependencias: CAP-13, CAP-14, CAP-16, CAP-17 y restricciones de CAP-25; CAP-15 según garantía disponible. Pruebas: SB-15, SB-16, SB-17, SB-18, SB-27, SB-28, SB-29.

Precondición: activo, red, destino y canal habilitados. Flujo: ingresar datos, validar red y restricciones, mostrar monto recibido y costos por moneda, confirmar, enviar y seguir resultado. Resultado: salida comprobada o estado pendiente de resolución.

Criterios de aceptación:

- Una combinación de activo/red/destino no admitida se bloquea antes de enviar, incluido acceso directo al backend.
- El usuario conoce si el costo se suma al débito o se descuenta del monto recibido; no se asume gas ni patrocinio del producto existente.
- Referencia de proveedor y hash de red se distinguen. Aceptación del proveedor, emisión a red y finalización no se confunden si el canal los diferencia.

### CU-10 — Consultar actividad y comprobantes

Actor: titular u operador con consulta. Origen: HI-01, TR-04. Dependencias: CAP-07, CAP-17. Pruebas: SB-08, SB-23.

Precondición: contexto autorizado y datos disponibles. Flujo: filtrar actividad, abrir operación, consultar movimientos y compartir constancia con datos permitidos. Resultado: historial explicable y aislado por cuenta/ambiente.

Criterios de aceptación:

- Una conversión relaciona sus movimientos sin contar el crédito como un segundo ingreso comercial.
- Una operación pendiente tiene constancia de solicitud, nunca comprobante de ejecución.
- Paginar o refrescar conserva identidad de movimientos; otro usuario no obtiene el detalle o comprobante alterando una referencia.

### CU-11 — Recuperar una operación de resultado incierto

Actor: sistema de seguimiento y Operaciones; cliente consulta. Origen: TR-03, CO-02, OP-08, OP-13. Dependencias: CAP-14 y semántica de CAP-15. Pruebas: SB-17, SB-18, SB-19, SB-21, SB-27.

Precondición: intención persistida con un intento sin resultado concluyente. Flujo: consultar por referencias verificadas, registrar observaciones, resolver si hay evidencia o escalar. Resultado: una única intención seguida hasta resolución; no se infiere fracaso por silencio.

Criterios de aceptación:

- Si el proveedor aceptó pero se perdió la respuesta, recargar o reiniciar recupera la operación local pendiente.
- Solo se permite repetir técnicamente la instrucción con garantías documentadas aplicables a esa misma intención; si no existen, se mantiene revisión sin reenvío automático.
- «No encontrado», vencimiento de una clave de idempotencia o estado externo desconocido no habilitan por sí solos un envío nuevo.
- La resolución manual conserva evidencia y responsable; no puede declarar fondos restituidos o ejecución con una nota sin sustento del proveedor.

### CU-12 — Conciliar y gestionar diferencias

Actor: Finanzas y Operaciones autorizadas. Origen: OP-01, OP-03, OP-07, OP-08, OP-11. Dependencias: CAP-05, CAP-07, CAP-14. Pruebas: SB-22, SB-27, SB-29.

Precondición: fuente de saldos/movimientos, alcance temporal y referencias conocidos. Flujo: elegir cuenta y período, comparar operaciones/movimientos/costos con observaciones del proveedor, clasificar diferencia, asignar responsable y cerrar con evidencia. Resultado: reporte de coincidencias y pendientes.

Criterios de aceptación:

- Una comparación incompleta por páginas faltantes, fuentes de distinto corte o estados pendientes no se declara conciliada.
- Saldo inicial + movimientos netos + ajustes informados debe explicar saldo final por moneda, incluyendo costos y pendientes según semántica confirmada; las distintas monedas nunca se suman como si fueran una sola.
- Si no existe extracto o saldo de corte suficiente, se registra conciliación parcial, con su limitación.
- Corregir una diferencia no consiste en editar el saldo reportado. El cierre conserva fuente, motivo y evidencia verificable.

## 4. Ejemplo sintético para revisar aceptación

Los siguientes datos son exclusivamente del simulador; no describen tarifa ni cotización de 21M.

| Momento | ARS disponible ficticio | USDC disponible ficticio | Evidencia esperada |
|---|---|---|---|
| Inicio | 0 | 0 | Observación inicial. |
| Ingreso ARS | 10.000 | 0 | Movimiento de ingreso por ARS 10.000. |
| Conversión: débito total ARS 10.000, incluido costo ARS 100; neto USDC 5 | 0 | 5 | Cotización aceptada, resultado de conversión, principal ARS 9.900 y costo ARS 100 identificables sin doble conteo. |
| Retiro USDC: envío 4, costo adicional 1 USDC | 0 | 0 | Débito total 5 USDC, envío neto 4 y costo 1. |

Este ejemplo requiere una salida USDC. Si el canal real de salida es otro, se reemplaza el escenario y se calculan contrapartidas con las condiciones verificadas. Las observaciones ficticias no se mezclan con saldos de sandbox.

## 5. Cuándo un caso está demostrado

Un caso integrado requiere capacidades y condiciones verificadas, ejecución de las pruebas aplicables, resultados esperados observados y evidencia vinculada. Si una excepción solo pudo simularse, se declara cobertura propia de MidatoPay y brecha de validación con 21M. El guion define cómo registrar ambas.


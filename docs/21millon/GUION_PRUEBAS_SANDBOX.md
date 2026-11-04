# Guion de pruebas del mock y sandbox de 21 Millions

Fecha: 31/10/2026. Estado: preparado; ninguna prueba ejecutada. Este guion no contiene endpoints, credenciales ni resultados atribuidos a 21M.

[Índice](README.md) · [Capacidades](MATRIZ_CAPACIDADES_21M.md) · [Alcance](ALCANCE_MOCK_SANDBOX.md) · [Casos](CASOS_USO_ESTADOS_ACEPTACION.md) · [Arquitectura](ARQUITECTURA_ADAPTADOR_PROVEEDORES.md)

## 1. Objetivo y modalidad de evidencia

Demostrar el recorrido funcional seleccionado y su tratamiento de errores, distinguiendo:

- **Sandbox**: consulta o ejecución efectiva con 21M en el ambiente de prueba confirmado.
- **Simulada**: datos/resultados generados por el simulador local. Verifica la lógica propia bajo esos supuestos.
- **Híbrida**: operación real de sandbox más una falla local controlada, por ejemplo ocultar la respuesta para probar recuperación. Registrar qué parte fue real y qué parte inducida.
- **Documental**: revisión de contrato o condiciones. No equivale a ejecución.

Una prueba aprobada en simulación no demuestra soporte de 21M. Las pruebas inicialmente previstas para sandbox podrán quedar bloqueadas o tener cobertura parcial si el ambiente no reproduce el escenario.

## 2. Prerrequisitos

| Insumo | Condición necesaria | Estado inicial |
|---|---|---|
| Contrato y documentación | Versión vigente, operaciones mapeadas y garantías relevantes registradas | Pendiente. |
| Habilitación MidatoPay | Segmento, monedas, canales, redes y límites de prueba confirmados | Pendiente. |
| Ambiente | URL de sandbox y forma de autenticar confirmadas por 21M; configuración separada de producción | Pendiente; no se propone una URL por conjetura. |
| Credenciales | Acceso de prueba con permisos mínimos y secretos del lado servidor | Pendiente de comprobar; no se solicitan secretos en documentos o chat. |
| Datos de prueba | Titulares, documentos y destinos ficticios admitidos por el proveedor | Pendiente. |
| Fondos y generación de eventos | Cómo generar depósitos, obtener fondos de prueba y consultar resultados | Pendiente. |
| Casos de error | Mecanismo admitido para rechazo, revisión, saldo insuficiente y fallas, si existe | Pendiente. |
| Herramienta propia | App, adaptador, simulador y seguimiento persistente implementados | Pendiente; esta entrega es documental. |
| Evidencia | Ubicación restringida para registros depurados y responsables de evaluación | Por definir; no almacenar datos sensibles en Git. |

No se usarán cuentas, fondos ni credenciales del producto existente para suplir estos insumos. Las operaciones del guion son exclusivamente de prueba; el guion no habilita producción.

## 3. Datos de trabajo y orden

Preparar dos usuarios de prueba A y B, cada uno con contexto autorizado distinto; una cuenta del segmento seleccionado; destinos de prueba válidos para los canales incluidos; y el saldo necesario según costos y mínimos confirmados.

Para simulación local puede usarse el ejemplo monetario de CU-06/CU-09 en el documento de casos. Para sandbox se documentan los importes efectivos y condiciones ofrecidas, sin copiar tarifas ficticias.

Orden sugerido: SB-01/SB-02/SB-24; alta/vinculación; consultas; ingreso; conversión; salida elegida; resultados e historial; fallas y recuperación; conciliación; sustitución por simulador y capacidades deshabilitadas. Los casos que consumen saldo necesitan preparación propia para no depender accidentalmente de la ejecución anterior.

## 4. Escenarios y resultados esperados

Cada fila es una prueba independiente con referencias de trazabilidad. Todas comienzan en **sin ejecutar**.

| ID | Modalidad prevista y caso | Preparación y acción | Resultado esperado y evidencia |
|---|---|---|---|
| SB-01 | Sandbox + documental; CU-01 | Verificar configuración confirmada, autenticación del partner y consulta de recurso de prueba | Conexión solo a sandbox, ambiente visible y referencias depuradas. No aparecen secretos en cliente, red del navegador o logs públicos. |
| SB-02 | Propia con sandbox/simulador; CU-01 | Usuario A consulta y luego intenta usar cuenta, historial y operación de B por acceso directo al backend | Todos los recursos ajenos se deniegan sin efectos financieros; la credencial del partner no saltea autorización. Registrar cada recurso probado. |
| SB-03 | Sandbox; CU-02 | Enviar alta del segmento elegido con datos de prueba admitidos y consultar resultado | Titular y referencia vinculados; aprobación solo si la informa el proveedor. Si solo hay cuentas precreadas, marcar alta no demostrada. |
| SB-04 | Sandbox si se permite, en otro caso simulada; CU-02 | Generar expediente incompleto, revisión o rechazo con el mecanismo admitido | Estado y siguiente paso correctos; no habilitar movimientos por expediente enviado. Registrar qué estados no pudo generar el sandbox. |
| SB-05 | Sandbox + propia; CU-03 | Abrir/vincular cuenta, repetir la misma intención y consultar vínculo existente | Una vinculación inequívoca y sin apertura duplicada silenciosa. Evidencia del alcance de CUIT/CUIL por partner y manejo de respuesta incierta. |
| SB-06 | Sandbox; CU-04 | Consultar saldos de la cuenta por moneda con registros conocidos | ARS/USDC separados; precisión y disponibilidad según fuente. Registrar saldo de referencia y horas de observación/actualización cuando existan. |
| SB-07 | Sandbox; CU-05 | Obtener instrucciones ARS, generar depósito por herramienta admitida y consultar hasta su resultado | Acreditación solo con evidencia; registrar referencia, monto, moneda, movimiento y saldo posterior. Sin webhook supuesto. |
| SB-08 | Sandbox + propia; CU-05, CU-10 | Repetir consultas, recorrer páginas superpuestas y reanudar seguimiento del mismo depósito | Un solo movimiento por referencia estable y mismo resultado. Registrar cobertura y deduplicación sin usar importe/fecha como identidad. |
| SB-09 | Sandbox; CU-06 | Solicitar cotización ARS → USDC para un monto válido | Mostrar origen, destino, principal/costos, débito total, neto y vigencia real. Si faltan condiciones ejecutables, no habilitar confirmación. |
| SB-10 | Sandbox; CU-06 | Aceptar cotización vigente y ejecutar una conversión; seguir resultado | Una operación interna y resultado comprobado; registrar saldos antes/después, movimientos por ambas monedas y costos sin doble conteo. |
| SB-11 | Sandbox si se permite, en otro caso simulada; CU-06 | Dejar vencer cotización o cambiar condiciones después de mostrarlas y confirmar | Impedir uso de condiciones vencidas o pedir aceptación de las nuevas. No ejecutar bajo precio distinto sin consentimiento. |
| SB-12 | Sandbox si se permite, en otro caso simulada; CU-06, CU-07 | Intentar operación sin saldo suficiente o por encima de límite confirmado | No presentar ejecución ni saldo acreditado. Si el proveedor recibió la solicitud, seguir su resultado y efectos; no inferir ausencia de débito por error genérico. |
| SB-13 | Sandbox; CU-07 | Confirmar y cursar salida ARS hacia destino admitido; consultar resultado | Destino/importe/costos aceptados, débito y resultado probados. Si es la salida del ciclo posterior a USDC, ejecutar antes la conversión inversa de SB-25. |
| SB-14 | Sandbox condicional; CU-08 | Obtener instrucciones de USDC/red habilitada y generar ingreso mediante mecanismo admitido | Acreditación conforme a reglas verificadas. Registrar referencia de proveedor, hash si existe, red, monto y saldo; no usar fondos reales para cubrir falta de simulador. |
| SB-15 | Sandbox condicional; CU-09 | Preparar y cursar retiro USDC en red/destino admitidos | Débito total y neto coinciden con condiciones. Se distinguen referencia de operación, hash si existe y finalización informada. |
| SB-16 | Propia, complementada por sandbox solo si es seguro y admitido; CU-08, CU-09 | Probar red/activo/destino no habilitados antes del envío | Backend impide combinación no admitida y no invoca transferencia. No enviar fondos a una red incorrecta para fabricar un caso de prueba. |
| SB-17 | Propia con sandbox o simulador; CU-06, CU-07, CU-09, CU-11 | Doble clic y reenvío del mismo ID de intención; luego intentar mismo ID con contenido cambiado | Una operación y un envío autorizado; conflicto ante contenido distinto. Un pago deliberadamente nuevo de igual importe usa otro ID y no se confunde. |
| SB-18 | Híbrida si el mecanismo permite recuperar, en otro caso simulada; CU-11 | Tras una ejecución sandbox aceptada, ocultar respuesta y referencias externas a la aplicación con instrumento de prueba; reabrir y consultar por mecanismo documentado | Estado incierto recuperable sin envío adicional. Registrar qué garantía permitió buscar o repetir de forma segura. Si no se puede resolver, revisión documentada y brecha abierta; simulación no prueba idempotencia nativa. |
| SB-19 | Simulada + documental; CU-11 | Inyectar estado externo no mapeado, respuesta antigua o evidencia contradictoria | No convertir desconocido en éxito/fallo ni degradar resultado con dato antiguo. Conservar estado original y abrir revisión si hay contradicción. |
| SB-20 | Híbrida/simulada; CU-04 | Interrumpir consulta de saldos después de una lectura válida | Mostrar antigüedad/no disponibilidad; no reemplazar por cero ni conservar apariencia de saldo actualizado. |
| SB-21 | Propia con sandbox o simulador; CU-11 | Reiniciar seguimiento o proceso con operación enviando/pendiente y volver a consultar | Recuperar contexto desde persistencia; no reenviar automáticamente. Seguimiento continúa aunque el usuario cierre sesión. |
| SB-22 | Sandbox + propia; CU-05, CU-12 | Conciliar un período con ingreso, conversión y salida; luego introducir dato faltante o cobertura incompleta en una copia de prueba | Por moneda se explica saldo inicial/final y costos; abrir diferencia o conciliación parcial ante datos faltantes. No editar saldo para cerrar. |
| SB-23 | Sandbox + propia; CU-10 | Consultar historial/detalle de operación pendiente y finalizada, paginar y compartir constancia | Constancia de solicitud distinta de ejecución; referencias y costos correctos; datos aislados por titular/ambiente. |
| SB-24 | Propia; CU-01 | Vencer/revocar sesión y revisar trazas, errores y configuración del cliente | Nuevas acciones denegadas, seguimiento financiero persistente y secretos/documentos sensibles ausentes de exposiciones. |
| SB-25 | Sandbox condicional; CU-06 | Cotizar y ejecutar USDC → ARS con evidencia separada | Conversión inversa probada por sus propios costos, estados y contrapartidas. Obligatoria si se usa para salir en ARS tras convertir a USDC. |
| SB-26 | Simulada + revisión de diseño | Ejecutar los mismos casos propios con manifiesto del simulador y con interfaz del adaptador sandbox, usando cuentas distintas | La UI y los casos de uso no dependen de rutas/códigos 21M; diferencias de soporte se respetan. No mueve ni migra fondos; resultados simulados no elevan evidencia de 21M. |
| SB-27 | Sandbox si es reproducible, en otro caso simulada; CU-07, CU-09, CU-11, CU-12 | Generar fallo con débito observado y restitución demorada o desconocida | Estado financiero y operativo separados; no anunciar restitución por el solo fallo. Registrar movimientos de restitución reales cuando existan. |
| SB-28 | Sandbox + pruebas propias; CU-06, CU-07, CU-09 | Probar mínimos, máximos y precisión según documentación, incluyendo un valor de precisión no admitida | Validar exactamente, no redondear silenciosamente y respetar costo por moneda. Registrar límites probados y los no alcanzables. |
| SB-29 | Sandbox si se admite, con simulación complementaria; CU-06, CU-07, CU-09, CU-12 | Confirmar dos intenciones concurrentes cuya suma supera fondos utilizables | Control de admisión y resultado del proveedor evitan prometer dos ejecuciones sin fondos; no liberar fondos pendientes por timeout. Conciliar efectos observados. |
| SB-30 | Propia + documental; CU-01 | Intentar capacidades no verificadas/excluidas desde UI y backend, incluidas QR, automatismos, lotes y controles sobre fondos | No ejecutar funciones no habilitadas. En modalidad de validación E3, solo permitir las pruebas controladas del alcance confirmado; no presentarlas todavía como demostradas. |

## 5. Registro inicial

| Pruebas | Estado inicial | Evidencia de ejecución |
|---|---|---|
| SB-01 a SB-30 | Sin ejecutar | No existe; guion documental preparado. |

Al ejecutar, registrar cada ID por separado. Si se realiza el mismo escenario en dos modalidades, generar dos resultados vinculados; no sustituir el resultado bloqueado de sandbox por el aprobado del simulador.

Estados de evaluación: sin ejecutar, aprobada, fallida, bloqueada o no aplica. «No aplica» exige justificación basada en alcance revisado, no en imposibilidad de conseguir evidencia de una dependencia obligatoria.

### Ficha de resultado

~~~text
ID de prueba:
Fecha y responsable:
Modalidad: sandbox / simulada / híbrida / documental
Proveedor y ambiente:
Segmento, cuenta de prueba, activo, red y canal:
Contrato/versiones revisadas:
Precondiciones e importes efectivos:
Pasos ejecutados:
Resultado esperado:
Resultado observado:
IDs internos y referencias externas depuradas:
Saldos y movimientos antes/después cuando corresponda:
Ubicación de evidencia restringida:
Parte real y parte simulada o inducida:
Estado y motivo:
Brecha/diferencia y responsable:
Capacidades cuya evidencia se actualiza:
~~~

Las credenciales y documentos de identidad no forman parte de esta ficha. Los comprobantes depurados identifican que son operaciones de prueba.

## 6. Evaluación de cierre

| Grupo | Condición |
|---|---|
| Acceso y cuenta | SB-01, SB-02, SB-05, SB-06 y SB-24 aplicables y aprobadas. SB-03/SB-04 si se incluye alta; de lo contrario declararla no demostrada. |
| Ciclo ARS → USDC | SB-07, SB-08, SB-09 y SB-10 aprobadas en sandbox; condiciones de SB-11/SB-12/SB-28 cubiertas con evidencia y limitaciones explícitas. |
| Disposición del saldo convertido | SB-15 aprobada si la salida es USDC; o SB-25 y SB-13 aprobadas si la salida requiere volver a ARS. |
| Seguimiento y controles propios | SB-17, SB-19, SB-20, SB-21, SB-24, SB-26, SB-29 y SB-30 aplicables y aprobadas en su modalidad declarada. |
| Recuperación financiera | SB-18 y SB-27 evaluadas; garantías y procedimiento suficientes para las escrituras incluidas, con evidencia del proveedor. Si solo hay simulación y falta esa evidencia, la recuperación integrada queda sin demostrar. |
| Historial y conciliación | SB-22 y SB-23 aprobadas con fuentes suficientes; diferencias abiertas o cobertura parcial impiden declarar conciliación completa. |
| Extensiones | SB-14/SB-16 y pruebas adicionales de canal/red cuando se incluyan ingresos o salidas cripto. |

Un fallo o bloqueo en dependencia obligatoria impide cerrar el hito afectado. Puede entregarse una demo parcial identificada con pendientes, sin declarar completo el ciclo ni toda la billetera.

El informe final de ejecución deberá indicar: alcance demostrado, capacidades E4 actualizadas, resultados reales frente a simulados, diferencias abiertas y responsables. Hasta ejecutarlo, el estado de este paquete sigue siendo preparación documental.

## 7. Diferencias sandbox/producción por confirmar

Solicitar a 21M qué cambia en verificación de titulares, liquidación y disponibilidad de fondos, redes, límites, costos, reservas, horarios, tiempos, soporte, referencias, volumen y controles de riesgo. Registrar si el sandbox completa operaciones de forma automática o simplifica fallas.

Ningún resultado de sandbox demuestra por sí mismo disponibilidad comercial, garantías de producción, cumplimiento regulatorio, seguridad completa o rendimiento a escala.


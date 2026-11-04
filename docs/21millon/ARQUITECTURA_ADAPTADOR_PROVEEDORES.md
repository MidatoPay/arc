# Arquitectura inicial y contrato del adaptador de proveedores

Fecha: 31/10/2026. Estado: propuesta de diseño para el mock; no implementada. Primer proveedor: 21 Millions en sandbox, sujeto a verificación.

[Índice](README.md) · [Capacidades](MATRIZ_CAPACIDADES_21M.md) · [Casos](CASOS_USO_ESTADOS_ACEPTACION.md) · [Pruebas](GUION_PRUEBAS_SANDBOX.md)

## 1. Objetivo y restricciones

Separar los casos de uso de MidatoPay de la semántica particular de 21M para poder integrar otro proveedor sin rehacer la app ni modificar operaciones históricas. Se empieza con un backend modular, un adaptador real y un simulador; no se requieren microservicios ni selección automática de proveedor.

El repositorio actual usa React/Vite, Netlify Functions y PostgreSQL según su README y package.json. Se propone conservar ese entorno para el primer prototipo, sujeto a verificar su adecuación para seguimiento persistente y ejecución programada. La entrega actual no agrega dependencias, módulos ni migraciones.

Las wallets Privy, Mercado Pago, Arc y la cotización del producto existente no constituyen una integración con 21M. Reutilizar componentes visuales o autenticación exige revisar su vínculo con el nuevo titular y cuenta. No se reutilizan fondos, direcciones, tesorería ni tarifas por defecto.

## 2. Límites y componentes

~~~mermaid
flowchart LR
  UI["App MidatoPay"] --> API["Backend: sesión, autorización y contexto"]
  API --> UC["Casos de uso de billetera"]
  UC --> DB[("Operaciones, vínculos y observaciones")]
  UC --> PORT["Contrato interno por capacidades"]
  PORT --> A21["Adaptador 21M"]
  A21 --> SB["21M sandbox"]
  PORT --> SIM["Simulador local"]
  FOLLOW["Seguimiento y conciliación persistentes"] --> UC
  OPS["Vista operativa autorizada"] --> API
~~~

| Componente | Responsabilidad | Límite |
|---|---|---|
| UI | Mostrar información, confirmar condiciones y consultar progreso | No posee secretos de 21M ni decide titularidad, saldo o ejecución. |
| Backend de acceso | Validar sesión, permisos y pertenencia de recursos; resolver cuenta y ambiente | El cliente no puede elegir un identificador externo arbitrario para operar otra cuenta. |
| Casos de uso | Aplicar reglas funcionales, persistir intención y consentimiento, coordinar envío y seguimiento | No conocen rutas, códigos ni formatos particulares de 21M. |
| Contrato interno | Expresar capacidades y resultados propios de MidatoPay | No obliga a todos los proveedores a soportar todo; no emula capacidades financieras ausentes. |
| Adaptador 21M | Autenticar partner, traducir datos, estados, errores y referencias según documentación verificada | No inventa éxito, saldo disponible, idempotencia ni validación de destinos. |
| Simulador | Producir escenarios ficticios deterministas usando el mismo contrato interno | No usa credenciales reales ni presenta sus resultados como evidencia de 21M. |
| Persistencia | Guardar vínculos, intención, intentos, referencias, observaciones y diferencias | Una observación local no reemplaza la fuente financiera del proveedor. |
| Seguimiento | Consultar pendientes y movimientos, deduplicar y conciliar, escalar diferencias | Debe continuar tras cerrar el navegador o reiniciar una función. |
| Vista operativa | Consultar pendientes y gestionar revisión con evidencia | No edita saldo ni fuerza ejecución o restitución sin respaldo. |

## 3. Decisiones de diseño propuestas

| ID | Decisión | Motivo y costo | Cuándo revisarla |
|---|---|---|---|
| ARQ-01 | Un proveedor asignado a cada cuenta; una operación conserva esa asignación | Facilita seguimiento y trazabilidad. No permite cambiar de proveedor para resolver una instrucción incierta. | Cuando exista un segundo proveedor con modelo contractual y de fondos verificado. |
| ARQ-02 | Capacidades opcionales y condicionadas por segmento, activo, red y ambiente | Evita esconder diferencias financieras detrás de una interfaz universal. Requiere revisar soporte por contexto. | Al incorporar una capacidad o proveedor. |
| ARQ-03 | Estados propios, estado original y procedencia preservados | Desacopla UI y permite investigar diferencias. La traducción debe mantenerse y probarse. | Ante cambios de contrato o estados desconocidos. |
| ARQ-04 | Intención persistida antes de invocar al proveedor | Permite recuperación, control de duplicados y auditoría. No elimina la incertidumbre de red. | Al conocer garantías nativas de cada operación. |
| ARQ-05 | Proyección local de operaciones y movimientos; proveedor como fuente de su saldo | Permite historial y conciliación sin inventar tenencia de fondos. | Si 21M solo ofrece cuenta agregada y MidatoPay debe mantener asignaciones financieras por cliente. |
| ARQ-06 | Consultas periódicas como mecanismo inicial | Corresponde a la evidencia indirecta del plan; requiere confirmar límites y cobertura. | Cuando webhooks estén documentados y habilitados. No reemplazar conciliación por notificaciones. |
| ARQ-07 | Simulador y sandbox separados por configuración y datos persistidos | Hace reproducibles las pruebas sin mezclar evidencia. Tiene costo de mantener fixtures y contrato. | Al ampliar cobertura; nunca mediante fallback silencioso. |

Si el modelo es de cuenta agregada, la proyección propuesta no basta para representar saldos individuales. Se deberá definir antes de habilitar varios titulares un registro financiero propio de asignaciones, reservas y movimientos, con sus controles y conciliación. No se resuelve con una columna de saldo editable.

## 4. Contexto e identificadores

Cada operación debe conservar:

- ID interno estable de la intención, titular, cuenta y usuario que la autorizó.
- Proveedor y ambiente resueltos desde el vínculo de cuenta, no desde datos libres del cliente.
- Tipo, activo, red cuando aplique, importes exactos y condiciones aceptadas.
- Identificador/referencia de cliente enviados solo si la operación documentada los acepta.
- Identificadores de operación y movimientos devueltos por el proveedor; hash de red separado cuando exista.
- Intentos, evidencia de respuesta o incertidumbre, estado original, estado normalizado y momento de observación.
- Información necesaria para retomar seguimiento y conciliar sin la sesión activa del usuario.

Un identificador externo se interpreta dentro de proveedor + ambiente + cuenta. Las consultas autorizan ese vínculo. No se asume unicidad global de IDs externos.

## 5. Modelo interno mínimo

| Concepto | Datos mínimos propuestos | Regla |
|---|---|---|
| Titular y vínculo de usuario | ID interno, tipo de titular, usuario, facultad y estado | Persona, entidad y representante se distinguen. La unicidad externa se confirma. |
| Vínculo de cuenta | ID interno, titular, proveedor, ambiente, ID externo y estado | Conserva procedencia; no migra implícitamente entre proveedores. |
| Importe | Activo, unidades enteras representadas como texto y escala confirmada | Exactitud para cálculo y almacenamiento; el adaptador valida escala y convierte al formato externo sin redondeo silencioso. |
| Activo y red | Identificadores propios y correspondencia externa verificada | Moneda contable y red de transferencia son conceptos diferentes. |
| Observación de saldo | Valor reportado, semántica, moneda, fuente, observación y actualización externa si existe | No inventar desglose disponible/reservado si el proveedor no lo informa. |
| Cotización | Origen/destino, principal, costo por activo, débito total, neto, vigencia, condiciones e ID externo si existe | Condiciones aceptadas inmutables para esa intención. |
| Operación | ID de intención, contexto, tipo, condiciones, estado, permisos y aceptación | Restricción de unicidad por intención; un nuevo pago legítimo requiere otra intención. |
| Intento de comunicación | Operación, momento, correlación, resultado de transporte y referencias depuradas | Un timeout queda registrado aunque no haya ID externo. |
| Movimiento observado | Referencia estable, cuenta, activo, monto con sentido, estado y vínculo si existe | No sintetizar unicidad solo con importe y fecha. |
| Diferencia de conciliación | Cuenta, período, evidencia, clase, responsable y resolución | No modifica saldos; conserva limitaciones de fuente y corte. |

Se propone PostgreSQL para durabilidad y unicidad de operaciones propias y movimientos cuando haya identificador estable. Los nombres anteriores son conceptos; no se está definiendo ni ejecutando un esquema de base.

Si 21M no brinda una referencia estable de movimiento, debe acordarse una clave de identidad comprobable. Dos transferencias del mismo importe y fecha no se deduplican por esa coincidencia.

## 6. Contrato interno propuesto

Los siguientes nombres son operaciones conceptuales de MidatoPay. No son métodos ni endpoints atribuidos a 21M. Sus parámetros exactos se cierran al mapear CAP-01 a CAP-17.

| Grupo | Operación conceptual | Entrada y resultado esperado | Condición |
|---|---|---|---|
| Capacidades | getCapabilities | Contexto → soporte por función, activo, red, segmento y ambiente, con restricciones y evidencia | Obligatoria en todo adaptador. |
| Identidad | submitOnboarding / getOnboarding | Titular/documentación admitida → referencia y estado, o resultado incierto | Solo si el proveedor y sandbox lo admiten. |
| Cuentas | openAccount / getAccount | Titular o cuenta vinculada → estado, ID y monedas admitidas | Apertura y vinculación son recorridos distintos. |
| Saldos | getBalances | Cuenta → observaciones por activo y semántica conocida | Fecha de observación y de saldo externo diferenciadas. |
| Ingresos | getDepositInstructions | Cuenta + activo/red → instrucciones verificadas | Nunca inventar datos para recibir. |
| Movimientos | listMovements | Cuenta + ventana/cursor admitido → movimientos, cobertura y continuación | Si falta cobertura, señalar parcialidad. |
| Conversión | quoteConversion | Cuenta + origen/destino/monto → condiciones completas y vigencia comprobable | Una cotización informativa no se convierte en ejecutable. |
| Conversión | executeConversion | Intención persistida + condiciones aceptadas → resultado de envío | No realiza reintentos de negocio ocultos. |
| Salidas | submitTransfer | Intención persistida + canal/destino/monto/costos aceptados → resultado de envío | ARS y USDC pueden usar mecanismos externos distintos. |
| Seguimiento | findOperation | Referencias que realmente admita el proveedor → observación, no encontrado o no consultable | No encontrado/no consultable no equivalen a rechazo. |
| Evidencia | getOperationEvidence | Operación → comprobante de proveedor o datos de ejecución disponibles | No se emite un comprobante nativo ficticio. |

Las operaciones opcionales no habilitadas devuelven una condición explícita y su motivo: soporte sin verificar, función no soportada según documentación o función no habilitada para el contexto. Se conservan esas diferencias y no se invoca un servicio alternativo para emularlas. Identidad, cuentas y saldos pueden estar separados en grupos internos sin convertirse en servicios independientes.

Resultado conceptual de una escritura:

~~~text
NoEnviada:
  motivo comprobable de validación/autorización/capacidad
  no se invocó la instrucción financiera

Enviada:
  referencia de proveedor, si fue devuelta
  observación normalizada, estado original y evidencia
  puede seguir pendiente; no implica ejecución

ResultadoIncierto:
  id de intención y del intento
  referencias conocidas, si existen
  motivo de incertidumbre y siguiente acción de consulta/revisión
~~~

Una respuesta de rechazo del proveedor pertenece a Enviada con estado rechazado y evidencia correspondiente. Un error genérico de servidor después de invocar no se clasifica como NoEnviada si no prueba que no hubo ejecución.

### 6.1. Manifestación de capacidades

El manifiesto guarda por contexto: nivel de evidencia, soporte documentado, habilitación de partner, disponibilidad en sandbox, validación realizada, límites/costos conocidos y garantías de consulta/reintentos.

Hoy las capacidades de 21M siguen pendientes de verificación. Durante validación controlada puede invocarse una capacidad E3 bajo sus condiciones para obtener E4; la demo ordinaria no la muestra como demostrada hasta completar esa evidencia. El simulador tiene un manifiesto propio y su estado no eleva el nivel de 21M.

Agregar otro proveedor implica agregar su adaptador y manifiesto. La UI consulta las funciones habilitadas del contexto; no depende de cadenas como nombres de rutas o códigos de 21M.

## 7. Flujo de una instrucción financiera

1. Backend resuelve cuenta/proveedor/ambiente y verifica usuario, permisos y capacidad.
2. Revalida condiciones, vigencia y saldo/limitaciones consultables. Esta lectura no reserva fondos en el proveedor.
3. Persiste atómicamente intención, condiciones aceptadas y control de envío; una solicitud repetida de esa intención recupera el registro existente.
4. Registra el intento antes de la comunicación. El adaptador traduce e invoca una vez por intento autorizado.
5. Guarda respuesta concluyente o estado incierto y programa seguimiento persistente.
6. Consulta resultado por mecanismo documentado; agrega observaciones sin degradar evidencia final con respuestas antiguas.
7. Relaciona movimientos y saldos; abre diferencias cuando falta evidencia o las contrapartidas no coinciden.

Un fallo entre los pasos 4 y 5 puede dejar al proveedor ejecutando una operación cuyo resultado local no se conoce. Por eso la persistencia propia no garantiza exactamente una ejecución externa.

### 7.1. Duplicados y reintentos

| Escenario | Decisión |
|---|---|
| Doble clic o reenvío del mismo comando del cliente | Mismo ID de intención, mismas condiciones → recuperar resultado existente; no volver a enviar. |
| Mismo ID con condiciones distintas | Rechazar conflicto. Solicitar una nueva intención y aceptación. |
| Dos pagos distintos con importe y destino iguales | Son posibles; requieren IDs y autorizaciones distintas. No deduplicar por contenido monetario. |
| Timeout y proveedor con idempotencia documentada aplicable | Consultar primero; repetir solo bajo las condiciones documentadas, misma clave y mismos datos, dentro del alcance y retención garantizados. |
| Timeout sin garantía suficiente | No reenviar automáticamente; mantener pendiente/revisión y escalar. |
| Clave vencida o consulta no encontrada | No prueba ausencia de ejecución; resolver antes de emitir una nueva instrucción. |
| Dos operaciones concurrentes usan el mismo saldo | Coordinar admisión local de instrucciones pendientes y verificar garantías de saldo/reserva del proveedor. Si no alcanza, limitar concurrencia o dejar la capacidad sin habilitar. |
| Reinicio del proceso | Reanudar seguimiento desde persistencia; no despachar automáticamente toda intención marcada como enviando. |

Las reservas internas de intención, si se implementan, sirven para controlar admisión propia. No se presentan como fondos congelados en 21M ni se suman al saldo del proveedor. Se definen expiración y liberación según resultados comprobables, evitando liberar por timeout una operación que pudo ejecutarse.

## 8. Consulta periódica y conciliación

La frecuencia, límites, paginación y cobertura de consultas se configuran con datos de 21M; no se fijan intervalos arbitrarios. El trabajo debe ejecutarse en un mecanismo persistente/programado adecuado al entorno, no depender de una pestaña abierta o de temporizadores en memoria.

Cada consulta registra cobertura y resultado. Los puntos de avance solo progresan tras procesar correctamente el tramo; si se reconsulta una ventana superpuesta, se deduplica por identidad estable. Deben contemplarse movimientos tardíos y correcciones; un cursor de API no demuestra por sí solo que nunca aparecerán cambios anteriores.

El seguimiento usa un único camino de normalización. Si luego se habilitan webhooks, aportarán observaciones a ese camino; la notificación no reemplazará verificación ni conciliación.

Para conciliar se necesita comparar el mismo corte por cuenta/activo y el neto de movimientos, costos y ajustes informados. Si 21M no entrega información suficiente de corte o estados, el reporte será parcial. Una suma local de movimientos no reemplaza el saldo autoritativo sin conocer el modelo financiero.

## 9. Errores, seguridad y observabilidad

La taxonomía interna propuesta distingue: entrada inválida, no autorizado, capacidad no habilitada, saldo insuficiente, límite excedido, cotización vencida, destino no admitido, indisponibilidad, resultado incierto y estado externo desconocido. Se asigna solo con evidencia; un error no reconocido queda como incidencia conservando su procedencia.

El backend protege recursos por titular y cuenta. Credenciales de partner, mecanismos de firma y configuración de sandbox permanecen del lado servidor; nunca se exponen en variables de frontend ni en comprobantes. La recuperación del login no modifica titularidad o representación.

Se registra correlación entre intención, intento y referencia externa, última observación, demora y diferencias. Se depuran cuerpos y errores para no registrar secretos ni documentos de identidad; la evidencia sensible requiere acceso y conservación definidos. Para el prototipo se usan datos ficticios admitidos por el proveedor.

Se propone verificar: aislamiento por cuenta/ambiente, persistencia ante reinicios, seguimiento sin sesión, respuestas fuera de orden y ausencia de datos sensibles en trazas. Las políticas completas de seguridad, continuidad y retención para producción siguen pendientes.

## 10. Extensión a otro proveedor y límites

Para agregar un proveedor se implementa el contrato interno, se completa su manifiesto, se documenta su traducción de estados y se ejecuta la misma batería propia, más pruebas de su sandbox. Puede soportar un subconjunto diferente.

Cambiar un adaptador en una prueba con cuentas distintas demuestra desacoplamiento de MidatoPay. No migra cuentas, identidad o fondos, ni garantiza que otro proveedor opere con el mismo contrato comercial.

Quedan fuera en esta etapa enrutamiento automático, agregación de saldos entre proveedores, conversión cruzada, reenvío de una operación incierta a otro proveedor y migración de cuentas. Estas capacidades requerirían nuevos requisitos sobre contratos, fondos y conciliación.

## 11. Verificación prevista

SB-02 verifica autorización; SB-17/SB-18/SB-21, intención y recuperación; SB-08, identidad de movimientos; SB-19, estados desconocidos; SB-22/SB-27/SB-29, conciliación, efectos financieros y concurrencia; SB-26, sustitución por simulador; SB-30, capacidades no habilitadas.

Pruebas de contrato propias y simulador son necesarias pero no certifican garantías financieras de 21M. No hay pruebas ejecutadas como parte de este diseño.

## 12. Referencias y razonamiento

La separación propuesta adapta el [patrón de capa de traducción entre sistemas de Microsoft](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer): mantener semántica interna y traducción externa en un componente delimitado. Es una elección de diseño para MidatoPay, sin obligación de usar Azure o microservicios.

El tratamiento conservador de reintentos toma como referencia [Making retries safe with idempotent APIs, de AWS](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): una respuesta perdida puede ocultar ejecución y la repetición requiere un contrato de idempotencia. Esta referencia no demuestra que 21M ofrezca esa garantía.

Referencias consultadas el 31/10/2026. Las capacidades particulares del proveedor dependen de la matriz y su evidencia pendiente.


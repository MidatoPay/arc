# Preparación de la billetera ARS/USDC con 21 Millions

Fecha: 31/10/2026. Estado: entregables de análisis preparados para revisión. Rama: `21millon`.

Este paquete permite pasar del mapa funcional al alcance del mock y, cuando se cuente con documentación y acceso, a pruebas de sandbox. La primera integración será 21 Millions; el diseño admite otros proveedores mediante adaptadores y capacidades explícitas.

## Orden de lectura y entregables

| Orden | Documento | Resultado concreto |
|---|---|---|
| Base | [Requerimientos funcionales iniciales](REQUERIMIENTOS_FUNCIONALES_INICIALES.md) | Acuerdos, catálogo amplio, propuestas y preguntas PD-01 a PD-21. |
| 1 | [Matriz de capacidades de 21M](MATRIZ_CAPACIDADES_21M.md) | Qué necesitamos, evidencia disponible, habilitación por confirmar y correspondencia con pruebas. |
| 2 | [Alcance funcional del mock](ALCANCE_MOCK_SANDBOX.md) | Recorrido candidato, pantallas, condiciones de inclusión y exclusiones de esta etapa. |
| 3 | [Casos de uso, estados y aceptación](CASOS_USO_ESTADOS_ACEPTACION.md) | Comportamiento esperado, reglas del dinero, excepciones y criterios verificables. |
| 4 | [Arquitectura y contrato del adaptador](ARQUITECTURA_ADAPTADOR_PROVEEDORES.md) | Límites de responsabilidad, modelo interno mínimo y extensión a otros proveedores. |
| 5 | [Guion de pruebas sandbox](GUION_PRUEBAS_SANDBOX.md) | Preparación, escenarios, evidencia, resultados esperados y criterio de cierre. |

También se agregó una [agenda de revisiones pendientes para el CTO](REVISION_PENDIENTES_CTO.md), con 20 temas, responsables y evidencia de cierre. Distingue decisiones del modelo de fondos y del mock de las necesarias antes de operar con fondos reales.

## Estado real de avance

| Frente | Estado al preparar estos documentos | Qué falta |
|---|---|---|
| Análisis funcional y diseño | Documentados como propuesta de implementación | Resolver decisiones y revisar con responsables. |
| Contrato de 21M | Referenciado como OpenAPI 1.0.0 por el plan original; contenido no disponible en este contexto | Obtener copia y versión vigente, alcance habilitado y documentación de sandbox. |
| Capacidades de 21M | Ninguna verificada directamente por API en esta tarea | Completar la matriz por segmento, moneda, red y ambiente. |
| Acceso a sandbox | Disponibilidad y configuración no verificadas | Confirmar URL, credenciales, cuentas de prueba y herramientas de simulación del proveedor. |
| App, adaptador y simulador | Diseño preparado; no implementados por esta entrega | Implementar las capacidades seleccionadas y sus controles. |
| Pruebas de sandbox | Todas sin ejecutar | Registrar evidencia de consultas y operaciones autorizadas exclusivamente de prueba. |

El usuario confirmó que el contrato no está en el repositorio. Los datos indirectos del plan —consultas periódicas de depósitos, unicidad de CUIT/CUIL por partner y QR/webhooks futuros— conservan esa condición. La oferta comercial pública de 21M no sustituye documentación técnica ni habilitación para MidatoPay.

## Decisiones para iniciar la implementación

| ID | Decisión o insumo | Responsable propuesto | Cómo se cierra |
|---|---|---|---|
| DEC-01 | Segmento inicial: persona o comercio | Producto + Operaciones + 21M | Elegir un segmento efectivamente admitido; resolver titular, representante y unicidad de CUIT/CUIL. |
| DEC-02 | Canales y ciclo completo de fondos | Producto + Finanzas + 21M | Confirmar ingreso ARS, conversión ARS → USDC y al menos una salida; indicar qué parte está disponible en sandbox. |
| DEC-03 | Documentación, acceso y datos de prueba | Responsable de integración + 21M | Completar evidencias y prerrequisitos del guion; guardar secretos fuera de documentos y navegador. |
| DEC-04 | Resultado incierto y prevención de duplicados | Ingeniería + Operaciones + 21M | Confirmar consulta de resultado y/o idempotencia documentada, incluidos alcance y vencimiento; definir procedimiento si no alcanza. |
| DEC-05 | Saldo, costos, precisión y conciliación | Finanzas + Ingeniería + 21M | Identificar fuentes y semántica verificable por moneda y operación. |
| DEC-06 | Alcance de implementación por capacidad | Producto + Ingeniería | Seleccionar filas de la matriz que hayan alcanzado la evidencia requerida. |

## Secuencia de ejecución propuesta

1. Completar la matriz con documentación y resolver DEC-01 a DEC-05 para las capacidades afectadas.
2. Implementar contrato interno, simulador local y pantallas del recorrido seleccionado con datos ficticios identificados.
3. Implementar consultas de 21M en sandbox y comprobar identidad, cuentas, saldos y movimientos.
4. Implementar conversiones y salidas admitidas, con seguimiento, autorización y tratamiento de resultado incierto.
5. Ejecutar el guion, contrastar estados y movimientos, y registrar límites del sandbox.
6. Revisar el alcance demostrado y decidir los pendientes; producción requiere evaluación independiente.

El simulador valida decisiones de producto y comportamiento propio. Una prueba simulada no verifica una capacidad de 21M. El paso a producción no queda autorizado ni validado por este paquete.

## Trazabilidad

Se conservan los identificadores del documento inicial. El paquete agrega CAP-01 a CAP-25 para capacidades, CU-01 a CU-12 para casos de uso, SB-01 a SB-30 para pruebas DEC-01 a DEC-06 para decisiones de esta etapa, ARQ-01 a ARQ-07 para diseño y REV-01 a REV-20 para la agenda del CTO.

No se modificaron código, configuración de servicios, bases ni el documento inicial como parte de la preparación de estos entregables.


# Plan de auditoría de seguridad y preparación para ISO 27001 y SOC 2

**Proyecto:** MidatoPay / Arc.  
**Fecha:** 2026-11-03.  
**Estado:** plan preparado; auditoría no iniciada.  
**Interpretación pendiente:** se interpreta «iso2007» como ISO/IEC 27001:2022. Si se pretendía otra norma, se ajustarán los criterios antes de evaluar cumplimiento.

## 1. Objetivo y resultado esperado

Evaluar la seguridad de ingeniería de `main`, identificar brechas frente a ISO/IEC 27001 y SOC 2 y producir un plan de hardening priorizado y verificable. La auditoría propondrá correcciones; implementarlas, desplegarlas y volver a validar será una etapa posterior.

Se emitirán conclusiones separadas sobre seguridad del software, diseño e implementación de controles y evidencia de operación. Una revisión del repositorio no demuestra por sí sola el cumplimiento de la organización. Este trabajo será una evaluación interna de preparación: no emitirá una certificación ISO ni un informe de atestiguamiento SOC 2.

## 2. Referencia y límites de la preparación

| Dato | Base del plan |
|---|---|
| Rama solicitada | `main` |
| Commit local de referencia | `367080912a5cb2319f21e9dc506589536f9aa2d5` |
| Fecha del commit | 2026-10-28, según Git |
| Referencia remota local | `origin/main` apunta al mismo commit; no se verificó el estado actual del servidor remoto |
| Rama activa al preparar | `21millon`; no se cambió de rama |
| Cambios preexistentes | Hay archivos locales sin seguimiento; quedan fuera de la base auditada y se preservan |
| Fuentes del proyecto consultadas | Inventario de rutas y `README.md`, `package.json`, `ARC-RULES.md`, `CLAUDE.md`, `docs/arc-migration/CURRENT_ARCHITECTURE.md` de `main` |

Solo se realizaron lecturas para delimitar el plan y consultas a fuentes oficiales de las normas. No se ejecutaron pruebas, escáneres, dependencias, migraciones, servicios ni operaciones de pago. No se revisó el código con fines de emitir hallazgos.

La arquitectura de partida es la que describe el README: React/Vite, Netlify Functions, PostgreSQL, Privy, Mercado Pago, USDC en Arc y cotización Chainlink en Ethereum. Se validará contra implementación y despliegue durante la auditoría. Los documentos de migración que describen Solana se tratarán como antecedentes hasta comprobar su vigencia.

## 3. Marcos y criterios

| Marco | Uso previsto |
|---|---|
| ISO/IEC 27001:2022 y Amd 1:2024 | Evaluar requisitos del sistema de gestión de seguridad de la información, cláusulas 4–10, y selección de controles del Anexo A. Incluir la consideración de la enmienda en el contexto organizacional |
| ISO/IEC 27002:2022 | Guía para evaluar la implementación de los controles seleccionados; no se tratará como certificación separada |
| SOC 2: TSC 2017, puntos de enfoque revisados en 2022 | Evaluar criterios comunes CC1–CC9 para Security y proponer Availability, Confidentiality y Processing Integrity por el servicio de pagos. Evaluar aplicabilidad de Privacy según datos, compromisos y alcance acordado |
| SOC 2: Description Criteria 2018, guía revisada en 2022 | Preparar la descripción del sistema, límites, compromisos, proveedores y responsabilidades del cliente |
| OWASP ASVS 5.0.0 | Referencia técnica complementaria: cobertura de nivel 2 y requisitos seleccionados de nivel 3 para administración, tesorería y firma. Cada requisito seleccionado tendrá identificador versionado |

Para ISO se preparará una Declaración de Aplicabilidad (SoA): cada uno de los 93 controles del Anexo A tendrá decisión de aplicabilidad, justificación, estado y evidencia. No se asumirá que todos son obligatorios ni que una exclusión elimina un requisito de las cláusulas 4–10. La matriz definitiva se cotejará con una copia autorizada de la norma completa.

Para SOC 2 se evaluará primero el diseño y la implementación a una fecha de corte, como preparación para Type I. La preparación para Type II requerirá además probar efectividad durante un período definido con el responsable y el auditor externo. No se inferirá operación histórica a partir de configuraciones actuales. Se propone examinar inicialmente los últimos 90 días disponibles para detectar brechas de evidencia; ese muestreo no fija el período de un futuro informe Type II.

## 4. Alcance

### Ingeniería y aplicación

- `src/`, `public/sw.js`, `public/manifest.webmanifest`, `index.html`: sesión, aprobación de operaciones, QR, voz, almacenamiento, cachés y exposición en el navegador.
- `netlify/functions/` y `netlify/functions/lib/`: endpoints, autenticación, autorización, aislamiento por usuario, workers, RPC, integraciones, tesorería y reportes.
- `db/schema.sql`, `db/migrations/`: integridad, transacciones, locks, aislamiento, retención y trazabilidad.
- `package.json`, `package-lock.json`, `deno.lock`, `scripts/`, `test/`: dependencias, procesos de construcción, controles automatizados y cobertura significativa.
- `netlify.toml`, `.github/workflows/`, `policy.yaml`, `.gitignore`, plantillas de variables: despliegue, permisos, secretos, separación de ambientes y cadena de suministro.
- Documentación operativa y de arquitectura vigente; consistencia con implementación y evidencias externas.

### Operación y organización

Configuración efectiva de GitHub, Netlify, PostgreSQL/Aiven, Privy, Mercado Pago y proveedores RPC; gestión de claves; acceso de administradores y colaboradores; cambios y despliegues; logs, alertas e incidentes; backup y recuperación; proveedores, personal, activos y gobierno del sistema de gestión.

La revisión de estos servicios utilizará evidencia entregada por sus responsables. No se accederá a consolas ni a infraestructura real en esta etapa de planificación. El código interno y la seguridad integral de terceros, de Arc, USDC o del contrato Memo quedan fuera; sí se revisarán las validaciones y supuestos de la integración.

## 5. Matriz inicial de trabajo

Los identificadores siguientes son correspondencias iniciales para organizar trabajo, no equivalencias ni conclusiones de cumplimiento. Se confirmará la aplicabilidad de cada control antes de evaluarlo.

| Área y rutas principales | Revisión y casos previstos | Evidencia esperada | ISO: referencias iniciales | SOC 2: referencias iniciales |
|---|---|---|---|---|
| Identidad y sesión: endpoints, `primaryWallet`, sesión RPC | Token inválido/expirado, identidad derivada en servidor, vinculación de wallet, recuperación de cuenta y revocación | Trazas del código; casos con identidades ficticias; configuración Privy y accesos | A.5.15–A.5.18, A.8.5 | CC6.1–CC6.3 |
| Autorización y aislamiento: cobros, contactos, perfiles, historial y reportes | Dos usuarios, recursos ajenos, roles admin, lectura y escritura, CSV y exportación de tesorería | Matriz endpoint × actor × acción; pruebas positivas y negativas | A.8.2–A.8.3, A.8.26 | CC6.1–CC6.3 |
| Tesorería y secretos: `treasuryPayout`, exportación, plantillas y build | Custodia, mínimo privilegio, exposición al frontend/logs, exportación, rotación y recuperación | Flujo de secretos; política de claves; configuración saneada; simulación sin fondos | A.5.3, A.8.2, A.8.12, A.8.24 | CC6.1–CC6.3, C1.1 |
| Mercado Pago: `charges`, webhook, `mercadopago`, `merchantPos` | Firma y replay, vendedor/POS/moneda/importe, consulta independiente al proveedor, cambios de estado, cancelaciones y pagos tardíos | Fixtures de eventos válidos e inválidos; invariantes de aceptación | A.8.26–A.8.29 | CC6.6, CC7.2–CC7.3, PI1.2–PI1.4 |
| Integridad monetaria: `paymentCore`, cotización y comisiones | Precisión 6/18 decimales, redondeos, límites, tasa vencida, reservas y conciliación; ausencia de dobles débitos o créditos | Casos límite y conciliación de registros ficticios | A.8.26–A.8.29 | PI1.1–PI1.5 |
| Firmas y transferencias: `transferChain`, `transferService`, `transferWorker`, cliente | Destino, monto, red, contrato y calldata; consentimiento; bytes firmados; nonce, replay y recibos | Fixtures de transacciones, firmas y recibos; comprobación del efecto real | A.8.24, A.8.26–A.8.29 | CC6.1, CC7.2, PI1.2–PI1.4 |
| Workers y concurrencia: dispatch, background, reconciliación | Autorización interna, idempotencia, ejecución simultánea, crash entre persistencia y broadcast, reintentos y revisión manual | Pruebas aisladas de interrupción y concurrencia; estados y registros | A.8.6, A.8.14–A.8.16 | CC7.2–CC7.5, A1.1–A1.3, PI1.3 |
| API, RPC, voz y QR | Allowlist RPC, SSRF, inyección, validación de entradas/salidas, límites de recursos, CORS, costo de parseo y confirmación del intento interpretado | Inventario de superficies; casos con entradas no confiables y mocks | A.8.20–A.8.22, A.8.26–A.8.29 | CC6.6–CC6.8, CC7.1 |
| Navegador y PWA | XSS, dependencias, política de contenido, tokens, caché privada, logout, service worker y actualización | Configuración y trazas; build aislado si es viable; evidencia de cabeceras del responsable | A.8.9, A.8.12, A.8.26 | CC6.1, CC6.6–CC6.8, C1.1 |
| PostgreSQL y datos | Queries parametrizadas, roles/TLS, locks, restricciones, consistencia, backups, borrado y minimización de datos en memos públicos | DDL; fixtures PGlite; configuración saneada; pruebas históricas de restauración | A.5.34, A.8.3, A.8.10–A.8.13, A.8.24 | CC6.1, C1.1–C1.2, A1.2–A1.3; Privacy si aplica |
| Cambios, dependencias y CI/CD | Protección de main, revisión, identidad de despliegue, permisos de workflows, integridad del lockfile y vulnerabilidades alcanzables | Configuración GitHub/Netlify; PR y despliegues muestreados; inventario de componentes | A.8.8–A.8.9, A.8.25, A.8.28–A.8.32 | CC6.8, CC7.1, CC8.1 |
| Detección y respuesta | Eventos de seguridad, integridad de logs, redacción, alertas, responsables y tratamiento de incidentes | Logs saneados; incidentes y ejercicios documentados; seguimiento de alertas | A.5.24–A.5.28, A.8.15–A.8.17 | CC4.1–CC4.2, CC7.2–CC7.5 |
| Continuidad y proveedores | Dependencias críticas, RTO/RPO, restauración, caída de RPC/DB/proveedor, límites de responsabilidad | BIA, planes, ensayos anteriores, contratos e informes de terceros con alcance y excepciones | A.5.19–A.5.23, A.5.29–A.5.30, A.8.13–A.8.14 | CC9.1–CC9.2, A1.1–A1.3 |
| Gobierno, personal y seguridad física | Contexto, liderazgo, riesgos, políticas, altas/bajas, formación, acceso físico y controles heredados del cloud | Políticas aprobadas; SoA; registro y tratamiento de riesgos; revisiones de dirección y auditoría interna | Cláusulas 4–10; A.5, A.6, A.7 según aplicabilidad | CC1–CC5, CC6.4–CC6.5 |

## 6. Secuencia de ejecución propuesta

| Fase | Actividad | Resultado y condición de salida |
|---|---|---|
| 0. Fijar base y alcance | Confirmar norma, commit, límites organizacionales, servicios, fecha de corte y categorías SOC 2. Si se actualiza desde remoto, registrar antes/después | Manifiesto de alcance; copia inmutable del commit; responsables y registro de evidencia pendiente |
| 1. Modelo del sistema | Inventariar endpoints, activos, datos y actores; diagramar navegador → API → DB/proveedores/red; distinguir instrucciones documentadas de controles verificados | Arquitectura, flujos de datos, amenazas y ledger de cobertura |
| 2. Revisión técnica | Revisión estática dirigida por riesgo sobre todas las áreas de la matriz; inventario de dependencias, secretos y controles de despliegue | Candidatos con ruta/línea del commit, frontera afectada y condición de explotación; sin declarar fallos por simples preferencias |
| 3. Validación | Corroborar cada candidato con revisión independiente y, cuando sea viable, reproducción mínima local; deduplicar por causa raíz y revisar huecos de cobertura | Hallazgos confirmados separados de hipótesis pendientes y candidatos rechazados |
| 4. Evaluación de controles | Contrastar implementación con política y evidencia; completar SoA y matriz SOC 2; examinar muestras históricas | Estado por control, referencias de evidencia, excepciones y brechas; diseño separado de operación |
| 5. Informe y hardening | Verificar registros finales, consistencia y cobertura; ordenar acciones por impacto y dependencia | Informe ejecutivo y técnico; backlog con responsables, prioridades, esfuerzo estimado y aceptación |
| 6. Etapa posterior de corrección | Tras la auditoría, implementar cambios acordados en rama separada y repetir verificaciones afectadas | Evidencia de corrección y riesgo residual. No se ejecuta como parte de este plan |

Perfil técnico propuesto: **deep**, por el manejo de fondos, firmas y claves. La ejecución seguirá el flujo de `security-audit`: reconocimiento, rondas de revisión según cobertura, validación independiente de candidatos, salida estructurada, verificación independiente final y reporte. El detalle de asignaciones se fijará al iniciar; este documento no inicia agentes ni rondas de auditoría.

Estimación inicial: 6–10 jornadas de trabajo para la evaluación interna, sujeta al tamaño real, candidatos y disponibilidad de evidencia. Las correcciones y la observación histórica requerida para un futuro Type II tienen calendario separado. Esta estimación no promete tiempo de certificación.

## 7. Evidencia a solicitar al iniciar

| Responsable funcional propuesto | Evidencia mínima |
|---|---|
| Dirección / responsable de seguridad | Alcance del SGSI, objetivos, políticas aprobadas, responsables, activos, análisis/tratamiento de riesgos, SoA, auditorías internas, revisión de dirección y acciones correctivas |
| Ingeniería / operación | Accesos y MFA; altas/bajas y revisiones; protección de ramas; PR, pruebas, aprobaciones y despliegues; configuración de ambientes y gestión de vulnerabilidades |
| Operación / datos | Roles DB, cifrado/TLS, retención, backups, última restauración comprobada, RTO/RPO, logs, alertas y registro de incidentes |
| Tesorería / producto | Custodia y rotación de claves, segregación de funciones, aprobación de exportaciones, conciliación, manejo de pagos fallidos, límites y procedimientos de emergencia |
| Proveedores / personal | Inventario y evaluación de proveedores, contratos y responsabilidades, informes aplicables, capacitación, compromisos de confidencialidad y controles de dispositivos/acceso físico |

Toda evidencia llevará ID, origen, responsable, fecha de captura, período cubierto, control asociado y restricciones de acceso. Se preferirán exportaciones saneadas con metadatos verificables. No se solicitarán claves privadas, tokens, valores de `.env`, datos personales completos ni credenciales. Los informes SOC de proveedores se evaluarán por servicio, período, excepciones y controles complementarios: no acreditan por sí solos a MidatoPay.

Muestreo inicial propuesto, ampliable si aparecen excepciones: totalidad de accesos privilegiados y sus cambios; totalidad de incidentes relevantes y cambios de claves del período; diez cambios/despliegues o todos si hay menos, distribuidos en el período e incluyendo emergencias; tres ejecuciones de cada control recurrente o todas si hay menos; al menos una restauración documentada. Se registrarán población, selección, cobertura temporal y limitaciones. La muestra no será una inferencia estadística ni sustituirá el criterio del auditor externo.

## 8. Reglas de validación técnica

La revisión de fuente será de solo lectura. Se trabajará con el commit fijado, excluyendo archivos locales ajenos. No se ejecutarán operaciones contra producción, mainnet, tesorerías, cuentas Mercado Pago, bases de datos ni identidades reales. Los casos usarán usuarios, importes, firmas, eventos, RPC y datos ficticios.

Antes de ejecutar cualquier código del proyecto deberá existir un sandbox impuesto por el sistema operativo: red externa bloqueada, entorno vacío con allowlist explícita, fuente/herramientas de solo lectura, escritura limitada al scratch asignado y límites de CPU, memoria, procesos, disco y tiempo. Un mock o `--offline` por sí solo no cumple ese aislamiento. Si no es posible garantizarlo, se continuará solo con análisis estático y se documentará la validación pendiente.

Las comprobaciones previstas son autenticación/autorización negativa, aislamiento entre dos usuarios, integridad monetaria, webhook/replay, firma y recibos, idempotencia/concurrencia y recuperación tras fallos. La suite existente y el build solo se ejecutarán después de revisar su comportamiento y asegurar aislamiento; no se instalarán dependencias ni se ejecutarán migraciones o scripts que carguen `.env` real. El análisis de vulnerabilidades contrastará versiones del lockfile con avisos oficiales mediante consultas independientes, sin ejecutar scripts del proyecto ni transmitir secretos o fuente privada.

Los artefactos de ejecución del flujo `security-audit` deberán alojarse fuera del árbol auditado, en una ubicación escribible y con separación de scratch y resultados retenidos. Este requisito se resolverá al iniciar la auditoría; el presente plan sí se guarda en `docs/` como documentación solicitada. No se realizarán cambios globales de Git, commits, pushes o despliegues para preparar o ejecutar la revisión.

## 9. Criterio de evaluación y prioridad

Cada control tendrá dos estados independientes:

- **Diseño e implementación:** adecuado con evidencia / parcial / brecha demostrada / sin evidencia suficiente / no aplicable con justificación.
- **Efectividad operativa:** demostrada durante el período / con excepciones / no evaluada / evidencia insuficiente.

La ausencia de evidencia en el repositorio se registrará como pendiente; no prueba que el control no exista. Las brechas organizacionales y las recomendaciones de hardening se reportarán separadas de vulnerabilidades explotables.

Cada hallazgo técnico confirmado incluirá: actor, entrada, control esperado, frontera cruzada, recurso afectado, ruta/línea y commit, condiciones, evidencia reproducible, impacto, severidad razonada, corrección mínima y prueba de aceptación. Una hipótesis bloqueada por un dato externo figurará como `needs_validation`, con el dato faltante y sin severidad de vulnerabilidad confirmada.

Prioridad propuesta para el backlog, sin atribuirla aún a ningún componente:

- **P0:** pérdida de fondos, compromiso de claves o acceso generalizado demostrados; tratamiento inmediato.
- **P1:** autorización, integridad de pagos, privilegios o recuperación con impacto alto demostrado; objetivo de tratamiento de hasta 7 días.
- **P2:** exposición o debilidad de impacto acotado y brechas materiales de control; objetivo de hasta 30 días.
- **P3:** mejoras restantes y formalización; objetivo de hasta 90 días.

Estos plazos son objetivos propuestos, sujetos a responsables y dependencias. La aceptación de riesgo requerirá responsable, fundamento y fecha de revisión. Las brechas normativas tendrán criticidad de preparación independiente de la severidad de una vulnerabilidad.

## 10. Entregables y cierre

1. Manifiesto de commit/alcance y arquitectura con activos, flujos de datos y fronteras de confianza.
2. Ledger de cobertura: cada unidad con estado, revisor, evidencia, candidatos y pendientes; ninguna unidad pendiente se presentará como cubierta.
3. Evidencias y registros técnicos estructurados del flujo: `run-metadata.json`, `architecture.md`, `coverage-ledger.json`, `findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`; validar esquemas y cobertura antes de cerrar.
4. Matriz ISO: cláusulas 4–10, SoA del Anexo A, diseño, operación, evidencia, brecha y responsable.
5. Matriz SOC 2: categorías acordadas, criterios aplicables, descripción del sistema, controles, muestras, excepciones y distinción Type I/Type II.
6. Backlog de hardening: acción concreta, rutas afectadas, dependencias, responsable propuesto, prioridad, esfuerzo y verificación de cierre.
7. Conclusión por marco y alcance: qué está demostrado, qué incumplimiento está sustentado y qué no puede concluirse; sin porcentaje único que oculte controles críticos sin evidencia.

La evaluación interna podrá cerrar con brechas abiertas si están explícitas, pero no con candidatos pendientes ocultos ni afirmaciones de cumplimiento sin respaldo. Toda cobertura incompleta se identificará y justificará. Antes de recomendar preparación para una evaluación externa se deberán resolver o tratar formalmente las brechas materiales y contar con evidencia suficiente para todos los requisitos aplicables del alcance.

**Punto de continuación:** este documento termina en planificación. La auditoría se iniciará en una instrucción posterior, fijando las decisiones pendientes de alcance y evidencia. No hay hallazgos ni veredicto de cumplimiento en esta entrega.

## 11. Fuentes oficiales

- [ISO/IEC 27001:2022, requisitos del SGSI y referencia a Amd 1:2024](https://www.iso.org/standard/27001).
- [ISO/IEC 27001:2022/Amd 1:2024, ficha IEC](https://webstore.iec.ch/en/publication/92579).
- [ISO/IEC 27002:2022, guía de controles](https://www.iso.org/standard/75652.html).
- [AICPA: TSC 2017 con puntos de enfoque revisados en 2022](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022).
- [AICPA: recursos SOC, incluidos Description Criteria y materiales Type I/II](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services).
- [OWASP ASVS 5.0.0](https://asvs.owasp.org/).

Fuentes consultadas el 2026-11-03. Las fichas públicas delimitan este plan; la evaluación normativa detallada requerirá consultar los textos completos autorizados correspondientes.

---
name: midatopay-dev-release
description: Desarrollar, corregir y publicar cambios en MidatoPay solanahackcba con pruebas de arranque Privy, invariantes de pagos y verificación de Git/Netlify. Aplicar al trabajar en este repositorio, no como procedimiento general para otros proyectos.
---

# Desarrollo y publicación de MidatoPay

La fuente versionada de este procedimiento vive en `.agents/skills/midatopay-dev-release/` del checkout. Aplicar las instrucciones del usuario al alcance actual; el skill no autoriza acciones externas adicionales ni impone pedir confirmación para tareas ya autorizadas.

## Empezar con el contexto mínimo

1. Localizar la raíz con `package.json`, `src/` y `netlify/functions/`. Leer `AGENTS.md`, el estado de Git y los scripts actuales de `package.json`. No asumir que el directorio inicial o una estructura de otro proyecto es la raíz.
2. Separar las rutas del trabajo actual de los cambios preexistentes. No incorporar scripts operativos sin seguimiento sólo porque están en el workspace.
3. Consultar sólo lo pertinente: [lecciones](references/lessons.md) al tocar una zona afectada por un incidente; [publicación](references/release.md) cuando se pide subir, mergear o desplegar; `docs/USDC_TRANSFERS.md` y `SOLANA-RULES.md` para dinero, wallets y patrocinio.
4. Ejecutar `npm run change:preflight` si ayuda a preparar un cambio o publicación. El helper no hace fetch, modifica Git, instala paquetes ni ejecuta tests. Sus referencias remotas son locales y pueden estar desactualizadas.

## Elegir la verificación por comportamiento

| Cambio | Evidencia necesaria |
| --- | --- |
| React, login, perfil o selección de wallet | Tests del comportamiento cambiado y `node --test test/app-startup.test.js`; build. Incluir usuario nulo, sesión restaurándose y wallet pendiente cuando corresponda. |
| Agenda, API o estado de Activity | Tests del módulo y autenticación/propiedad; agregar render si cambia UI; empaquetar Functions si cambia backend o sus imports. |
| Dinero, firma, cuota, worker, red o migraciones | Suite completa para devnet y mainnet-beta; build y Functions según componentes afectados. Conservar los casos de idempotencia, concurrencia y respuesta perdida. |
| Dependencias o bundling | Revisar lockfile, instalación reproducible y checks de dependencias/build/Functions pertinentes. No actualizar dependencias ajenas para resolver un incidente de otra clase. |
| Documentación, memoria o skill | Validar referencias, frontmatter y helpers modificados. No ejecutar suites financieras ni desplegar la aplicación sólo por editar Markdown. |

Un caso de regresión debe fallar antes del arreglo y pasar después cuando sea posible reproducirlo. Para un crash de arranque, renderizar la aplicación real con estados de Privy controlados: un test que sólo busca texto en código no detecta ese fallo. SSR no ejecuta efectos; complementar con navegador para los flujos que dependan de hidratación, callbacks, firma o recarga. Si no hay navegador autenticado disponible, informar ese límite.

## Invariantes que cambian las decisiones

- Una comparación entre dos valores opcionales puede resultar verdadera porque ambos son `undefined`. Antes de leer `record.address` o `record.profile`, exigir registro e identidad válidos. No reemplazar este control por elegir otra wallet.
- La wallet principal es Privy Solana índice 0: React usa `walletIndex` y el servidor `hdWalletIndex`. Usar el resolver compartido; no el primer elemento, la wallet con saldo ni una secundaria. La creación automática es la única vía de aprovisionamiento.
- Los endpoints nuevos deben verificar identidad, propiedad y red antes de efectos. La exportación de tesorería necesita autorización de servidor y la principal propia configurada como tesorería.
- Antes de autorizar un envío, fijar destinatario, importe exacto, red y comisión que ve el usuario. Guardar el wire con ambas firmas antes de transmitir; reintentar los mismos bytes y firma. Una respuesta perdida o ausencia en un RPC no habilita un pago sustituto.
- Compartir la política de acceso entre preparación, submit y worker. `TRANSFERS_ENABLED=false` todavía permite las cuentas exactas de `TRANSFERS_ALLOWED_USER_IDS`; para pausar todos, se requiere además una lista vacía. No asumir que una configuración local coincide con Netlify Production.
- Integrar cambios de `main` también implica adaptar llamadas a funciones compartidas: comprobar parámetros y configuración, como `paymentQuoteSettings()` y la antigüedad exigida por `fetchArsQuote`.

## Cerrar el trabajo sin repetirlo

Registrar qué versión se probó, qué checks pasaron y sus límites. Si después cambia código, entra un merge o cambia configuración relevante, repetir sólo lo que esa diferencia invalida. Ejecutar las tareas pesadas secuencialmente en este Windows; el paralelismo útil es para lecturas independientes.

Para publicar, seguir [el procedimiento de Git y Netlify](references/release.md). Diferenciar explícitamente preparado, subido, mergeado, desplegado y probado con sesión: son resultados distintos.

Después de una nueva lección, actualizar el apartado existente de [lessons.md](references/lessons.md) con evidencia y acción preventiva. Mantener esta entrada corta; agregar referencias sólo para un procedimiento que realmente se reutilice.

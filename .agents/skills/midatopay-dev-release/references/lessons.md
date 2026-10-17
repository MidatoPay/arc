# Lecciones verificadas

## 2026-10-16: crash antes del login

**Evidencia:** [PR #15](https://github.com/MidatoPay/solanahackcba/pull/15), merge `44d4735`; regresión en `test/app-startup.test.js`. Cinco escenarios de arranque fallaron antes del arreglo y pasaron después.

`primaryRecord?.userId === user?.id` era verdadero cuando ambos lados eran `undefined`. La expresión siguiente leía `primaryRecord.address` aunque el registro era nulo. `useMerchantProfile` tenía el mismo problema al compararse con un `userId` todavía indefinido.

**Prevención:** exigir identidad y registro antes de desreferenciar. Probar la app real antes de que Privy esté listo, sin sesión, con sesión pero sin usuario y con usuario sin wallet sincronizada. Preservar esos tests al refactorizar. El build y la preview habían pasado: prueban compilación/despliegue, no el comportamiento de cada estado de React.

**Límite:** los tests SSR no ejercitan efectos ni una sesión real del navegador. No presentarlos como prueba de login completo o de firma Privy.

## 2026-10-16: identidad de wallet y aprovisionamiento

**Evidencia:** investigación documentada en `docs/USDC_TRANSFERS.md`, implementación del [PR #14](https://github.com/MidatoPay/solanahackcba/pull/14), tests en `test/wallet-contacts.test.js`.

Se encontraron wallets embedded de índices 0 y 1 y un mapeo activo que apuntaba a la secundaria porque el orden de resultados no representaba identidad. React y servidor nombran el índice de forma diferente. Había creación automática de Privy y un fallback manual de 800 ms.

**Prevención:** resolver índice 0 explícitamente con la función compartida; verificarlo en frontend y servidor; conservar una sola vía automática de creación y ofrecer sincronización cuando tarda. Auditar cambios del mapeo sin cambiar destinatarios históricos ni consolidar fondos.

**Hipótesis pendiente:** la coexistencia de dos vías de creación puede explicar la duplicación; no se demostró qué llamada creó cada wallet histórica. No afirmar esa causa sin registros de Privy.

## 2026-10-16: validar en producción con acceso limitado

Mantener el acceso general desactivado impedía validar un envío real. Se agregó una lista de IDs Privy exactos para una prueba limitada, aplicada al API y al worker y cubierta por `test/transfers.test.js`.

**Prevención:** planificar cómo validar antes de cerrar un feature flag. Verificar RPC, genesis, principal, tesorería y variables del despliegue antes de una prueba autorizada. Las cuentas de prueba mantienen cuotas y presupuesto. Configurar acceso no ejecuta transferencias; enviar fondos requiere la acción y firma del usuario.

**Configuración:** `false` con lista no vacía permite esa lista. Para pausar todos los envíos, usar `false` y lista vacía. El worker puede seguir observando transacciones ya aceptadas. No guardar emails, IDs reales ni claves en este archivo.

## 2026-10-16: cambios nuevos de main

Durante la publicación del PR #14, `main` incorporó cambios de documentación y del control de antigüedad Chainlink. Se preservó el README nuevo y se adaptó la obtención de cotización de transferencias para pasar `rpc` y `maxAge` mediante `paymentQuoteSettings()`.

**Prevención:** fetch antes de publicar; revisar el diff nuevo de `main` e integrar sus contratos, además de resolver conflictos textuales. Verificar la versión combinada. No descartar cambios de otra persona ni asumir que un merge sin conflictos garantiza compatibilidad.

## 2026-10-16: infraestructura de verificación

**Desarrollo local:** Netlify Dev con `command` y `targetPort` explícitos omite la detección automática del framework. Sin `[dev].framework = "#custom"`, el fallback SPA devolvía HTML para `/src/main.jsx`, `/@vite/client` y dependencias; la raíz respondía 200, pero React no podía arrancar. `npm run dev:check` reproduce el fallo por MIME incorrecto y verifica también el rechazo del webhook sin firma. El launcher `dev:full` limita el runtime Go de esbuild y fija el destino local del worker en el puerto 8888. Excluir `.netlify` del watcher de Vite: durante la validación una caché de Chrome bloqueada dentro de ese directorio provocó `EBUSY` y cerró el servidor. No declarar desarrollo operativo comprobando solo `/`.

Se observaron falta de espacio (`ENOSPC`) al empaquetar Functions, permisos Windows (`EPERM`) al recrear `dist/assets` y agotamiento de memoria al solapar verificaciones pesadas. La ejecución serial y el espacio suficiente permitieron completar las comprobaciones locales.

**Prevención:** revisar espacio antes de empaquetar y ejecutar suite/build/Functions en secuencia. No repetir instalación, código o tests para corregir un problema de disco. Limpiar únicamente artefactos regenerables identificados, validando la ruta absoluta y usando PowerShell de principio a fin; respetar los permisos de ejecución del entorno.

GitHub Actions no inició los jobs del PR #14 por un bloqueo de facturación. El usuario pidió continuar con verificaciones locales y preview Netlify exitosa.

**Prevención:** identificar una vez si el problema es de infraestructura. No llamar "tests fallidos" a jobs que no arrancaron, ni "CI aprobada" a una excepción. La excepción de esa publicación no autoriza ignorar fallos nuevos de código, saltar protecciones ni asumir que la facturación sigue bloqueada en futuras sesiones. Si el usuario pide no seguir auditando CI, respetar el límite.

## 2026-10-16: secretos, Git y evidencia de despliegue

- Un patrón de entorno como `Env:GIT*` incluye `GITHUB_*`: puede mostrar tokens aunque se buscara configuración Git. Consultar variables exactas; imprimir presencia o nombres cuando alcanza, nunca valores de credenciales.
- Los archivos operativos sin seguimiento se preservaron fuera de los PR. Preparar archivos por rutas explícitas; revisar el diff preparado y los nombres antes del commit. No depender de helpers ignorados en `.netlify/` como si existieran en todos los checkouts.
- Para títulos/cuerpos de PR multilínea, usar archivo UTF-8 y `--body-file`. No interpolar Markdown mediante strings del shell que puedan ejecutar backticks o `$()`.
- Una preview exitosa, un merge y una respuesta HTTP 200 no prueban que una sesión autenticada funcione. Tras el hotfix se verificó además que el dominio productivo sirviera un bundle con el guard corregido. Registrar esa evidencia con su límite; hashes y cantidades de tests son resultados de un despliegue, no constantes del procedimiento.

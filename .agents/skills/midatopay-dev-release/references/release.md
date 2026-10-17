# Publicar cambios con Git y Netlify

Leer cuando la tarea incluya push, PR, merge o despliegue. No ejecutar este flujo sólo por consultar el skill.

## Preparar una versión verificable

1. Confirmar raíz, rama, cambios previos y archivos propios. `npm run change:preflight` ayuda sin mutar el repositorio. No instalar paquetes si no cambiaron dependencias y el entorno ya funciona.
2. Cuando la publicación esté autorizada, hacer `git fetch origin` y comparar `HEAD` con `origin/main`. Revisar los cambios remotos. Integrarlos en una rama del trabajo; no sobrescribir trabajo local ni stashear archivos ajenos automáticamente.
3. Revisar el cambio final, incluidos efectos de la integración. Seleccionar las verificaciones del `SKILL.md` y ejecutar las tareas pesadas en secuencia. Si Git informa ownership dudoso de este checkout conocido, usar `git -c safe.directory=RUTA_ABSOLUTA_DEL_REPO ...`; no cambiar configuración global para todos los directorios.
4. En PowerShell, fijar `VITE_SOLANA_CLUSTER` para cada comprobación que dependa de la red. Por ejemplo:

```powershell
$env:VITE_SOLANA_CLUSTER='mainnet-beta'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests fallaron' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build falló' }
```

Repetir para devnet sólo cuando el alcance lo requiera. Para un cambio financiero de ambas redes, correr suite y empaquetado pertinentes en ambas. Para un hotfix acotado de arranque, los tests de arranque de ambas redes, la suite pertinente y el build aportan evidencia directa. No fijar en instrucciones una cantidad histórica de tests.

5. Si cambian Functions o imports compartidos, ejecutar `npm run functions:check`. Si hay migración, comprobar que sea aditiva/idempotente y aplicar al entorno autorizado antes de desplegar código que dependa del esquema. Un check de catálogo debe verificar también permisos, no imprimir datos de usuarios.
6. Preparar archivos con `git add RUTA1 RUTA2 ...`. Revisar `git diff --cached --stat`, `git diff --cached` y `git diff --cached --check`; ejecutar preflight después de stagear. No incorporar `.env` reales, cachés, claves ni scripts operativos de otro trabajo. Commit y push sólo dentro del alcance autorizado.

## PR y decisión de merge

- Usar la integración GitHub disponible o `gh` autenticado. Si no hay credencial disponible, informar el límite; no buscar ni volcar tokens. Un helper local ignorado puede ser útil si existe y ya está autorizado, pero no es una dependencia del procedimiento.
- Redactar el PR con problema, comportamiento final, verificación y límites materiales. Preparar el cuerpo en un archivo UTF-8 y usar `--body-file`; preservar saltos de línea. No incluir historial conversacional ni intentos descartados salvo que expliquen una decisión relevante.
- Consultar la preview Netlify del SHA actual del PR. Una preview anterior no valida commits nuevos. Si el usuario pidió centrarse en Netlify y omitir una auditoría de GitHub CI, respetarlo; no describir CI como aprobada si no lo está.
- Un fallo de código/build requiere corregir o informar el bloqueo antes de publicar. Una excepción autorizada por infraestructura debe quedar explícita. No usar `--admin`, desactivar protecciones ni falsear checks para lograr el merge.
- Con merge autorizado y evidencia suficiente según la tarea, usar `gh pr merge ... --match-head-commit SHA` para no mergear una versión distinta de la revisada. Confirmar estado `MERGED` y SHA resultante.
- Si corresponde dejar el checkout en `main`, hacer fetch, switch y fast-forward; preservar cambios ajenos. Si `main` local diverge, no usar reset para forzarlo.

## Confirmar qué está disponible

- Distinguir preview, producción y la configuración de cada contexto. No asumir que cambiar variables del navegador cambia las Functions ya desplegadas o que `.env.production` local reproduce la configuración productiva.
- Esperar evidencia del despliegue de producción del commit correcto. Si no hay acceso a Netlify, el estado público del commit/deploy y el bundle servido pueden aportar evidencia limitada; HTTP 200 por sí solo no confirma un despliegue ni login.
- Si cambia el arranque, observar la pantalla de entrada y la consola cuando el navegador esté disponible. Para flujos autenticados, probar sesión restaurada, wallet pendiente y navegación relevante con una cuenta autorizada. Si no se pudo realizar esa prueba, decirlo.
- Al activar una función financiera, usar el acceso limitado acordado. No ejecutar envíos reales como parte de los tests automáticos ni seleccionar una cuenta distinta para evitar un problema de saldo.
- Al cerrar, comunicar PR/SHA, estado real del despliegue, comprobaciones y cualquier paso pendiente. Pedir recarga forzada sólo después de comprobar que se sirve el código nuevo.

## Recuperación sin trabajo repetido

Ante una regresión productiva, reproducir el comportamiento concreto antes de ampliar la investigación. Agregar la regresión, aplicar la corrección mínima, verificarla y publicar el hotfix dentro de la autorización existente. No sumar auditorías o refactors ajenos que demoren restaurar el servicio.

Ante `EPERM`, usar el mecanismo de permisos del entorno si hace falta. Ante `ENOSPC`, identificar artefactos y espacio; no reintentar el mismo empaquetado indefinidamente. En Windows, resolver y validar la ruta absoluta antes de una limpieza recursiva, evitar enlaces inesperados y usar `Remove-Item -LiteralPath` dentro del mismo shell. No borrar fuentes, `.git`, credenciales ni carpetas amplias del usuario.

Conservar logs compactos de la versión final en una ruta ignorada si se necesitan; no publicarlos automáticamente. Un fallo externo repetido sin cambios de estado no justifica volver a ejecutar todos los checks.

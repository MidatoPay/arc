# MidatoPay: instrucciones para agentes

Este checkout es una SPA React/Vite con Netlify Functions y PostgreSQL. La raíz operativa contiene `package.json`, `src/` y `netlify/functions/`; el directorio padre del workspace puede no ser el repositorio Git.

Para desarrollo, correcciones, configuración, migraciones o publicaciones, leer y aplicar [.agents/skills/midatopay-dev-release/SKILL.md](.agents/skills/midatopay-dev-release/SKILL.md). El skill contiene los procedimientos y enlaza las lecciones verificadas. Leer las referencias según el cambio, sin ejecutar todo el proceso de publicación para tareas de documentación.

## Reglas que deben sobrevivir entre sesiones

- Respetar el alcance y las autorizaciones de la conversación actual. Preparar cambios y verificarlos no exige una confirmación adicional. Crear este skill o editar código no concede por sí solo permiso para publicar, activar transferencias, mover fondos o acceder a datos de otro entorno.
- Revisar `git status` al comenzar. Preservar cambios de otras personas y archivos sin seguimiento; stagear rutas explícitas. No usar `git add .`, `git add -A`, stash automático, reset o limpiezas amplias.
- Antes de publicar, actualizar la referencia remota de `main`, integrar sus cambios y verificar la versión combinada. No afirmar que un build/preview prueba el inicio de sesión o una transferencia real.
- Si cambia React, autenticación, perfil o wallets, verificar el arranque con usuario y registros todavía nulos. La regresión de referencia está en `test/app-startup.test.js`.
- Si cambia la lógica financiera, conservar los invariantes documentados en `SOLANA-RULES.md` y `docs/USDC_TRANSFERS.md`. Los tests automáticos no deben firmar con claves de producción ni mover fondos reales.
- Las credenciales y los IDs de cuentas reales no pertenecen a la memoria del skill. No volcar `.env`, el entorno completo ni patrones amplios como `Env:GIT*` que también incluyen variables `GITHUB_*`.
- Ejecutar verificaciones proporcionales al cambio y secuenciar tests completos, build y empaquetado de Functions en esta máquina. Una vez que pasan sobre la versión final, no repetirlas sin una razón nueva.
- Después de un incidente demostrado, actualizar la lección correspondiente y agregar una regresión que ejercite el comportamiento. Distinguir hechos comprobados de hipótesis; no acumular reglas para riesgos imaginados.

## Herramientas locales

`npm run change:preflight` muestra el estado de Git, archivos preparados, espacio libre y verificaciones sugeridas. Es de sólo lectura y no usa la red. Rechaza whitespace incorrecto en el diff preparado y archivos de credenciales/cachés preparados por accidente; las advertencias de espacio o referencias remotas antiguas requieren criterio, no una publicación automática.

# Registro de riesgos de seguridad

**Proyecto:** MidatoPay × Arc  
**Fecha de revisión:** 18 de agosto de 2026  
**Alcance:** aplicación web, funciones Netlify, configuración de despliegue, secretos locales y dependencias.

## Resumen ejecutivo

La aplicación no debe exponerse a usuarios ni manejar fondos reales hasta corregir los riesgos críticos y altos. El problema más grave es que la clave privada de la tesorería y la clave de Anthropic se incorporan al código JavaScript del navegador mediante variables `VITE_*`. Además, la autorización de pagos y el saldo ARS dependen de datos controlables desde el cliente.

La prioridad inmediata es revocar y rotar las credenciales expuestas, retirar la firma de transacciones del navegador y trasladar la autorización de pagos a un backend.

## Matriz de riesgos

| ID | Riesgo | Severidad | Probabilidad | Impacto | Estado |
|---|---|---:|---:|---:|---|
| R-01 | Clave privada de tesorería expuesta en el bundle | Crítica | Alta | Crítico | Abierto |
| R-02 | Clave de Anthropic expuesta en el bundle | Alta | Alta | Alto | Abierto |
| R-03 | Pagos y saldos autorizados por lógica del cliente | Alta | Alta | Crítico | Abierto |
| R-04 | Relays RPC públicos sin controles de abuso | Alta | Alta | Medio/Alto | Abierto |
| R-05 | Reconciliación programada invocable sin autenticación explícita | Alta | Media | Medio/Alto | Abierto |
| R-06 | Historial de transacciones falsificable por usuarios autenticados | Alta | Alta | Alto | Abierto |
| R-07 | Dependencia `image-size` con vulnerabilidades reportadas | Alta | Media | Medio | Abierto |
| R-08 | Validación insuficiente de contactos en backend | Media | Media | Medio | Abierto |
| R-09 | Secretos sensibles almacenados en `.env` local | Media | Media | Alto | Mitigar |

## Detalle de riesgos

### R-01 — Clave privada de tesorería expuesta

**Evidencia:** [`src/treasury.js:9`](../src/treasury.js#L9) carga `VITE_TREASURY_PRIVATE_KEY`; [`src/treasury.js:19`](../src/treasury.js#L19) crea una wallet firmante; [`src/treasury.js:41-53`](../src/treasury.js#L41) ejecuta pagos desde ella. La clave también aparece en el artefacto generado dentro de `dist`.

**Impacto:** cualquier visitante puede extraer la clave y transferir los fondos de la tesorería.

**Mitigación requerida:**

1. Revocar y rotar inmediatamente la clave actual.
2. Mover la firma y los pagos a una función backend o servicio de custodia.
3. Validar en backend identidad, wallet destino, monto, cotización, límites y saldo.
4. Agregar límites diarios, alertas y pausado de emergencia.

### R-02 — Clave de Anthropic expuesta

**Evidencia:** [`src/App.jsx:43`](../src/App.jsx#L43) lee `VITE_ANTHROPIC_API_KEY` y [`src/App.jsx:158-170`](../src/App.jsx#L158) la envía directamente desde el navegador.

**Impacto:** consumo no autorizado, costos inesperados y posible abuso de la cuenta.

**Mitigación requerida:** revocar/rotar la clave, quitarla de las variables `VITE_*` y crear un proxy backend con límites de uso, validación de entrada y monitoreo.

### R-03 — Autorización de pagos controlada por el cliente

**Evidencia:** [`src/flows.js:21-48`](../src/flows.js#L21) ejecuta el payout antes de comprobar el saldo ARS; el saldo se persiste en `localStorage` mediante [`src/App.jsx:45-61`](../src/App.jsx#L45).

**Impacto:** un usuario puede modificar el saldo local o invocar directamente la lógica para obtener pagos de la tesorería.

**Mitigación requerida:** tratar el cliente como no confiable; mantener saldos y estados de operación en backend; usar idempotencia; verificar transacciones on-chain antes de acreditar fondos.

### R-04 — Relays RPC públicos

**Evidencia:** [`netlify/functions/rpc.js:6-18`](../netlify/functions/rpc.js#L6) y [`netlify/functions/eth-rpc.js:5-17`](../netlify/functions/eth-rpc.js#L5) aceptan POST sin autenticación, límites de tamaño ni restricción de métodos JSON-RPC.

**Impacto:** agotamiento de cuota, costos, consumo de recursos y degradación del servicio.

**Mitigación requerida:** limitar métodos permitidos y tamaño de cuerpo, aplicar rate limiting por IP/origen, cachear lecturas, devolver errores controlados y considerar autenticación para operaciones no públicas.

### R-05 — Reconciliación programada sin autenticación explícita

**Evidencia:** [`netlify.toml:17-18`](../netlify.toml#L17) configura la función programada y [`netlify/functions/reconcile-wallets.js:31-58`](../netlify/functions/reconcile-wallets.js#L31) realiza lecturas de base de datos y llamadas externas sin una verificación explícita del invocador.

**Impacto:** si la ruta es invocable públicamente, puede forzarse trabajo costoso repetidamente.

**Mitigación requerida:** aceptar únicamente invocaciones firmadas por Netlify o un secreto de scheduler, validar método y payload, aplicar lock/idempotencia y registrar invocaciones anómalas.

### R-06 — Historial de transacciones falsificable

**Evidencia:** [`netlify/functions/transactions.js:124-147`](../netlify/functions/transactions.js#L124) comprueba solo campos obligatorios y almacena valores enviados por el usuario.

**Impacto:** historial, montos, hashes y cotizaciones falsos en la interfaz.

**Mitigación requerida:** validar tipos, rangos y enums; comprobar que el hash existe y corresponde a la wallet; derivar los registros desde datos on-chain; impedir que el cliente defina campos financieros confiables.

### R-07 — Dependencia vulnerable

**Evidencia:** `npm audit --omit=dev` reportó tres vulnerabilidades de severidad alta asociadas a `image-size@2.0.2`, registrada en [`package-lock.json:20996-21007`](../package-lock.json#L20996).

**Impacto:** exposición potencial en herramientas de build/desarrollo y cadena de dependencias.

**Mitigación requerida:** actualizar la dependencia o el paquete transitivo que la incorpora, regenerar el lockfile y ejecutar nuevamente `npm audit --omit=dev` y `npm audit`.

### R-08 — Validación insuficiente de contactos

**Evidencia:** [`netlify/functions/contacts.js:89-113`](../netlify/functions/contacts.js#L89) valida presencia, pero no formato de address ni longitudes máximas.

**Impacto:** registros malformados o excesivamente grandes y errores posteriores en pagos o búsquedas.

**Mitigación requerida:** validar address Ethereum, longitudes máximas, alias permitido y contenido de notas en backend; mantener validación de cliente solo como ayuda de UX.

### R-09 — Secretos locales sensibles

**Evidencia:** `.env` contiene credenciales de terceros, clave privada, configuración de base de datos, certificado CA y secreto de Privy. Está excluido por [`.gitignore:3`](../.gitignore#L3), pero también se copió a artefactos de build la información que usa el frontend.

**Impacto:** filtración accidental por logs, backups, máquinas compartidas o despliegues incorrectos.

**Mitigación requerida:** usar un gestor de secretos, escanear historial y artefactos, restringir permisos del archivo, rotar toda credencial que haya sido compartida o desplegada y mantener `.env.example` sin valores reales.

## Plan de remediación recomendado

### Inmediato — antes de cualquier despliegue público

- Rotar la clave privada de tesorería y la clave de Anthropic.
- Retirar `VITE_TREASURY_PRIVATE_KEY` y `VITE_ANTHROPIC_API_KEY` del frontend.
- Vaciar o reemplazar la tesorería comprometida si la clave estuvo activa en un entorno accesible.
- Bloquear temporalmente conversiones ARS→USDC hasta tener autorización backend.
- Revisar logs y movimientos on-chain desde el primer despliegue que usó esas claves.

### Corto plazo

- Implementar un endpoint backend de payout con autenticación, autorización, límites e idempotencia.
- Implementar contabilidad server-side y reconciliación basada en eventos on-chain.
- Proteger scheduler y relays RPC.
- Corregir validación de transacciones y contactos.
- Actualizar dependencias y repetir auditoría.

### Antes de producción

- Pruebas de abuso para pagos, RPC, scheduler y endpoints autenticados.
- Rate limiting y alertas operativas.
- Revisión de secretos en Git, bundles, logs y proveedores de CI/CD.
- Revisión independiente de la arquitectura de custodia y autorización financiera.

## Criterio de cierre

El riesgo puede considerarse cerrado cuando:

- ningún secreto privado o API key aparece en `dist` ni en código servido al navegador;
- los pagos se firman exclusivamente en backend o custodia segura;
- los saldos y autorizaciones no dependen de `localStorage`;
- los registros financieros se derivan de transacciones verificadas;
- scheduler y RPC tienen controles de autenticación/abuso;
- `npm audit` no reporta vulnerabilidades altas sin aceptación formal del riesgo.

## Nota de alcance

Este documento registra riesgos identificados en una revisión estática y de build. No reemplaza una prueba de penetración, una revisión de infraestructura Netlify/Aiven/Privy ni una auditoría de contratos o custodia.

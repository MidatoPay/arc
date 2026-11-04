# Prueba de concepto: alta y KYC de 21Millions

## Web local

En Windows, hacer doble clic en `abrir-web.cmd`. Abre http://127.0.0.1:3210 y carga la clave desde el `.env` de esta carpeta. Requiere Node 24 (ya disponible en este equipo). Mantener abierta la ventana del servidor mientras se usa la web.

La pantalla permite elegir persona o empresa, completar los campos del contrato, ver los datos antes de enviarlos, crear/buscar un cliente, enviar KYC, consultar el estado y obtener el enlace de identidad. Los campos de listas de empresa se completan como JSON, por ejemplo los beneficiarios finales; su descripción figura debajo del campo.

La clave no se envía al navegador. El servidor sólo escucha en 127.0.0.1 y permite onboarding y lectura de depósitos en staging. No guarda formularios KYC en disco ni en almacenamiento del navegador. Anotar el customer_id para retomar. Buscar por CUIT si un alta se corta antes de devolver respuesta. El resultado puede contener datos personales: no compartir capturas sin revisarlas.

## Avisos push con la pestaña cerrada

1. Con el servidor iniciado, abrir http://127.0.0.1:3210 y buscar la sección **Avisos de transferencias**.
2. Completar el customer_id, o pulsar **Usar el cliente del alta**.
3. Pulsar **Activar notificaciones** y aceptar el permiso del navegador.
4. Pulsar **Enviar push de prueba**. Es un mensaje de prueba; no crea un depósito ni mueve dinero.
5. Se puede cerrar la pestaña. El servidor sigue consultando los depósitos acreditados cada 30 segundos y envía el aviso por Web Push. El navegador debe poder trabajar en segundo plano y el equipo debe estar encendido y conectado.

La revisión recorre toda la cartera, pagina de a 100 y solapa 10 minutos. Cada ingreso se identifica por su id y se enruta al customer_id suscripto. Se notifican sólo depósitos acreditados desde que se activaron los avisos. La cola y el corte de consulta se guardan localmente; los fallos temporales de push se reintentan con espera creciente. Los endpoints vencidos (404/410) se eliminan. El service worker usa un tag estable por depósito para reemplazar avisos repetidos; como en toda entrega por red, un cierre justo después del envío y antes de guardarlo puede causar un reenvío.

La carpeta `.data/`, excluida de Git, contiene las claves VAPID privadas, suscripciones, cola y registros mínimos de los depósitos detectados. No borrarla si se quiere conservar la suscripción al reiniciar. El navegador sólo guarda el ID elegido para recuperar la pantalla. Un navegador/perfil puede recibir avisos de un cliente a la vez; para otra persona, usar otro perfil. Al cambiar de cliente y activar avisos, se reemplaza la asociación anterior. Se puede desactivar desde el botón correspondiente.

Es una herramienta local de un operador: no expone cuentas de clientes a Internet ni autentica usuarios finales. Para producción hace falta el vínculo autenticado entre usuario y customer_id, almacenamiento compartido y un servidor siempre encendido con HTTPS. En el equipo de prueba se usa loopback, que los navegadores admiten como contexto seguro. Los avisos contienen monto y moneda y pasan cifrados por el proveedor push del navegador.

En Brave, habilitar **Usar los servicios de Google para mensajes push** si aparece un error al suscribirse. Si se bloqueó el permiso, volver a permitir notificaciones en los ajustes del sitio. En iPhone/iPad se necesita una web HTTPS instalada en la pantalla de inicio; este servidor en 127.0.0.1 está pensado para el navegador del mismo equipo.

Dependencias aisladas en esta carpeta: `npm ci` si se mueve el proyecto. Verificación: `npm test`. Fuentes técnicas: https://developer.mozilla.org/en-US/docs/Web/API/Push_API y https://github.com/web-push-libs/web-push.

Los esquemas del formulario son una copia del contrato público consultado el 2026-11-03. No hay aprobación automática ni verificación de identidad simulada; los botones envían pedidos reales a staging.

Fuente: https://docs.21millions.com/es y https://api.21millions.com/partner-api.json (consultado 2026-11-03).

## Flujo

1. Crear el cliente con POST /v1/partner/customers y guardar customer_id. verification_type es individual o company. fiscal_id es único por partner e inmutable. Un comercio que opera como persona física usa individual; una sociedad usa company.
2. Enviar POST /customers/{customer_id}/kyc/individual o /kyc/company.
3. Consultar GET /customers/{customer_id}/kyc. onboarding.identity.url contiene el enlace personal donde se verifica documento y foto. En empresas, coordinar con 21Millions quién realiza la identidad.
4. Si hace falta renovar el enlace: POST /customers/{customer_id}/kyc/identity-session, opcionalmente con return_url. No crear sesiones repetidamente mientras una verificación está en revisión.
5. Consultar el estado cada 5 minutos. onboarding.step COMPLETE indica identidad verificada; cada rail debe llegar a APPROVED para operar. Los rails son ARS_CVU, CRYPTO_EVM y CRYPTO_TRON.

Persona: documento, nombre, nacionalidad, CUIT/CUIL, nacimiento, teléfono, domicilio, ocupación, finalidad de cuenta, ingresos y volumen mensual estimado. Empresa: datos societarios y fiscales, domicilios, contacto, actividad, origen de fondos, volumen y beneficiarios finales. Los JSON incluyen los ejemplos publicados por 21Millions; son ilustrativos y deben reemplazarse por identidades coordinadas con el proveedor, no enviarse como clientes reales.

## Ejecutar

Requiere Node con fetch nativo. Desde esta carpeta:

```powershell
node onboard.mjs plan individual.example.json
node onboard.mjs plan company.example.json
```

El modo predeterminado sólo imprime las llamadas. Para probar con una identidad autorizada, preparar un archivo privado fuera del repositorio y cargar TWENTYONE_API_KEY en el entorno con una credencial nx_test_. No colocar claves ni datos personales en los ejemplos versionados.

```powershell
node onboard.mjs create C:/ruta/privada/cliente.json --execute
# Guardar el customer_id devuelto antes del siguiente paso.
node onboard.mjs submit C:/ruta/privada/cliente.json CUSTOMER_ID --execute
node onboard.mjs status C:/ruta/privada/cliente.json CUSTOMER_ID --execute
```

Si el alta responde con timeout, buscar primero GET /customers?fiscal_id=... antes de reintentar. Un 409 puede indicar que ya existe. El CLI no reintenta escrituras automáticamente. Los errores 422 contienen fields para corregir los datos.

Staging: https://api.staging.21millions.com. La verificación de identidad es real y requiere coordinar identidades con 21Millions. Esta prueba no deposita fondos, hace swaps ni retiros. No se ejecutaron altas remotas al prepararla.

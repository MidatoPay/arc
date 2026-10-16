# Transferencias de USDC y wallet principal

## Comportamiento

Enviar, QR y voz usan una única wallet principal (índice HD 0). El SDK de React devuelve `walletIndex`; el SDK de servidor devuelve `hdWalletIndex`. No se seleccionan wallets por orden, saldo ni dirección de tesorería. El servidor verifica identidad y propiedad antes de preparar y antes de aceptar una firma. Las wallets existentes adicionales no se borran, utilizan ni consolidan.

La creación automática de Privy (`users-without-wallets`) es el único mecanismo de aprovisionamiento. Se retiró el fallback manual de 800 ms. Si la wallet tarda en aparecer, la app permite sincronizar; no crea una adicional. El componente de exportación no crea wallets ni cambia la tesorería del servidor.

Se observaron dos wallets Solana embedded de índices 0 y 1 registradas en el mismo segundo y un mapeo activo que apuntaba al índice 1. El código tenía dos vías de creación (automática y fallback manual). La concurrencia es una hipótesis; no se atribuye la creación histórica a una llamada concreta sin registros de Privy. Reproducir primer login, latencia y varias pestañas con una cuenta de prueba al validar el despliegue. `scripts/audit-primary-wallets.js` genera un inventario de solo lectura sin claves; `--sync` corrige el mapeo para la red configurada y registra la dirección anterior en `wallet_identity_audit`. La API `/wallet` hace la misma sincronización verificada en cada inicio de sesión. Nunca se reescriben destinos de cobros históricos.

La exportación en Profile requiere autorización administrativa del servidor y que la tesorería configurada sea la principal del propio administrador. Privy muestra la clave en su interfaz; la aplicación no la recibe. Esto controla la herramienta que ofrece la app; no cambia la propiedad de las claves del usuario en Privy.

## API

- `GET /wallet`: identidad principal autenticada y verificada.
- `GET /treasury/export-access`: autorización de exportación de tesorería; usuarios no administradores reciben 403.
- `GET /transfers`: últimas 50 intenciones propias, disponibilidad del servicio y cuota diaria.
- `POST /transfers`: `Idempotency-Key` UUID v4 y `{from,to,amount,kind}`; `amount` es un string USDC positivo con hasta seis decimales; `kind` es `pay`, `voice` o `charge_p2p`. Devuelve la intención y los bytes sin firma para Privy. Un reintento conserva importe y destinatario; una preparación vencida sin firma de tesorería puede renovarse dentro de la misma intención.
- `POST /transfers/:id/submit`: `{signedTransaction}` en base64. Valida que el mensaje sea idéntico al preparado y verifica localmente la firma del usuario. Simula sin firma de tesorería (`sigVerify:false` porque la firma del usuario ya fue verificada); después añade la firma de tesorería, reserva cuota/presupuesto y guarda el wire completo. El wire totalmente autorizado no sale hacia ningún RPC antes de su commit durable.
- `POST /transfers/:id/cancel`: cancela únicamente intenciones sin firma de tesorería, bajo el mismo bloqueo del submit. Nunca asume que una respuesta perdida equivale a un envío no realizado.
- `GET /transfers/:id`: consulta propia y seguimiento; no expone el wire firmado de tesorería.

No se aceptan transacciones arbitrarias. Las instrucciones preparadas son creación idempotente del ATA de destino, TransferChecked de USDC oficial y memo. La wallet destino debe ser una wallet Solana, no un token account o un programa. Las lecturas verifican el genesis de la red y la cuenta USDC canónica (mint, programa, owner, decimales, estado).

## Cuota, presupuesto y estados

Se permiten dos envíos aceptados por usuario y red cada día de Argentina (`America/Argentina/Buenos_Aires`). El día se fija al autorizar la firma de tesorería bajo bloqueo transaccional; reinicia a las 00:00 de Argentina. Cancelar una preparación no consume cupo. Una firma persistida reserva cupo y presupuesto aunque se pierda la respuesta o todavía no se haya retransmitido. Un fallo finalizado consume el cupo: puede haber gastado SOL. No se cobra USDC adicional al usuario.

Valores iniciales del servidor:

```
TRANSFERS_ENABLED=false
TRANSFERS_ALLOWED_USER_IDS=
TRANSFER_DAILY_SOL_BUDGET=0.05
TRANSFER_MAX_SOL_COST=0.003
```

El presupuesto reserva el costo superior de cada envío, incluida la renta del ATA aunque ya exista (podría cerrarse antes de ejecutar). Es deliberadamente conservador y no devuelve presupuesto durante ese día. Se calcula en lamports enteros, con costo de firma y renta consultados en la red. Los bloqueos de usuario y presupuesto serializan solicitudes concurrentes. Se comprueba también el SOL disponible menos las reservas pendientes.

Estados: `awaiting_signature`, `broadcasting`, `confirmed`, `completed`, `failed`, `manual_review`, `canceled`. Solo una transferencia finalizada con instrucciones verificadas produce el movimiento contable definitivo. Activity muestra pendientes y finalizados sin duplicados; el reconciliador omite firmas gestionadas por el worker. Un error procesado o confirmado sigue esperando finalización. Un wire vencido ausente de un RPC queda en revisión y conserva su reserva USDC: no se autoriza otro pago automáticamente.

El worker retransmite exclusivamente los mismos bytes dentro de su vigencia. Continúa observando finalizaciones aunque el usuario ya no tenga habilitados los envíos, pero no retransmite para usuarios deshabilitados. El dispatch se ejecuta cada minuto; el recibo abierto sigue la misma firma mediante polling. Los errores de tracking se guardan con códigos seguros sin registrar claves ni wires.

### Validación en producción con acceso limitado

Con `TRANSFERS_ENABLED=false`, configurar `TRANSFERS_ALLOWED_USER_IDS=did:privy:ID_DE_PRUEBA` en el contexto Production de Netlify y desplegar permite enviar únicamente a esos usuarios autenticados (varios IDs separados por coma). No se usan direcciones de wallet, emails ni datos enviados por el cliente para conceder este acceso. La disponibilidad de la API, preparación, autorización de tesorería y worker aplican la misma política. Los límites diarios y de presupuesto también se aplican a estas cuentas.

Así se puede validar un envío real con el acceso general cerrado: iniciar sesión con la cuenta habilitada, revisar la wallet principal y destinatario, firmar un importe pequeño y comprobar firma, finalización y Activity. Cada envío requiere firma del usuario; esta configuración no ejecuta transferencias por sí sola. Antes de probar, verificar RPC mainnet, tesorería y configuración desplegada. Para pausar todos los envíos, mantener `TRANSFERS_ENABLED=false` y vaciar `TRANSFERS_ALLOWED_USER_IDS`; el tracking de operaciones existentes continúa. Después de validar se puede abrir el acceso general con `TRANSFERS_ENABLED=true`.

## Agenda

La API valida tipos, longitudes, direcciones Solana y alias únicos por usuario. Conserva los contactos EVM históricos y los marca incompatibles; no los ofrece para enviar. Una dirección pegada tiene prioridad sobre cualquier alias. Alias/nombres deben coincidir de forma exacta y única; una ambigüedad no selecciona un destinatario. La agenda se actualiza al navegar y muestra errores de carga. El destinatario y la cantidad quedan fijados al preparar el envío, independientemente de posteriores ediciones del contacto.

## Despliegue y aceptación

1. Ejecutar pruebas, build y `npm run functions:check` en devnet y mainnet.
2. Aplicar `db/migrations/20261016_wallet_transfers.sql` antes de desplegar frontend/Functions (incluida en el runner de migraciones).
3. Desplegar con `TRANSFERS_ENABLED=false`. Configurar `SOLANA_RPC`, `TREASURY_SECRET_KEY`, las credenciales Privy, `INTERNAL_WORKER_SECRET`, la URL base del sitio, el RPC de Ethereum y `CHAINLINK_MAX_AGE_SECONDS` para el equivalente informativo ARS. El backend mantiene las claves privadas fuera del navegador.
4. Revisar inventario de wallets, permisos y mapeos. Verificar la tesorería real de la red; las configuraciones locales anteriores pueden apuntar a otra wallet o a devnet.
5. Habilitar únicamente la cuenta de prueba mediante `TRANSFERS_ALLOWED_USER_IDS` y validar los tres flujos, la firma parcial de Privy, destinatario con/sin ATA, usuario con cero SOL, persistencia tras recarga, cuota diaria y fallos. Las pruebas automatizadas usan claves efímeras y RPC simulado; nunca mueven fondos reales.
6. Habilitar solo después de estas comprobaciones. No activar el flag ni fondear la tesorería como parte de una prueba automatizada. Revisar en `wallet_transfers` el consumo de cuota/presupuesto, los códigos `last_error` y la cola de revisión. Una transferencia ambigua se investiga por firma antes de cualquier recuperación administrativa.

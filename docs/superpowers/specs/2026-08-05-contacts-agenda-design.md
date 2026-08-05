# Agenda de contactos — diseño

## Contexto

`src/App.jsx` usa un array hardcodeado `CONTACTS` (4 contactos fijos) para resolver a quién le vas a pagar cuando usás el flujo de voz. No hay forma de agregar, editar o borrar contactos desde la app.

Existe un branch (`santiago-1-agenda`, en `origin`) con una implementación de agenda, pero está escrito contra una versión del código con arquitectura distinta (`src/components/` separados) que nunca existió en este repo — no es aplicable como parche ni como base de merge. Este diseño es una implementación nueva, acotada a lo pedido: guardar contactos y direcciones de wallet, dentro de la arquitectura actual (todo en `App.jsx` + módulos de lógica en `src/*.js`, siguiendo el patrón ya usado por `arc.js`/`fx.js`/`flows.js`/`treasury.js`).

## Alcance

Incluye: alta/edición/borrado/búsqueda de contactos, persistencia local, uso de esos contactos en el flujo de voz existente.

No incluye (fuera de alcance, no pedido): acciones rápidas de pagar/cobrar desde la agenda, rediseño del FAB de voz, extracción de `Home`/`BalanceCard` a componentes separados — eso era parte del branch de Santiago pero no de este pedido.

## 1. Modelo de datos y storage — `src/contacts.js`

Nuevo módulo, mismo patrón que `fx.js` / `treasury.js` / `arc.js` (lógica separada de la UI).

```js
Contact = { id, name, alias, address, note }
```

- Sin campo `ini`: las iniciales se derivan de `name` al vuelo (`name.slice(0,1).toUpperCase()`), igual que ya hace `Mas` con el avatar del usuario.
- Persistencia en `localStorage`, con clave por wallet: `mp_contacts_<address>`, replicando el patrón existente de `arsStorageKey` en `App.jsx` para el saldo ARS simulado. Cada cuenta logueada en el mismo navegador tiene su propia agenda.
- Arranca **vacía** para cuentas nuevas — no hay contactos semilla. El array `CONTACTS` hardcodeado se elimina del módulo `App.jsx`.

Funciones exportadas:
- `loadContacts(address)` / `saveContacts(address, list)` — leen/escriben el localStorage, con manejo defensivo de JSON inválido (igual estilo que `loadArsBalance`).
- `addContact(list, data)`, `updateContact(list, id, data)`, `removeContact(list, id)` — helpers puros sobre el array (la UI decide cuándo persistir).
- `findByAlias(list, alias)` — case-insensitive, usado por el parser de voz.
- `validateContact({ name, alias, address }, list, editingId)` — devuelve `{ valid, errors }`:
  - `name`: requerido, no vacío.
  - `alias`: requerido, no vacío, único case-insensitive dentro de `list` (excluyendo el propio contacto si se está editando).
  - `address`: requerido, debe pasar `ethers.isAddress(...)`.

## 2. UI — pantalla de Agenda + nav

### Pestaña nueva

Barra de navegación pasa de 4 a 5 tabs: `Home · Movimientos · Stack · Agenda · Más`, más el FAB de voz flotante (sin cambios, sigue siendo la única puerta al flujo de voz).

### Fix de layout en `.mp-nav`

Hoy el hueco para el FAB se logra con `marginRight`/`marginLeft` hardcodeados en los índices 1 y 2 de un array de 4 tabs — no escala a 5 tabs. Se reemplaza por un spacer explícito: el array de tabs se separa en dos mitades (`Math.floor(tabs.length / 2)` a la izquierda, el resto a la derecha) con un `div` de ancho fijo invisible en el medio, dentro del mismo contenedor `flex`. Con 5 tabs queda 2 a la izquierda (Home, Movimientos) y 3 a la derecha (Stack, Agenda, Más). El FAB sigue posicionado con `left: 50%` vía CSS existente, sin cambios en `index.html`.

### `ContactsScreen` (nuevo componente en `App.jsx`, mismo estilo que `Movimientos`/`Stack`)

- Buscador simple arriba (filtra por nombre o alias, client-side).
- Botón "+ Agregar contacto" abre un formulario inline (no modal): nombre, alias, dirección, nota opcional.
- Tocar una fila de la lista abre el mismo formulario en modo edición, prellenado. Dentro del form en modo edición, botón "Borrar contacto".
- Errores de validación inline bajo cada campo, mismo patrón visual que ya usan `Charge`/`Convert` para sus errores (`Card` con fondo `#FDECEA`, texto `C.red`).
- Cada fila: círculo con inicial + nombre + alias + dirección corta (`short()`), botón de copiar dirección reutilizando el patrón ya usado en `Home`.

## 3. Integración con el flujo de voz

- `AppInner` agrega estado `contacts`, cargado con `loadContacts(address)` en un `useEffect` keyed en `address` (mismo patrón que `arsBalance`).
- `contacts` + sus mutadores (`add`/`update`/`remove` conectados a `saveContacts`) se pasan a `ContactsScreen`.
- `contacts` (solo lectura) se pasa a `Voice`.
- `localParse` y `claudeParse` dejan de leer la constante global `CONTACTS`; reciben la lista de aliases como parámetro para construir el prompt / regex de matching.
- `Voice.analyze` resuelve el contacto con `findByAlias(contacts, recipient)` en vez de `CONTACTS.find(...)`.
- Caso especial: si `contacts.length === 0` y el usuario intenta un pago por voz, mensaje específico ("Todavía no cargaste contactos — andá a Agenda") en vez del genérico "no encontré ese alias", en los dos idiomas.

## 4. i18n

Nuevas claves en `src/i18n.jsx`, agregadas en paralelo a `en` y `es` (mismo patrón que el resto del archivo):

- `nav.agenda` — label de la pestaña.
- `agenda.title`, `agenda.subtitle`, `agenda.searchPlaceholder`, `agenda.addButton`.
- `agenda.form.*` — labels de campos (nombre, alias, dirección, nota), botones (guardar/cancelar/borrar).
- `agenda.errors.*` — mensajes de validación (nombre requerido, alias requerido, alias duplicado, dirección inválida).
- `agenda.empty` — estado vacío ("Todavía no tenés contactos").
- `voice.noContactsYet` — mensaje específico para el caso de agenda vacía en el flujo de voz.

No se toca `Charge`, `Convert`, `Success` ni `Movimientos` — no usan contactos.

## Fuera de alcance / decisiones explícitas

- No se migran los 4 contactos hardcodeados como semilla — la agenda arranca vacía (decisión explícita del usuario).
- No se implementa el branch `santiago-1-agenda` tal cual ni se hace merge con `--allow-unrelated-histories` — es una reimplementación acotada sobre la arquitectura actual.

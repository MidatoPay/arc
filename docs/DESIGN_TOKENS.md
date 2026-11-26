# Design tokens provisionales v0

Estado: **provisional**. No es un sistema de diseño aprobado. El manual de marca y el trabajo de UX/UI van a reemplazarlo (ver `.agents/skills/frontend-assistant/references/midatopay.md`).

## Qué es

`src/designTokens.js` junta en un solo objeto `C` los colores que cada pantalla declaraba en su propio `const C = {…}`. Los valores son los mismos que ya se usaban: el cambio no altera ningún color en pantalla.

| Token | Valor | Uso observado |
|---|---|---|
| `bg` | `#F7F7F9` | Fondo de tarjetas secundarias y secciones |
| `card` | `#FFFFFF` | Fondo de tarjetas y hojas |
| `ink` | `#16161A` | Texto principal |
| `mut` | `#7A7A85` | Texto secundario |
| `line` | `#ECECF0` | Divisores y bordes |
| `orange` | `#FF5A00` | Acento de marca en botones principales |
| `accent` | `#fe6c1c` | Íconos y énfasis |
| `orangeSoft` | `#FFEADF` | Fondo de íconos y badges de acento |
| `orangeTint` | `#FFF4ED` | Fondo suave de avisos |
| `violet` | `#5C4CC7` | Información |
| `violetSoft` | `#ECEAFA` | Fondo de información |
| `green` | `#21B95B` | Éxito |
| `red` | `#E4483D` | Error y acciones destructivas |
| `redSoft` | `#FDECEA` | Fondo de error |
| `amber` | `#B45309` | Advertencia |

Además: `RADIUS` (tarjeta 22, hoja 24, botón 18, ícono 12, píldora 999), `cta` (base de los botones de ancho completo, igual a la de Perfil y PayScan), `FONT_MONO` y `TONES` (pares fondo/texto para badges, armados solo con los colores de arriba).

Excepción que se mantuvo: `src/BusinessProfile.jsx` usaba `green: '#15803D'`. Conserva ese valor con `{ ...TOKENS, green: '#15803D' }` para no cambiar su apariencia. La paleta `G` del cliente externo en `src/App.jsx` y los colores sueltos que no estaban en un objeto `C` (por ejemplo `INK` en `ChargeSummary.jsx`) quedan como estaban.

## Uso

```js
import { C, cta, TONES } from "./designTokens.js";
<button style={{ ...cta, background: C.orange, color: "#fff" }}>…</button>
```

Las pantallas nuevas del piloto de facturas (`InvoicesScreen.jsx`, `DebtorInvoicesScreen.jsx`, `InvestorOffersScreen.jsx` y `FactoringParts.jsx`) usan solo estos tokens.

## Pautas de accesibilidad aplicadas en las pantallas nuevas

Tomadas como referencia de buenas prácticas web modernas (Modern Web Guidance se consultó como referencia; no se instaló ni se ejecutó ninguna de sus herramientas):

- Cada campo de formulario tiene un `<label>` asociado; los errores se anuncian con `role="alert"` y los cambios de estado con `aria-live="polite"`.
- Las hojas de confirmación son `role="dialog"` con `aria-modal`, `aria-labelledby`, foco inicial en el título y cierre con Escape, como la hoja de cierre de sesión de Perfil.
- Los botones deshabilitados explican por qué con texto visible (por ejemplo «Pagos no habilitados»), no solo con el color.
- Los estados de carga, vacío y error tienen texto y un botón «Reintentar».
- Los montos se muestran siempre desde el texto del servidor, sin conversión a `Number`.

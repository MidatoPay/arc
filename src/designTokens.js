// Provisional design tokens v0 (docs/DESIGN_TOKENS.md). They unify the local
// `C` color objects the screens already used, with the same values: this is
// not an approved design system. The brand manual and UX/UI work will replace it.
export const C = Object.freeze({
  bg: "#F7F7F9",
  card: "#FFFFFF",
  ink: "#16161A",
  mut: "#7A7A85",
  line: "#ECECF0",
  orange: "#FF5A00",
  accent: "#fe6c1c",
  orangeSoft: "#FFEADF",
  orangeTint: "#FFF4ED",
  violet: "#5C4CC7",
  violetSoft: "#ECEAFA",
  green: "#21B95B",
  red: "#E4483D",
  redSoft: "#FDECEA",
  amber: "#B45309",
});

export const RADIUS = Object.freeze({ card: 22, sheet: 24, cta: 18, icon: 12, pill: 999 });

export const FONT_MONO = "ui-monospace, monospace";

/** Base of the full-width call-to-action buttons (same as ProfileScreen and PayScan). */
export const cta = Object.freeze({ border: 0, borderRadius: RADIUS.cta, padding: "16px 18px", font: "inherit", fontSize: 16, fontWeight: 600, cursor: "pointer", width: "100%" });

/** Badge tones built only from the existing colors. */
export const TONES = Object.freeze({
  neutral: Object.freeze({ background: C.bg, color: C.mut }),
  accent: Object.freeze({ background: C.orangeSoft, color: C.accent }),
  info: Object.freeze({ background: C.violetSoft, color: C.violet }),
  success: Object.freeze({ background: C.bg, color: C.green }),
  warning: Object.freeze({ background: C.orangeTint, color: C.amber }),
  danger: Object.freeze({ background: C.redSoft, color: C.red }),
});

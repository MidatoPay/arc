import { chargeError } from "./charges.js";
import { transferError } from "./transfers.js";

// Textos de error traducidos. `ctx` es el valor de useLanguage()/useOptionalLanguage().
// En español se mantienen los mensajes detallados existentes (charges.js / transfers.js).

const MISSING_CONFIG = /^missing_[a-z][a-z0-9_]{1,63}$/;

/** Error de cobro (código del backend de pagos). */
export function chargeErrorText(ctx, code) {
  if (ctx.lang === "es") return chargeError(code);
  if (code && ctx.has(`chargeErrors.${code}`)) return ctx.t(`chargeErrors.${code}`);
  if (MISSING_CONFIG.test(code || "")) return ctx.t("chargeErrors.missingConfig", code.slice(8).toUpperCase());
  return code ? `${ctx.t("chargeErrors.generic")} (${code})` : ctx.t("chargeErrors.generic");
}

/**
 * Error de envío: acepta un código o un Error. Con código se traduce; sin código se muestra
 * el mensaje tal cual (ya viene traducido desde la app o es un mensaje de la wallet).
 */
export function transferErrorText(ctx, error) {
  const code = typeof error === "string" ? error : error?.code;
  const message = typeof error === "string" ? "" : error?.message || "";
  if (code) {
    if (ctx.lang === "es") return message || transferError(code);
    return ctx.has(`transferErrors.${code}`) ? ctx.t(`transferErrors.${code}`) : ctx.t("transferErrors.generic");
  }
  return message || ctx.t("transferErrors.generic");
}

import { useEffect, useRef } from "react";
import { useOptionalLanguage } from "./i18n.jsx";
import { transferErrorText } from "./errorText.js";

// Confirmación previa a firmar un envío USDC (Enviar, Pagar y voz). Hoja inferior minimalista.
// Muestra la dirección completa del destinatario, importe exacto, red y costo de red estimado (en USDC,
// lo paga el usuario aparte del importe). useOptionalLanguage: fuera del LanguageProvider se muestra en español.
const C = { bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0", orange: "#FF5A00", accent: "#fe6c1c", orangeSoft: "#FFEADF", red: "#E4483D" };
export const NETWORK_LABEL = { "arc-mainnet": "Arc Mainnet" };

/** Costo de red en USDC con hasta 6 decimales: "0.003000000000000000" → "0,003". */
export function networkFeeText(fee, locale = "es-AR") {
  const n = Number(fee);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `≈ ${n.toLocaleString(locale, { maximumFractionDigits: 6 })} USDC`;
}
const mono = { fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5, color: C.mut, wordBreak: "break-all" };

/** Importe exacto sin redondear, con el separador del idioma: es "0.020000" → "0,02"; en "0.000001" → "0.000001". */
export function exactAmount(text, locale = "es-AR") {
  const [whole = "0", fraction = ""] = String(text).split(".");
  const separator = (1.5).toLocaleString(locale).charAt(1);
  return `${Number(whole).toLocaleString(locale)}${separator}${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, fontSize: 14 }}>
      <span style={{ color: C.mut }}>{label}</span>
      <span style={{ color: C.ink, fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
}

export const Spinner = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.6" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite" />
    </path>
  </svg>
);

export default function TransferApproval({ engine }) {
  const lang = useOptionalLanguage();
  const { t, locale } = lang;
  const a = engine.approval;
  const titleRef = useRef(null);
  const cancelRef = useRef(null);
  cancelRef.current = engine.busy ? null : engine.cancel;
  const open = Boolean(a);
  useEffect(() => {
    if (!open) return undefined;
    titleRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") cancelRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!a) return null;

  // El origen siempre es la wallet principal del usuario (lo valida el servidor), por eso no se muestra.
  const { to, amount } = a.input;
  const fee = networkFeeText(engine.info?.networkFeeUsdc, locale);
  const network = NETWORK_LABEL[engine.network] || engine.network || "";
  const initial = (a.recipient || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="mp-overlay" style={{ background: "rgba(16,16,22,.55)", alignItems: "flex-end", zIndex: 1000 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="transfer-approval"
        style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "14px 20px calc(20px + env(safe-area-inset-bottom))", width: "100%", maxHeight: "92%", overflowY: "auto", boxSizing: "border-box" }}>
        <div aria-hidden="true" style={{ width: 42, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 18px" }} />
        <div style={{ textAlign: "center" }}>
          <h2 id="transfer-approval" ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 16, fontWeight: 400, color: C.mut, outline: "none" }}>
            {t("approval.title")}
          </h2>
          <div style={{ marginTop: 6, fontSize: 34, fontWeight: 500, color: C.ink, letterSpacing: -0.8, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, overflowWrap: "anywhere" }}>
            {exactAmount(amount, locale)} <span style={{ fontSize: 18, fontWeight: 500, color: C.mut, letterSpacing: 0 }}>USDC</span>
          </div>
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "flex-start", background: C.bg, borderRadius: 18, padding: "12px 14px" }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: "50%", background: C.orangeSoft, color: C.accent, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 600 }}>
            {initial}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, color: C.mut }}>{t("approval.to")}</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: C.ink, marginTop: 1, overflowWrap: "anywhere" }}>{a.recipient}</div>
            <div style={{ ...mono, marginTop: 4 }}>{to}</div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <Row label={t("approval.network")}>{network}</Row>
          <Row label={t("approval.cost")}>{fee || t("approval.costPending")}</Row>
        </div>

        {engine.error && (
          <div role="alert" style={{ marginTop: 14, fontSize: 13, color: C.red, textAlign: "center", lineHeight: 1.45 }}>
            {transferErrorText(lang, { code: engine.errorCode, message: engine.error })}
          </div>
        )}

        {/* Mientras se firma y envía solo cambia el botón principal; Cancelar queda deshabilitado. */}
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" disabled={engine.busy} onClick={engine.approve} aria-busy={engine.busy || undefined}
            style={{ border: 0, borderRadius: 18, padding: "16px 18px", font: "inherit", fontSize: 16, fontWeight: 600, width: "100%", cursor: engine.busy ? "default" : "pointer", background: C.orange, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: engine.busy ? "none" : "0 8px 20px rgba(255,90,0,0.28)", opacity: engine.busy ? 0.75 : 1 }}>
            {engine.busy ? <><Spinner />{t("approval.authorizing")}</> : t("approval.confirm")}
          </button>
          <button type="button" disabled={engine.busy} onClick={engine.cancel}
            style={{ border: 0, borderRadius: 18, padding: "15px 18px", font: "inherit", fontSize: 15, fontWeight: 600, width: "100%", cursor: engine.busy ? "default" : "pointer", background: C.bg, color: C.ink, opacity: engine.busy ? 0.5 : 1 }}>
            {t("approval.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}

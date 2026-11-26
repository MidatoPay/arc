import { useEffect, useRef } from "react";
import { useLanguage } from "./i18n.jsx";
import { C, RADIUS, TONES, cta, FONT_MONO } from "./designTokens.js";
import { factoringErrorKey, formatArs, formatDate, formatDateTime, groupCvu } from "./factoring.js";
// Shared pieces of the invoice pilot screens. Inline styles with the provisional
// tokens (docs/DESIGN_TOKENS.md), the same Section/SettingsRow look as Profile.

const STATUS_TONE = { cargada: "neutral", enviada: "info", aceptada: "info", rechazada: "danger", publicada: "accent", oferta_vencida: "neutral",
  tomada: "info", pagos_en_curso: "warning", revision_manual: "warning", cedida: "success", cobrada: "success", en_mora: "danger" };

export const card = { background: C.bg, borderRadius: RADIUS.card, padding: "14px 16px" };
export const label = { display: "block", fontSize: 13, fontWeight: 500, color: C.mut, marginBottom: 6 };
export const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px",
  font: "inherit", fontSize: 15, color: C.ink, background: C.card };
export const secondaryButton = { ...cta, background: C.bg, color: C.ink };
export const primaryButton = (disabled) => ({ ...cta, background: disabled ? C.line : C.orange, color: disabled ? C.mut : "#fff", cursor: disabled ? "not-allowed" : "pointer" });

export function ScreenHeader({ title, onBack }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {onBack && (
        <button type="button" onClick={onBack} aria-label={t("factoring.back")}
          style={{ border: 0, background: C.bg, borderRadius: RADIUS.pill, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer", color: C.ink }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <h2 style={{ fontSize: 22, fontWeight: 500, color: C.ink, margin: 0, letterSpacing: -0.3 }}>{title}</h2>
    </div>
  );
}

export function Badge({ tone = "neutral", children }) {
  const colors = TONES[tone] || TONES.neutral;
  return <span style={{ ...colors, borderRadius: RADIUS.pill, padding: "3px 9px", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{children}</span>;
}

export function StatusBadge({ status }) {
  const { t } = useLanguage();
  return <Badge tone={STATUS_TONE[status]}>{t(`factoring.status.${status}`)}</Badge>;
}

export function InvoiceBadges({ invoice }) {
  const { t } = useLanguage();
  return (
    <>
      {invoice.simulated && <Badge tone="warning">{t("factoring.simulatedBadge")}</Badge>}
      {invoice.isFce && <Badge tone="info">{t("factoring.fceBadge")}</Badge>}
    </>
  );
}

/** Fixed notice while payments run against the simulator. */
export function SimulatedBanner({ paymentsMode }) {
  const { t } = useLanguage();
  if (paymentsMode !== "simulated") return null;
  return <div role="note" style={{ ...TONES.warning, borderRadius: 14, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{t("factoring.simulatedMode")}</div>;
}

export function ErrorMessage({ code, onRetry }) {
  const { t } = useLanguage();
  if (!code) return null;
  return (
    <div role="alert" style={{ ...TONES.danger, borderRadius: 14, padding: "10px 14px", fontSize: 13.5, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
      <span>{t(factoringErrorKey(code))}</span>
      {onRetry && <button type="button" onClick={onRetry} style={{ border: 0, background: "transparent", color: C.red, fontWeight: 600, font: "inherit", cursor: "pointer" }}>{t("factoring.retry")}</button>}
    </div>
  );
}

/** Loading, error (with retry) and empty states shared by the three lists. */
export function ListState({ loading, error, empty, emptyText, onRetry }) {
  const { t } = useLanguage();
  if (loading) return <div role="status" aria-live="polite" style={{ ...card, color: C.mut, fontSize: 14 }}>{t("factoring.loading")}</div>;
  if (error) return <ErrorMessage code={error} onRetry={onRetry} />;
  if (empty) return <div style={{ ...card, color: C.mut, fontSize: 14 }}>{emptyText}</div>;
  return null;
}

export function Money({ value, strong = false }) {
  const { lang } = useLanguage();
  return <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: strong ? 600 : 500, color: C.ink }}>$ {formatArs(value, lang === "en" ? "en" : "es")}</span>;
}

export function Row({ label: text, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: C.mut }}>{text}</span>
      <span style={{ textAlign: "right", color: C.ink, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

export function Cvu({ value }) {
  return <span style={{ fontFamily: FONT_MONO, fontSize: 13.5 }}>{groupCvu(value)}</span>;
}

export function useDate() {
  const { lang } = useLanguage();
  return iso => formatDate(iso, lang === "en" ? "en" : "es");
}

export function InvoiceTitle({ invoice }) {
  const { t } = useLanguage();
  const { cbte } = invoice;
  return <>{t("factoring.invoiceRef", cbte.letra || cbte.tipo, String(cbte.ptoVta).padStart(5, "0"), String(cbte.nro).padStart(8, "0"))}</>;
}

export function NftLine({ nft }) {
  const { t } = useLanguage();
  if (!nft) return null;
  return (
    <div style={{ fontSize: 13, color: C.mut, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span>{t(`factoring.nft.${nft.status}`)}</span>
      {nft.explorerUrl && <a href={nft.explorerUrl} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{t("invoices.viewOnExplorer")}</a>}
    </div>
  );
}

export function Timeline({ items }) {
  const { t, lang } = useLanguage();
  if (!items?.length) return null;
  return (
    <section aria-label={t("factoring.timeline")} style={card}>
      <h3 style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 500, color: C.mut }}>{t("factoring.timeline")}</h3>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.ink }}>
        {items.map((item, i) => <li key={i} style={{ padding: "2px 0" }}>{t(`factoring.status.${item.status}`)} · <span style={{ color: C.mut }}>{formatDateTime(item.at, lang === "en" ? "en" : "es")}</span></li>)}
      </ol>
    </section>
  );
}

/**
 * Confirmation sheet: role=dialog with aria-modal, labelled by its title,
 * initial focus on the title and Escape to close (same as the logout sheet).
 */
export function ConfirmSheet({ id, title, children, confirmLabel, onConfirm, onClose, busy = false, disabled = false, error, danger = false }) {
  const { t } = useLanguage();
  const titleRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = event => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="mp-overlay" role="presentation" onClick={onClose} style={{ background: "rgba(16,16,22,.45)", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={event => event.stopPropagation()}
        style={{ background: C.card, borderRadius: `${RADIUS.sheet}px ${RADIUS.sheet}px 0 0`, padding: "14px 20px calc(22px + env(safe-area-inset-bottom))", width: "100%", boxSizing: "border-box", maxHeight: "90%", overflowY: "auto" }}>
        <div aria-hidden="true" style={{ width: 42, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 18px" }} />
        <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.ink, outline: "none" }}>{title}</h2>
        <div style={{ marginTop: 10, fontSize: 14, color: C.ink, lineHeight: 1.5 }}>{children}</div>
        {error && <div style={{ marginTop: 12 }}><ErrorMessage code={error} /></div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onConfirm} disabled={busy || disabled} aria-busy={busy}
            style={danger ? { ...cta, background: C.red, color: "#fff" } : primaryButton(busy || disabled)}>{busy ? t("factoring.loading") : confirmLabel}</button>
          <button type="button" onClick={onClose} style={secondaryButton}>{t("factoring.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { transferApi } from "./transfers.js";
import { explorerTxUrl } from "./chain.js";
import { useOptionalLanguage } from "./i18n.jsx";
import { transferErrorText } from "./errorText.js";
import { exactAmount, Spinner, NETWORK_LABEL, networkFeeText } from "./TransferApproval.jsx";
import { isAddress } from "./arc.js";

// Recibo de un envío USDC: sigue el estado real (polling) hasta completed/failed.
// Nunca presenta como enviado algo pendiente, fallido o en revisión.
// useOptionalLanguage: fuera del LanguageProvider (tests estáticos) se muestra en español.
const C = { bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0", accent: "#fe6c1c", orangeSoft: "#FFEADF", green: "#21B95B", red: "#E4483D" };
const TONES = {
  green: { bg: "#E7F7EE", fg: "#15803D" },
  amber: { bg: "#FFF3E6", fg: "#B45309" },
  red: { bg: "#FDECEA", fg: "#C0392B" },
};
// Tono y título por estado; los textos salen de transferReceipt.* en i18n.
const STATUS = {
  awaiting_signature: { tone: "amber", title: "sending", hint: true },
  broadcasting: { tone: "amber", title: "sending", hint: true },
  confirmed: { tone: "amber", title: "sending", hint: true },
  completed: { tone: "green", title: "sent" },
  failed: { tone: "red", title: "failed" },
  manual_review: { tone: "amber", title: "review", hint: true },
};
const FALLBACK = { tone: "amber", title: "sending" };
const shortId = (a) => (a && a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a || "—");

const Svg = ({ size, children }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
const stroke = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };
const IconCheck = ({ size = 30 }) => <Svg size={size}><path d="M5 12.5l5 5L19 7" {...stroke} strokeWidth="2.6" /></Svg>;
const IconClose = ({ size = 28 }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth="2.4" /></Svg>;
const IconClock = ({ size = 28 }) => <Svg size={size}><circle cx="12" cy="12" r="8.5" {...stroke} strokeWidth="2.1" /><path d="M12 7.5V12l3 2" {...stroke} strokeWidth="2.1" /></Svg>;
const IconCopy = ({ size = 18 }) => <Svg size={size}><rect x="8" y="8" width="12" height="12" rx="2" {...stroke} strokeWidth="1.9" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke} strokeWidth="1.9" /></Svg>;
const IconExternal = ({ size = 15 }) => <Svg size={size}><path d="M14 5h5v5M10 14L19 5" {...stroke} strokeWidth="2" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" {...stroke} strokeWidth="2" /></Svg>;
const IconHome = ({ size = 24 }) => <Svg size={size}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1v-9.5Z" {...stroke} strokeWidth="1.8" /></Svg>;
const IconList = ({ size = 24 }) => <Svg size={size}><path d="M5 7h14M5 12h14M5 17h14" {...stroke} strokeWidth="1.9" /></Svg>;
const IconSend = ({ size = 24 }) => <Svg size={size}><path d="M7 17 17 7M9 7h8v8" {...stroke} strokeWidth="2" /></Svg>;

function TicketDivider() {
  const notch = { position: "absolute", top: 0, width: 22, height: 22, borderRadius: "50%", background: C.bg };
  return (
    <div aria-hidden="true" style={{ position: "relative", height: 22 }}>
      <span style={{ ...notch, left: -11 }} />
      <span style={{ ...notch, right: -11 }} />
      <div style={{ position: "absolute", left: 20, right: 20, top: 10, borderTop: "1.5px dashed #DCDCE2" }} />
    </div>
  );
}

function Action({ icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "6px 4px", color: C.accent }}>
      {icon}
      <span style={{ fontSize: 12.5, fontWeight: 500, color: C.ink, lineHeight: 1.25, textAlign: "center", whiteSpace: "pre-line" }}>{label}</span>
    </button>
  );
}

function StatusIcon({ status, tone }) {
  const ring = { width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 14px" };
  if (tone === "green") return <div style={{ ...ring, background: C.green, color: "#fff", boxShadow: "0 10px 28px rgba(33,185,91,0.30)" }}><IconCheck /></div>;
  if (tone === "red") return <div style={{ ...ring, background: TONES.red.bg, color: C.red }}><IconClose /></div>;
  if (status === "manual_review") return <div style={{ ...ring, background: TONES.amber.bg, color: TONES.amber.fg }}><IconClock /></div>;
  return <div style={{ ...ring, background: C.orangeSoft, color: C.accent }}><Spinner size={30} /></div>;
}

export default function TransferReceipt({ transfer: initial, getAccessToken, onClose, onUpdate }) {
  const lang = useOptionalLanguage();
  const { t, locale } = lang;
  const [transfer, setTransfer] = useState(initial), [error, setError] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => {
    let canceled = false, timer;
    const poll = async () => {
      try {
        const { transfer: t } = await transferApi(`/transfers/${initial.id}`, getAccessToken);
        if (canceled) return;
        setTransfer(t); setError(false); onUpdate?.(t);
        if (!["completed", "failed"].includes(t.status)) timer = setTimeout(poll, t.status === "manual_review" ? 15000 : 2500);
      } catch {
        if (!canceled) { setError(true); timer = setTimeout(poll, 10000); }
      }
    };
    poll();
    return () => { canceled = true; clearTimeout(timer); };
  }, [initial.id, getAccessToken]);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const known = STATUS[transfer.status];
  const status = known || FALLBACK;
  const tone = TONES[status.tone];
  const statusLabel = t(`transferReceipt.status.${known ? transfer.status : "unknown"}`);
  const hint = status.hint ? t(`transferReceipt.hint.${transfer.status}`) : "";
  const network = NETWORK_LABEL[transfer.network] || transfer.network || "";
  const when = new Date(transfer.finalizedAt || transfer.createdAt || "");
  const dateText = Number.isFinite(when.getTime())
    ? t("transferReceipt.date", when.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
      when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))
    : "";
  const copyTxHash = async () => {
    try { await navigator.clipboard.writeText(transfer.txHash); setCopied(true); } catch { /* sin permiso de portapapeles */ }
  };
  const label = { fontSize: 14, color: C.mut };
  const value = { fontSize: 14, color: C.ink, fontWeight: 600, textAlign: "right" };

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "100%", background: C.bg }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 18px 20px" }}>
        <div style={{ background: C.card, borderRadius: 22, boxShadow: "0 8px 24px rgba(22,22,26,0.05)" }}>
          <div style={{ padding: "26px 20px 18px", textAlign: "center" }}>
            <StatusIcon status={transfer.status} tone={status.tone} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: C.mut }}>{t(`transferReceipt.title.${status.title}`)}</h2>
            <div style={{ marginTop: 6, fontSize: 32, fontWeight: 500, color: C.ink, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, overflowWrap: "anywhere" }}>
              {exactAmount(transfer.usdc, locale)} USDC
            </div>
            {dateText && <div style={{ marginTop: 8, fontSize: 13.5, color: C.mut }}>{dateText}</div>}
            <div aria-live="polite" style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8, background: tone.bg, color: tone.fg, borderRadius: 999, padding: "7px 14px", fontSize: 14, fontWeight: 600 }}>
              {statusLabel}
            </div>
            {hint && <div style={{ marginTop: 10, fontSize: 13, color: C.mut, lineHeight: 1.45 }}>{hint}</div>}
            {transfer.lastError && <div role="status" style={{ marginTop: 10, fontSize: 13, color: C.red, lineHeight: 1.45 }}>{transferErrorText(lang, transfer.lastError)}</div>}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: C.red, lineHeight: 1.45 }}>{t("transferReceipt.pollError")}</div>}
          </div>
          <TicketDivider />
          <div style={{ padding: "14px 20px 22px", display: "grid", gap: 14 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
                <span style={label}>{t("transferReceipt.to")}</span>
                <span style={{ ...value, overflowWrap: "anywhere" }}>
                  {/* Sin agendar, el "nombre" es la propia dirección: no repetirla, ya se muestra completa abajo. */}
                  {transfer.recipient && !isAddress(transfer.recipient.trim()) && transfer.recipient.trim() !== transfer.to
                    ? transfer.recipient : t("transferReceipt.arcWallet")}
                </span>
              </div>
              <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5, color: C.mut, textAlign: "right", wordBreak: "break-all" }}>{transfer.to}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><span style={label}>{t("transferReceipt.network")}</span><span style={value}>{network}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><span style={label}>{t("transferReceipt.cost")}</span><span style={value}>{networkFeeText(transfer.maxNetworkFeeUsdc, locale) || "—"}</span></div>
            {transfer.txHash && (
              <>
                <div aria-hidden="true" style={{ borderTop: "1.5px dashed #DCDCE2", margin: "4px 0 0" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={label}>{t("transferReceipt.txId")}</div>
                    <div style={{ marginTop: 3, fontSize: 14, fontWeight: 600, color: C.accent, fontFamily: "ui-monospace, monospace" }}>{shortId(transfer.txHash)}</div>
                  </div>
                  <button type="button" onClick={copyTxHash} aria-label={copied ? t("transferReceipt.copied") : t("transferReceipt.copy")}
                    style={{ border: 0, background: "transparent", color: copied ? C.green : C.accent, cursor: "pointer", padding: 8, margin: -4, display: "grid", placeItems: "center" }}>
                    {copied ? <IconCheck size={18} /> : <IconCopy />}
                  </button>
                </div>
                <a href={explorerTxUrl(transfer.txHash)} target="_blank" rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.accent, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
                  {t("transferReceipt.viewOnchain")}<IconExternal />
                </a>
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", background: C.card, borderRadius: "22px 22px 0 0", boxShadow: "0 -6px 24px rgba(22,22,26,0.06)", padding: "12px 8px calc(14px + env(safe-area-inset-bottom))" }}>
        <Action icon={<IconHome />} label={t("transferReceipt.home")} onClick={() => onClose("home")} />
        <Action icon={<IconList />} label={t("transferReceipt.activity")} onClick={() => onClose("movs")} />
        <Action icon={<IconSend />} label={t("transferReceipt.sendAgain")} onClick={() => onClose("send")} />
      </div>
    </section>
  );
}

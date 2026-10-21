import { Fragment, useMemo, useState } from "react";
import { isAddress } from "@solana/kit";
import { useLanguage } from "./i18n.jsx";
import { SOLANA } from "./chain.js";
import { searchContacts } from "./contacts.js";
import { parseScanTarget } from "./scanTarget.js";
import { AmountStep, Header, IconWallet, scanErrorText } from "./PayScan.jsx";

// Enviar: elegir destinatario (agenda o dirección Solana pegada) y después el mismo paso de monto que Pagar.
const C = { bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0", accent: "#fe6c1c", orangeSoft: "#FFEADF", red: "#E4483D" };
const page = { display: "flex", flexDirection: "column", height: "100%", minHeight: "100%", padding: "10px 18px 18px", boxSizing: "border-box", background: C.card };
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : "—");

const Svg = ({ size, children }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
const stroke = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };
const IconSearch = () => <Svg size={19}><circle cx="11" cy="11" r="6.5" {...stroke} strokeWidth="1.9" /><path d="M16 16l4 4" {...stroke} strokeWidth="1.9" /></Svg>;
const IconChevron = () => <Svg size={18}><path d="M9 5l7 7-7 7" {...stroke} strokeWidth="1.9" /></Svg>;
const IconClear = () => <Svg size={16}><path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth="2.2" /></Svg>;

function RecipientRow({ avatar, title, subtitle, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", border: 0, background: "transparent", padding: "12px 0", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}>
      <span style={{ width: 40, height: 40, borderRadius: "50%", background: C.orangeSoft, color: C.accent, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 600, fontSize: 15 }}>
        {avatar}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: C.mut, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</span>
      </span>
      <span style={{ color: C.mut, display: "grid", placeItems: "center", flexShrink: 0 }}><IconChevron /></span>
    </button>
  );
}

function RowGroup({ children }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <div style={{ background: C.bg, borderRadius: 22, padding: "2px 14px" }}>
      {items.map((child, index) => (
        <Fragment key={child.key ?? index}>
          {index > 0 && <div aria-hidden="true" style={{ height: 1, background: C.line }} />}
          {child}
        </Fragment>
      ))}
    </div>
  );
}

const sectionTitle = { margin: "20px 0 10px", fontSize: 14, fontWeight: 500, color: C.mut };

export default function SendScreen({ address, balance, fxRate, contacts, onPay, onDone, onBack }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState(null);
  const [targetId, setTargetId] = useState(0);

  // Solo contactos con dirección Solana válida (los EVM históricos no se ofrecen para enviar).
  const sendable = useMemo(() => contacts.filter((c) => isAddress(c.addr || "")), [contacts]);
  const trimmed = query.trim();
  const parsed = trimmed ? parseScanTarget(trimmed, { mint: SOLANA.usdcMint, self: address }) : null;
  const direct = parsed && !parsed.error ? parsed : null;
  const directError = parsed?.error && !["invalid", "empty"].includes(parsed.error) ? parsed.error : null;
  const directContact = direct ? sendable.find((c) => c.addr === direct.addr) : null;
  const matches = useMemo(() => {
    if (directContact) return [directContact];
    if (direct || directError) return [];
    return searchContacts(sendable, trimmed.replace(/^@/, ""));
  }, [sendable, trimmed, direct, directContact, directError]);
  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

  const pick = (next) => {
    setTarget(next);
    setTargetId((n) => n + 1);
  };
  const pickContact = (c) => pick({ kind: "pay", addr: c.addr, name: c.name, usdc: null, ars: null, factura: "" });
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setQuery(text.trim());
    } catch { /* El navegador no dio permiso de portapapeles. */ }
  };

  if (target) {
    return (
      <AmountStep key={targetId} target={target} title={t("send.title")} onBack={() => setTarget(null)}
        balance={balance} fxRate={fxRate} contacts={contacts} onPay={onPay} onDone={onDone} />
    );
  }

  const contactRow = (c) => (
    <RecipientRow key={c.id || c.alias} avatar={(c.name || "?").slice(0, 1).toUpperCase()} title={c.name}
      subtitle={`@${c.alias} · ${shortAddr(c.addr)}`} label={t("sendFlow.selectAria", c.name)} onClick={() => pickContact(c)} />
  );

  return (
    <section style={page}>
      <Header title={t("send.title")} onBack={onBack} backLabel={t("scan.back")} />

      <label htmlFor="mp-send-search" style={{ ...sectionTitle, display: "block", margin: "16px 0 8px" }}>{t("sendFlow.searchLabel")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 16, padding: "0 8px 0 14px", border: `1px solid ${directError ? C.red : "transparent"}`, flexShrink: 0 }}>
        <span style={{ color: C.mut, display: "grid", placeItems: "center" }}><IconSearch /></span>
        <input id="mp-send-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sendFlow.searchPlaceholder")}
          autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={directError ? true : undefined}
          aria-describedby={directError ? "mp-send-error" : undefined}
          style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", padding: "14px 0", font: "inherit", fontSize: 15, color: C.ink, outline: "none" }} />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label={t("sendFlow.clear")}
            style={{ width: 32, height: 32, border: 0, borderRadius: 10, background: "transparent", color: C.mut, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
            <IconClear />
          </button>
        ) : canPaste && (
          <button type="button" onClick={paste}
            style={{ border: 0, borderRadius: 999, background: C.orangeSoft, color: C.accent, font: "inherit", fontSize: 13, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>
            {t("scan.paste")}
          </button>
        )}
      </div>
      {directError && (
        <div id="mp-send-error" role="alert" style={{ marginTop: 10, fontSize: 13, color: C.red, lineHeight: 1.45 }}>
          <strong style={{ fontWeight: 600 }}>{scanErrorText(t, directError, "title")}.</strong> {scanErrorText(t, directError, "body")}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 4 }}>
        {direct && !directContact && (
          <>
            <div style={sectionTitle}>{t("sendFlow.newAddress")}</div>
            <RowGroup>
              <RecipientRow key="direct" avatar={<IconWallet />} title={direct.name || t("scan.solanaWallet")}
                subtitle={`${shortAddr(direct.addr)} · USDC Solana`} label={t("sendFlow.selectAria", shortAddr(direct.addr))} onClick={() => pick(direct)} />
            </RowGroup>
          </>
        )}
        {matches.length > 0 && (
          <>
            <div style={sectionTitle}>{trimmed ? t("sendFlow.results") : t("sendFlow.contacts")}</div>
            <RowGroup>{matches.map(contactRow)}</RowGroup>
          </>
        )}
        {!direct && !directError && matches.length === 0 && (
          <div style={{ marginTop: 20, background: C.bg, borderRadius: 22, padding: 20, fontSize: 14, color: C.mut, lineHeight: 1.55, textAlign: "center" }}>
            {trimmed ? t("sendFlow.noMatch", trimmed) : t("sendFlow.noContacts")}
          </div>
        )}
      </div>
    </section>
  );
}

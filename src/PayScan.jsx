import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "./i18n.jsx";
import { SOLANA } from "./chain.js";
import { exactUsdc } from "./transfers.js";
import { nuevaFactura } from "./solana.js";
import { parseScanTarget } from "./scanTarget.js";
import { transferErrorText } from "./errorText.js";
import QrScanner from "./QrScanner.jsx";
import { AmountKeypad } from "./MercadoPagoCharge.jsx";

// Pagar: escanear (o pegar) el QR de una wallet Solana / cobro MidatoPay y enviar USDC.
// El envío usa el motor existente (onPay → aprobación con Privy → recibo); acá solo cambia la interfaz.
const C = {
  bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0",
  orange: "#FF5A00", accent: "#fe6c1c", orangeSoft: "#FFEADF", red: "#E4483D", redSoft: "#FDECEA",
};
const cta = { border: 0, borderRadius: 18, padding: "16px 18px", font: "inherit", fontSize: 16, fontWeight: 600, cursor: "pointer", width: "100%" };
const NETWORK_NAME = SOLANA.cluster === "devnet" ? "Devnet" : "Mainnet";

const fmtArs = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsdc = (n, locale) => Number(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : "—");
const decimalSep = (locale) => (1.5).toLocaleString(locale).charAt(1);

/** Teclado de USDC: coma decimal, hasta 6 decimales y 9 dígitos enteros. */
function appendUsdcDigit(prev, key) {
  const cur = String(prev || "");
  if (key === "back") return cur.slice(0, -1);
  if (key === ",") return cur.includes(",") ? cur : `${cur || "0"},`;
  if (cur.includes(",")) return (cur.split(",")[1] || "").length >= 6 ? cur : cur + key;
  if (cur === "0") return key;
  return cur.length >= 9 ? cur : cur + key;
}

function formatTyped(raw, locale) {
  if (!raw) return "0";
  const [intPart, dec] = raw.split(",");
  const int = Number(intPart || "0").toLocaleString(locale);
  return dec === undefined ? int : `${int}${decimalSep(locale)}${dec}`;
}

const Svg = ({ size, children }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
const stroke = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };
const IconBack = ({ size = 22 }) => <Svg size={size}><path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2.4" /></Svg>;
const IconFlash = ({ size = 24 }) => <Svg size={size}><path d="M9 3.5h6l1.8 4.2H7.2L9 3.5Z" {...stroke} strokeWidth="1.7" /><path d="M7.2 7.7h9.6v1.6l-1.5 2.3V20H8.7v-8.4L7.2 9.3V7.7Z" {...stroke} strokeWidth="1.7" /><path d="M12 13v3" {...stroke} strokeWidth="1.7" /></Svg>;
const IconQr = ({ size = 40 }) => <Svg size={size}><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" {...stroke} strokeWidth="1.8" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" {...stroke} strokeWidth="1.8" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" {...stroke} strokeWidth="1.8" /><path d="M14 14h2.5v2.5M20.5 14v.01M14 20.5h.01M17.5 17.5v3h3" {...stroke} strokeWidth="1.8" /></Svg>;
const IconCamera = ({ size = 40 }) => <Svg size={size}><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" {...stroke} strokeWidth="1.7" /><circle cx="12" cy="13" r="3.2" {...stroke} strokeWidth="1.7" /></Svg>;
export const IconWallet = ({ size = 20 }) => <Svg size={size}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" {...stroke} strokeWidth="1.8" /><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" {...stroke} strokeWidth="1.8" /><circle cx="16.2" cy="13.5" r="1.1" fill="currentColor" /></Svg>;

export function Header({ title, onBack, backLabel }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40, flexShrink: 0 }}>
      <button type="button" onClick={onBack} aria-label={backLabel}
        style={{ position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, border: 0, borderRadius: 12, background: "transparent", color: C.ink, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
        <IconBack />
      </button>
      {title && <div style={{ fontSize: 16, fontWeight: 500, color: C.ink }}>{title}</div>}
    </div>
  );
}

const fromPayRequest = (req) => (req
  ? { kind: "charge_p2p", addr: req.addr, name: req.who || "", ars: req.ars, factura: req.factura || "", usdc: null } : null);

export default function PayScan({
  address, balance, fxRate, contacts, onPay, onDone, scanRequest, onScanRequestConsumed, onBack, onFullscreenChange,
}) {
  const { t, locale } = useLanguage();
  const [view, setView] = useState(scanRequest ? "amount" : "scan"); // scan | link | invalid | amount
  const [target, setTarget] = useState(() => fromPayRequest(scanRequest));
  const [reason, setReason] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraKey, setCameraKey] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [targetId, setTargetId] = useState(0); // reinicia el paso de monto en cada destino nuevo

  // Pagar siempre ocupa toda la pantalla, como Cobrar.
  useEffect(() => { onFullscreenChange?.(true); }, [onFullscreenChange]);

  useEffect(() => {
    if (!scanRequest) return;
    setTarget(fromPayRequest(scanRequest));
    setTargetId((n) => n + 1);
    setView("amount");
    onScanRequestConsumed?.();
  }, [scanRequest, onScanRequestConsumed]);

  const openScan = () => {
    setView("scan");
    setTarget(null);
    setReason("");
    setCameraError("");
    setTorchOn(false);
  };
  const openLink = () => {
    setLinkText("");
    setLinkError("");
    setView("link");
  };
  const accept = (raw) => {
    const result = parseScanTarget(raw, { mint: SOLANA.usdcMint, self: address });
    if (result.error) return result.error;
    setTarget(result);
    setTargetId((n) => n + 1);
    setView("amount");
    return null;
  };
  const onDecode = (raw) => {
    const error = accept(raw);
    if (error) {
      setReason(error);
      setView("invalid");
    }
  };
  const submitLink = () => {
    const error = accept(linkText);
    if (error) setLinkError(error);
  };
  const pasteLink = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setLinkText(text.trim()); setLinkError(""); }
    } catch { /* El navegador no dio permiso de portapapeles. */ }
  };

  const errorText = (code, part) => scanErrorText(t, code, part);
  const cameraText = { denied: t("scan.cameraDenied"), insecure: t("scan.cameraInsecure") }[cameraError] || t("scan.cameraUnavailable");

  if (view === "scan") {
    return (
      <div className="mp-guest-scan mp-pay-scan">
        <div className="mp-guest-scan-top">
          <button type="button" onClick={onBack} className="mp-guest-scan-iconbtn" aria-label={t("scan.back")}
            style={{ display: "grid", placeItems: "center" }}>
            <IconBack />
          </button>
        </div>
        <div style={{ position: "absolute", top: 22, left: 64, right: 64, zIndex: 5, textAlign: "center", fontSize: 16, fontWeight: 500 }}>
          {t("scan.title")}
        </div>
        {cameraError ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 32px 120px", textAlign: "center", background: "#0b0b0d" }}>
            <div style={{ color: "rgba(255,255,255,.7)" }}><IconCamera size={44} /></div>
            <div role="alert" style={{ fontSize: 15, lineHeight: 1.5, color: "rgba(255,255,255,.88)", maxWidth: 280 }}>{cameraText}</div>
            {cameraError !== "insecure" && cameraError !== "unsupported" && (
              <button type="button" onClick={() => { setCameraError(""); setCameraKey((k) => k + 1); }}
                style={{ border: "1px solid rgba(255,255,255,.35)", background: "transparent", color: "#fff", borderRadius: 999, padding: "9px 18px", font: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                {t("scan.retryCamera")}
              </button>
            )}
          </div>
        ) : (
          <div className="mp-guest-scan-stage">
            <QrScanner key={cameraKey} fill torchOn={torchOn} onDecode={onDecode} onCameraError={setCameraError} onTorchSupport={setTorchSupported} />
            <div className="mp-guest-scan-frame" aria-hidden="true" />
            <div className="mp-guest-scan-laser" aria-hidden="true" />
            <div style={{ position: "absolute", left: 28, right: 28, top: "calc(42% + min(35vw, 130px) + 22px)", zIndex: 4, textAlign: "center", fontSize: 13.5, lineHeight: 1.45, color: "rgba(255,255,255,.85)" }}>
              {t("scan.hint")}
            </div>
          </div>
        )}
        <div className="mp-guest-scan-bottom">
          {torchSupported && !cameraError && (
            <button type="button" onClick={() => setTorchOn((v) => !v)} className={`mp-guest-scan-flash${torchOn ? " is-on" : ""}`}
              aria-label={t("scan.flash")} aria-pressed={torchOn}>
              <IconFlash />
            </button>
          )}
          <button type="button" onClick={openLink} style={{ ...cta, background: "#fff", color: C.ink }}>
            {t("scan.enterManually")}
          </button>
        </div>
      </div>
    );
  }

  if (view === "link") {
    const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);
    return (
      <section style={page}>
        <Header title={t("scan.payTitle")} onBack={openScan} backLabel={t("scan.back")} />
        <h2 style={{ fontSize: 22, fontWeight: 500, color: C.ink, margin: "18px 0 6px", letterSpacing: -0.3 }}>{t("scan.linkTitle")}</h2>
        <p style={{ fontSize: 14, color: C.mut, lineHeight: 1.5, margin: "0 0 16px" }}>{t("scan.linkBody")}</p>
        <label htmlFor="mp-pay-link" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("scan.linkPlaceholder")}</label>
        <div style={{ position: "relative" }}>
          <textarea id="mp-pay-link" value={linkText} rows={3} autoFocus spellCheck={false} autoCapitalize="off" autoComplete="off"
            onChange={(event) => { setLinkText(event.target.value); setLinkError(""); }} placeholder={t("scan.linkPlaceholder")}
            aria-invalid={linkError ? true : undefined} aria-describedby={linkError ? "mp-pay-link-error" : undefined}
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${linkError ? C.red : C.line}`, borderRadius: 16, padding: canPaste ? "14px 76px 14px 16px" : "14px 16px", fontSize: 14.5, fontFamily: "ui-monospace, monospace", color: C.ink, background: C.bg, outline: "none", resize: "none", wordBreak: "break-all" }} />
          {canPaste && (
            <button type="button" onClick={pasteLink}
              style={{ position: "absolute", top: 10, right: 10, border: 0, borderRadius: 999, background: C.orangeSoft, color: C.accent, font: "inherit", fontSize: 13, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>
              {t("scan.paste")}
            </button>
          )}
        </div>
        {linkError && (
          <div id="mp-pay-link-error" role="alert" style={{ marginTop: 10, fontSize: 13, color: C.red, lineHeight: 1.45 }}>
            <strong style={{ fontWeight: 600 }}>{errorText(linkError, "title")}.</strong> {errorText(linkError, "body")}
          </div>
        )}
        <div style={{ marginTop: "auto", paddingTop: 20 }}>
          <button type="button" onClick={submitLink} disabled={!linkText.trim()}
            style={{ ...cta, background: C.orange, color: "#fff", opacity: linkText.trim() ? 1 : 0.4, boxShadow: linkText.trim() ? "0 8px 20px rgba(255,90,0,0.28)" : "none" }}>
            {t("scan.continue")}
          </button>
        </div>
      </section>
    );
  }

  if (view === "invalid") {
    return (
      <section style={page}>
        <Header onBack={onBack} backLabel={t("scan.back")} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 12, padding: "0 10px" }}>
          <div style={{ width: 84, height: 84, borderRadius: 24, background: C.redSoft, color: C.red, display: "grid", placeItems: "center" }}><IconQr /></div>
          <div role="alert" style={{ fontSize: 20, fontWeight: 500, color: C.ink, marginTop: 6 }}>{errorText(reason, "title")}</div>
          <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.5, maxWidth: 290 }}>{errorText(reason, "body")}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" onClick={openScan} style={{ ...cta, background: C.ink, color: "#fff" }}>{t("scan.scanAgain")}</button>
          <button type="button" onClick={openLink} style={{ ...cta, background: C.bg, color: C.ink }}>{t("scan.enterManually")}</button>
        </div>
      </section>
    );
  }

  return (
    <AmountStep key={targetId} target={target} title={t("scan.payTitle")} onBack={openScan}
      balance={balance} fxRate={fxRate} contacts={contacts} onPay={onPay} onDone={onDone} />
  );
}

export const scanErrorText = (t, code, part) => t(`scan.errors.${code || "invalid"}.${part}`);
const page = { display: "flex", flexDirection: "column", height: "100%", minHeight: "100%", padding: "10px 18px 18px", boxSizing: "border-box", background: C.card };

/**
 * Paso de monto compartido por Pagar y Enviar: destinatario, monto en USDC (o fijo del QR) y Continuar.
 * Continuar abre la aprobación existente (TransferApproval) a través de onPay.
 */
export function AmountStep({ target, title, onBack, balance, fxRate, contacts, onPay, onDone }) {
  const langCtx = useLanguage();
  const { t, locale } = langCtx;
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null); // Error del envío; se traduce al mostrarlo
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const contact = contacts.find((c) => c.addr === target.addr) || null;
  const generic = /^(your commerce|tu comercio)$/i.test(String(target.name || "").trim());
  const displayName = contact?.name || (!generic && target.name) ||
    (target.kind === "charge_p2p" ? t("scan.merchantQr") : t("scan.solanaWallet"));
  const fixedArs = target.ars ?? null;
  const fixedUsdc = target.usdc ?? null;
  const editable = fixedArs == null && fixedUsdc == null;

  const usdcText = useMemo(() => {
    try {
      if (fixedArs != null) {
        if (!(fxRate > 0)) return null;
        return exactUsdc((Math.floor((fixedArs / fxRate) * 1000000) / 1000000).toFixed(6));
      }
      const value = fixedUsdc ?? amount.replace(",", ".");
      return value ? exactUsdc(value) : null;
    } catch {
      return null;
    }
  }, [fixedArs, fixedUsdc, amount, fxRate]);
  const usdc = usdcText ? Number(usdcText) : 0;
  const insufficient = balance !== null && usdc > balance;
  // Dirección que no está en la agenda: primero se confirma la red/dirección en un aviso.
  const [addressConfirmed, setAddressConfirmed] = useState(() => !(target.kind === "pay" && !contact));
  const canContinue = Boolean(usdcText) && !insufficient && !busy && addressConfirmed;

  const useAll = () => {
    if (!(balance > 0)) return;
    const floored = Math.floor(balance * 1000000) / 1000000;
    setAmount(floored.toFixed(6).replace(/\.?0+$/, "").replace(".", ","));
  };

  const submit = async () => {
    if (!canContinue) return;
    setBusy(true);
    setSendError(null);
    const parsed = {
      amount: fixedArs ?? usdc,
      currency: fixedArs != null ? "ARS" : "USDC",
      usdc,
      usdcText,
      fxRate,
      contact: { name: displayName, alias: contact?.alias || "qr", addr: target.addr },
      factura: target.factura || nuevaFactura(),
      kind: target.kind,
    };
    try {
      const result = await onPay(parsed);
      onDone({ ...result, direction: "out", parsed, ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) });
    } catch (error) {
      if (mounted.current) setSendError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const bigText = fixedArs != null ? `$ ${fmtArs(fixedArs)}` : fixedUsdc != null ? fmtUsdc(fixedUsdc, locale) : formatTyped(amount, locale);
  const bigUnit = fixedArs != null ? "ARS" : "USDC";
  const empty = editable && !amount;
  const subLine = fixedArs != null
    ? (usdcText ? t("scan.approxUsdc", fmtUsdc(usdc, locale)) : "")
    : (usdc > 0 && fxRate > 0 ? t("scan.approxArs", fmtArs(usdc * fxRate)) : "");
  return (
    <section style={page}>
      <Header title={title} onBack={onBack} backLabel={t("scan.back")} />

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, background: C.bg, borderRadius: 18, padding: "12px 14px", flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.orangeSoft, color: C.accent, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 600 }}>
          {contact ? (contact.name || "?").slice(0, 1).toUpperCase() : <IconWallet />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
          <div style={{ fontSize: 12.5, color: C.mut, marginTop: 2, fontFamily: "ui-monospace, monospace" }} title={target.addr}>{shortAddr(target.addr)}</div>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: C.mut, textAlign: "right", flexShrink: 0, lineHeight: 1.3 }}>
          USDC<br />Solana {NETWORK_NAME}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", textAlign: "center" }}>
        <div aria-live="polite" style={{ fontSize: empty ? 44 : 48, fontWeight: 500, letterSpacing: -1, color: empty ? "#C5C5CC" : C.ink, lineHeight: 1.05, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
          {bigText}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: C.mut }}>
          {bigUnit === "USDC" && <img src="/monedas/usdc.png" alt="" width={18} height={18} style={{ width: 18, height: 18, borderRadius: "50%" }} />}
          {bigUnit}
        </div>
        {subLine && <div style={{ fontSize: 13, color: C.mut }}>{subLine}</div>}
        {editable ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5, color: C.mut }}>
            <span>{t("scan.available", balance === null ? "—" : fmtUsdc(balance, locale))}</span>
            {balance > 0 && (
              <button type="button" onClick={useAll} disabled={busy}
                style={{ border: `1px solid ${C.line}`, background: C.card, color: C.accent, borderRadius: 999, padding: "5px 11px", font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {t("scan.useAll")}
              </button>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 6, fontSize: 12.5, color: C.mut }}>{t("scan.fixedAmount")}</div>
        )}
      </div>

      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {editable && <AmountKeypad disabled={busy} onKey={(key) => setAmount((prev) => appendUsdcDigit(prev, key))} />}
        {(insufficient || sendError) && (
          <div role="alert" style={{ fontSize: 13, color: C.red, textAlign: "center", lineHeight: 1.45 }}>
            {insufficient ? t("scan.insufficient") : transferErrorText(langCtx, sendError)}
          </div>
        )}
        {target.solanaPay && (
          <div style={{ fontSize: 11.5, color: C.mut, textAlign: "center", lineHeight: 1.45 }}>{t("scan.solanaPayNote")}</div>
        )}
        <button type="button" onClick={submit} disabled={!canContinue} aria-busy={busy || undefined}
          style={{ ...cta, background: C.orange, color: "#fff", opacity: canContinue ? 1 : 0.4, boxShadow: canContinue ? "0 8px 20px rgba(255,90,0,0.28)" : "none" }}>
          {busy ? t("scan.working") : t("scan.continue")}
        </button>
      </div>
      {!addressConfirmed && <AddressCheck addr={target.addr} onConfirm={() => setAddressConfirmed(true)} onBack={onBack} />}
    </section>
  );
}

const IconAlert = ({ size = 26 }) => <Svg size={size}><path d="M12 4.5 21 19.5H3L12 4.5Z" {...stroke} strokeWidth="1.9" /><path d="M12 10v4.2M12 17h.01" {...stroke} strokeWidth="2.2" /></Svg>;

/** Aviso al llegar con una dirección nueva: verificar dirección y red antes de poder enviar. */
function AddressCheck({ addr, onConfirm, onBack }) {
  const { t } = useLanguage();
  const titleRef = useRef(null);
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") backRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const strong = { color: C.ink, fontWeight: 700 };
  return (
    <div className="mp-overlay" style={{ background: "rgba(16,16,22,.55)", padding: 18, boxSizing: "border-box" }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="mp-address-check-title" aria-describedby="mp-address-check-body"
        style={{ background: C.card, borderRadius: 24, padding: "24px 20px 20px", width: "100%", maxWidth: 360, boxSizing: "border-box", textAlign: "center" }}>
        <div aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "50%", background: "#FFF3E6", color: "#B45309", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <IconAlert />
        </div>
        <h2 id="mp-address-check-title" ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 19, fontWeight: 500, color: C.ink, outline: "none" }}>
          {t("scan.verifyTitle")}
        </h2>
        <p id="mp-address-check-body" style={{ margin: "8px 0 16px", fontSize: 14, color: C.mut, lineHeight: 1.5 }}>{t("scan.networkWarning")}</p>
        <div style={{ background: C.bg, borderRadius: 16, padding: "12px 14px", textAlign: "left" }}>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>{t("scan.verifyAddressLabel")} · USDC Solana {NETWORK_NAME}</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, lineHeight: 1.55, wordBreak: "break-all", color: C.mut }}>
            <span style={strong}>{addr.slice(0, 4)}</span>{addr.slice(4, -4)}<span style={strong}>{addr.slice(-4)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onConfirm} style={{ ...cta, background: C.orange, color: "#fff" }}>{t("scan.verifyConfirm")}</button>
          <button type="button" onClick={onBack} style={{ ...cta, background: C.bg, color: C.ink }}>{t("scan.verifyBack")}</button>
        </div>
      </div>
    </div>
  );
}

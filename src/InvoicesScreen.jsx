import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "./i18n.jsx";
import { C, TONES } from "./designTokens.js";
import QrScanner from "./QrScanner.jsx";
import { validateInvoiceInput, INVOICE_TYPES, formatCuit } from "./invoiceQr.js";
import { centsToArs } from "./invoiceCession.js";
import { decodeQrFromImageFile } from "./invoiceFile.js";
import { factoringApi, newIdempotencyKey, argentinaToday, formatDateTime } from "./factoring.js";
import { ScreenHeader, SimulatedBanner, StatusBadge, InvoiceBadges, ListState, ErrorMessage, ConfirmSheet, Money, Row, NftLine,
  Timeline, InvoiceTitle, useDate, card, label, input, primaryButton, secondaryButton } from "./FactoringParts.jsx";
// Issuer screen of the invoice cession pilot (plan 9.1): list, new invoice by
// form (SIMULATED) or fiscal QR, and detail with "send to the debtor".

/** The line that tells which deadline is running for this invoice. */
export function DeadlineLine({ invoice }) {
  const { t, lang } = useLanguage();
  const date = useDate();
  let text = null;
  if (invoice.status === "enviada" && invoice.tacitAcceptanceOn) text = t("invoices.tacitOn", date(invoice.tacitAcceptanceOn));
  else if (invoice.status === "publicada" && invoice.offer?.expiresAt) text = t("invoices.offerExpiresAt", formatDateTime(invoice.offer.expiresAt, lang === "en" ? "en" : "es"));
  else if (!["rechazada", "oferta_vencida", "cobrada"].includes(invoice.status)) text = t("invoices.dueLabel", date(invoice.dueOn));
  return text ? <div style={{ fontSize: 13, color: C.mut }}>{text}</div> : null;
}

export function InvoiceCard({ invoice, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen?.(invoice.id)}
      style={{ ...card, border: 0, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}><InvoiceTitle invoice={invoice} /></span>
        <StatusBadge status={invoice.status} />
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13.5, color: C.mut, overflowWrap: "anywhere" }}>{invoice.debtor?.legalName || invoice.issuer?.legalName}</span>
        <Money value={invoice.nominal} strong />
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><InvoiceBadges invoice={invoice} /></span>
      <DeadlineLine invoice={invoice} />
    </button>
  );
}

export function InvoiceList({ invoices, loading, error, onRetry, onOpen, onNew }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button type="button" onClick={onNew} style={primaryButton(false)}>{t("invoices.new")}</button>
      <ListState loading={loading} error={error} onRetry={onRetry} empty={!invoices?.length} emptyText={t("invoices.empty")} />
      {!loading && !error && invoices?.map(invoice => <InvoiceCard key={invoice.id} invoice={invoice} onOpen={onOpen} />)}
    </div>
  );
}

const EMPTY_FORM = { debtorId: "", cbteTipo: "6", ptoVta: "", cbteNro: "", issuedOn: "", dueOn: "", nominal: "" };
const integer = text => (/^\d{1,9}$/.test(String(text).trim()) ? Number(text) : text === "" ? null : NaN);
/** '10000,50' → '10000.50' when there is no dot: the server only accepts a dot. */
const amount = text => (String(text).includes(".") ? String(text).trim() : String(text).trim().replace(",", "."));

/** Client-side preview with the same validator as the server (src/invoiceQr.js). */
export function previewInvoice(mode, values, todayIso) {
  try {
    const body = mode === "qr"
      ? { source: "qr", qrText: values.qrText || "", dueOn: values.dueOn || "" }
      : { source: "form", debtorId: values.debtorId, cbteTipo: integer(values.cbteTipo), ptoVta: integer(values.ptoVta),
        cbteNro: integer(values.cbteNro), issuedOn: values.issuedOn, dueOn: values.dueOn, nominal: amount(values.nominal) };
    return { ok: true, body, invoice: validateInvoiceInput(body, { todayIso }) };
  } catch (error) {
    return { ok: false, code: error.code || "invalid_body" };
  }
}

function Field({ id, text, hint, children }) {
  return (
    <div>
      <label htmlFor={id} style={label}>{text}</label>
      {children}
      {hint && <div id={`${id}-hint`} style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function InvoicePreview({ invoice }) {
  const { t } = useLanguage();
  const date = useDate();
  return (
    <section aria-label={t("invoices.preview")} style={{ ...card, display: "flex", flexDirection: "column" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 500, color: C.mut }}>{t("invoices.preview")}</h3>
      <Row label={t("invoices.type")}>{invoice.letter} · {String(invoice.ptoVta).padStart(5, "0")}-{String(invoice.cbteNro).padStart(8, "0")}</Row>
      {invoice.issuerCuit && <Row label={t("factoring.issuer")}>{formatCuit(invoice.issuerCuit)}</Row>}
      {invoice.receiverCuit && <Row label={t("factoring.debtor")}>{formatCuit(invoice.receiverCuit)}</Row>}
      <Row label={t("invoices.issuedOn")}>{date(invoice.issuedOn)}</Row>
      <Row label={t("invoices.dueOn")}>{date(invoice.dueOn)}</Row>
      <Row label={t("factoring.nominal")}><Money value={centsToArs(invoice.nominalCents)} strong /></Row>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}><InvoiceBadges invoice={{ simulated: invoice.simulated, isFce: invoice.isFce }} /></div>
    </section>
  );
}

export function InvoiceForm({ debtors = [], onCreate, busy = false, error = null, todayIso = argentinaToday(), initialMode = "form", initialValues = {} }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState(initialMode);
  const [values, setValues] = useState({ ...EMPTY_FORM, qrText: "", ...initialValues });
  const [scanning, setScanning] = useState(false);
  const [readError, setReadError] = useState(null);
  const set = key => event => setValues(current => ({ ...current, [key]: event.target.value }));
  const preview = useMemo(() => previewInvoice(mode, values, todayIso), [mode, values, todayIso]);
  const touched = mode === "qr" ? Boolean(values.qrText && values.dueOn) : Object.values({ ...values, qrText: "x" }).every(v => v !== "");
  const onImage = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReadError(null);
    try {
      const text = await decodeQrFromImageFile(file);
      if (text) setValues(current => ({ ...current, qrText: text })); else setReadError("invoices.qrNotFound");
    } catch { setReadError("invoices.qrNotFound"); }
  };
  const tab = (id, text) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
      style={{ flex: 1, border: 0, borderRadius: 12, padding: "10px 8px", font: "inherit", fontSize: 14, cursor: "pointer",
        background: mode === id ? C.card : "transparent", color: mode === id ? C.ink : C.mut, fontWeight: mode === id ? 600 : 500 }}>{text}</button>
  );
  return (
    <form onSubmit={event => { event.preventDefault(); if (preview.ok && !busy) onCreate?.(preview.body); }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
      <div role="tablist" aria-label={t("invoices.new")} style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 14, padding: 4 }}>
        {tab("form", t("invoices.fromForm"))}
        {tab("qr", t("invoices.fromQr"))}
      </div>
      {mode === "form" ? (
        <>
          <div style={{ ...TONES.warning, borderRadius: 14, padding: "10px 14px", fontSize: 13 }}>{t("invoices.formNotice")}</div>
          <Field id="inv-debtor" text={t("invoices.debtor")} hint={debtors.length ? null : t("invoices.noDebtors")}>
            <select id="inv-debtor" value={values.debtorId} onChange={set("debtorId")} style={input}>
              <option value="">{t("invoices.chooseDebtor")}</option>
              {debtors.map(d => <option key={d.id} value={d.id}>{d.legalName} ({d.cuitHint})</option>)}
            </select>
          </Field>
          <Field id="inv-type" text={t("invoices.type")}>
            <select id="inv-type" value={values.cbteTipo} onChange={set("cbteTipo")} style={input}>
              {[...INVOICE_TYPES].map(([code, letter]) => <option key={code} value={String(code)}>{letter}</option>)}
            </select>
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field id="inv-pos" text={t("invoices.pointOfSale")}><input id="inv-pos" inputMode="numeric" value={values.ptoVta} onChange={set("ptoVta")} style={input} /></Field></div>
            <div style={{ flex: 1 }}><Field id="inv-nro" text={t("invoices.number")}><input id="inv-nro" inputMode="numeric" value={values.cbteNro} onChange={set("cbteNro")} style={input} /></Field></div>
          </div>
          <Field id="inv-issued" text={t("invoices.issuedOn")}><input id="inv-issued" type="date" max={todayIso} value={values.issuedOn} onChange={set("issuedOn")} style={input} /></Field>
          <Field id="inv-nominal" text={t("invoices.nominal")}><input id="inv-nominal" inputMode="decimal" value={values.nominal} onChange={set("nominal")} style={input} /></Field>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => { setReadError(null); setScanning(value => !value); }} style={secondaryButton}>{t("invoices.scanQr")}</button>
            <label style={{ ...secondaryButton, textAlign: "center", boxSizing: "border-box" }}>
              {t("invoices.uploadImage")}
              <input type="file" accept="image/png,image/jpeg" onChange={onImage} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
            </label>
          </div>
          {scanning && (
            <div style={{ borderRadius: 18, overflow: "hidden", background: C.ink, aspectRatio: "1 / 1" }}>
              <QrScanner onDecode={text => { setValues(current => ({ ...current, qrText: text })); setScanning(false); }}
                onCameraError={() => { setScanning(false); setReadError("invoices.cameraError"); }} />
            </div>
          )}
          {readError && <div role="alert" style={{ ...TONES.danger, borderRadius: 14, padding: "10px 14px", fontSize: 13.5 }}>{t(readError)}</div>}
          {values.qrText && <div role="status" aria-live="polite" style={{ fontSize: 13, color: C.green }}>{t("invoices.qrRead")}</div>}
        </>
      )}
      <Field id="inv-due" text={t("invoices.dueOn")} hint={mode === "qr" ? t("invoices.dueOnHint") : null}>
        <input id="inv-due" type="date" min={todayIso} value={values.dueOn} onChange={set("dueOn")} style={input} aria-describedby={mode === "qr" ? "inv-due-hint" : undefined} />
      </Field>
      {preview.ok ? <InvoicePreview invoice={preview.invoice} /> : touched && <ErrorMessage code={preview.code} />}
      <ErrorMessage code={error} />
      <button type="submit" disabled={!preview.ok || busy} aria-busy={busy} style={primaryButton(!preview.ok || busy)}>{busy ? t("invoices.creating") : t("invoices.create")}</button>
    </form>
  );
}

export function InvoiceDetail({ invoice, timeline, onSend, sending = false, sendError = null, todayIso = argentinaToday() }) {
  const { t } = useLanguage();
  const date = useDate();
  const [confirm, setConfirm] = useState(false);
  // D-11: past the tacit deadline, sending means the debtor gets no window.
  const lateWarning = invoice.status === "cargada" && invoice.tacitAcceptanceOn && todayIso >= invoice.tacitAcceptanceOn;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}><InvoiceTitle invoice={invoice} /></span>
          <StatusBadge status={invoice.status} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><InvoiceBadges invoice={invoice} /></div>
        <Row label={t("factoring.debtor")}>{invoice.debtor?.legalName}</Row>
        <Row label={t("factoring.nominal")}><Money value={invoice.nominal} strong /></Row>
        <Row label={t("factoring.issuedOn")}>{date(invoice.issuedOn)}</Row>
        <Row label={t("factoring.dueOn")}>{date(invoice.dueOn)}</Row>
        <DeadlineLine invoice={invoice} />
        {invoice.take && (
          <>
            <Row label={t("invoices.advance")}><Money value={invoice.take.advance} strong /></Row>
            <Row label={t("invoices.discount")}><Money value={invoice.take.discount} /></Row>
            <Row label={t("invoices.days")}>{invoice.take.days}</Row>
          </>
        )}
        <NftLine nft={invoice.nft} />
      </section>
      {lateWarning && <div role="note" style={{ ...TONES.warning, borderRadius: 14, padding: "10px 14px", fontSize: 13.5 }}>{t("invoices.oldInvoiceWarning")}</div>}
      {invoice.status === "cargada" && <button type="button" onClick={() => setConfirm(true)} style={primaryButton(false)}>{t("invoices.send")}</button>}
      {!confirm && <ErrorMessage code={sendError} />}
      <Timeline items={timeline} />
      {confirm && (
        <ConfirmSheet id="inv-send" title={t("invoices.sendConfirmTitle")} confirmLabel={t("invoices.sendConfirmBtn")} busy={sending} error={sendError}
          onClose={() => setConfirm(false)} onConfirm={async () => { if (await onSend?.()) setConfirm(false); }}>
          <p style={{ margin: 0 }}>{t("invoices.sendConfirmBody")}</p>
          {lateWarning && <p style={{ margin: "10px 0 0", color: C.amber }}>{t("invoices.oldInvoiceWarning")}</p>}
        </ConfirmSheet>
      )}
    </div>
  );
}

export default function InvoicesScreen({ getAccessToken, paymentsMode, onBack }) {
  const { t } = useLanguage();
  const [list, setList] = useState({ loading: true, error: null, invoices: [] });
  const [debtors, setDebtors] = useState([]);
  const [view, setView] = useState({ name: "list" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [createKey, setCreateKey] = useState(newIdempotencyKey);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let canceled = false;
    setList(current => ({ ...current, loading: true, error: null }));
    factoringApi("/invoices?view=issued", getAccessToken)
      .then(body => { if (!canceled) setList({ loading: false, error: null, invoices: body.invoices }); })
      .catch(error => { if (!canceled) setList({ loading: false, error: error.code, invoices: [] }); });
    return () => { canceled = true; };
  }, [getAccessToken, revision]);
  useEffect(() => {
    if (view.name !== "new") return undefined;
    let canceled = false;
    factoringApi("/invoices/debtors", getAccessToken).then(body => { if (!canceled) setDebtors(body.debtors); }).catch(() => {});
    return () => { canceled = true; };
  }, [view.name, getAccessToken]);
  const openDetail = useCallback(async id => {
    setActionError(null);
    setView({ name: "detail", id, loading: true });
    try {
      const body = await factoringApi(`/invoices/${id}`, getAccessToken);
      setView({ name: "detail", id, invoice: body.invoice, timeline: body.timeline });
    } catch (error) { setView({ name: "detail", id, error: error.code }); }
  }, [getAccessToken]);
  const create = async body => {
    setBusy(true); setActionError(null);
    try {
      const result = await factoringApi("/invoices", getAccessToken, { method: "POST", body, idempotencyKey: createKey });
      setCreateKey(newIdempotencyKey());
      setRevision(value => value + 1);
      await openDetail(result.invoice.id);
    } catch (error) { setActionError(error.code); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setActionError(null);
    try {
      await factoringApi(`/invoices/${view.id}/send`, getAccessToken, { method: "POST", body: {} });
      setRevision(value => value + 1);
      await openDetail(view.id);
      return true;
    } catch (error) { setActionError(error.code); return false; } finally { setBusy(false); }
  };
  const back = view.name === "list" ? onBack : () => { setActionError(null); setView({ name: "list" }); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ScreenHeader title={view.name === "new" ? t("invoices.new") : view.name === "detail" ? t("invoices.detail") : t("invoices.title")} onBack={back} />
      <SimulatedBanner paymentsMode={paymentsMode} />
      {view.name === "list" && <InvoiceList {...list} onRetry={() => setRevision(value => value + 1)} onOpen={openDetail} onNew={() => { setActionError(null); setView({ name: "new" }); }} />}
      {view.name === "new" && <InvoiceForm debtors={debtors} onCreate={create} busy={busy} error={actionError} />}
      {view.name === "detail" && (
        <>
          <ListState loading={view.loading} error={view.error} onRetry={() => openDetail(view.id)} />
          {view.invoice && <InvoiceDetail invoice={view.invoice} timeline={view.timeline} onSend={send} sending={busy} sendError={actionError} />}
        </>
      )}
    </div>
  );
}

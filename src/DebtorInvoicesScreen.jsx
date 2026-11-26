import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "./i18n.jsx";
import { C, TONES } from "./designTokens.js";
import { factoringApi, newIdempotencyKey, argentinaToday } from "./factoring.js";
import { ScreenHeader, SimulatedBanner, StatusBadge, InvoiceBadges, ListState, ErrorMessage, ConfirmSheet, Money, Row, Cvu, NftLine,
  Timeline, InvoiceTitle, useDate, card, primaryButton, secondaryButton } from "./FactoringParts.jsx";
import { InvoiceCard } from "./InvoicesScreen.jsx";
// Debtor screen of the invoice cession pilot (plan 9.1): accept or reject a
// sent invoice and, once assigned, pay the full face value to the investor
// from the due date. Amounts and the destination CVU always come from the server.

const CEDED = ["cedida", "en_mora", "cobrada"];
const PAYMENT_LIVE = ["pending", "submitting", "processing", "manual_review"];

/** Why the Pay button is disabled, or null when the debtor can pay now. */
export function payBlock(invoice, { paymentsMode, todayIso }) {
  if (!["cedida", "en_mora"].includes(invoice.status)) return "status";
  if (paymentsMode === "disabled" || !paymentsMode) return "paymentsDisabled";
  if (PAYMENT_LIVE.includes(invoice.payment?.status)) return "processing";
  if (!invoice.canPayFrom || todayIso < invoice.canPayFrom) return "notYetDue";
  return null;
}

export function OwedDetail({ invoice, timeline, paymentsMode, todayIso = argentinaToday(), onAccept, onReject, onPay, busy = false, error = null, initialSheet = null }) {
  const { t } = useLanguage();
  const date = useDate();
  const [sheet, setSheet] = useState(initialSheet);
  const block = payBlock(invoice, { paymentsMode, todayIso });
  const confirm = async action => { if (await action?.()) setSheet(null); };
  const blockText = { paymentsDisabled: t("factoring.paymentsDisabled"), processing: t("owed.paymentProcessing"),
    notYetDue: invoice.canPayFrom ? t("owed.payFrom", date(invoice.canPayFrom)) : null }[block];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}><InvoiceTitle invoice={invoice} /></span>
          <StatusBadge status={invoice.status} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><InvoiceBadges invoice={invoice} /></div>
        <Row label={t("factoring.issuer")}>{invoice.issuer?.legalName}</Row>
        <Row label={t("factoring.nominal")}><Money value={invoice.nominal} strong /></Row>
        <Row label={t("factoring.dueOn")}>{date(invoice.dueOn)}</Row>
        {invoice.status === "enviada" && invoice.tacitAcceptanceOn && <div style={{ fontSize: 13, color: C.mut }}>{t("owed.tacitOn", date(invoice.tacitAcceptanceOn))}</div>}
        <NftLine nft={invoice.nft} />
      </section>
      {invoice.status === "enviada" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => setSheet("accept")} style={primaryButton(false)}>{t("owed.accept")}</button>
          <button type="button" onClick={() => setSheet("reject")} style={secondaryButton}>{t("owed.reject")}</button>
        </div>
      )}
      {CEDED.includes(invoice.status) && invoice.payTo && (
        <section style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
          {invoice.status !== "cobrada" && <div role="note" style={{ ...TONES.info, borderRadius: 14, padding: "10px 14px", fontSize: 13.5 }}>{t("owed.cededNotice")}</div>}
          <Row label={t("owed.payTo")}>{invoice.payTo.legalName}</Row>
          <Row label={t("owed.cvu")}><Cvu value={invoice.payTo.cvu} /></Row>
          <Row label={t("factoring.nominal")}><Money value={invoice.nominal} strong /></Row>
          {invoice.status === "en_mora" && <div style={{ fontSize: 13, color: C.red }}>{t("owed.overdue")}</div>}
          {invoice.status === "cobrada" && <div style={{ fontSize: 13, color: C.green }}>{t("owed.paid")}</div>}
          {invoice.payment?.status === "failed" && invoice.status !== "cobrada" && <div role="alert" style={{ fontSize: 13, color: C.red }}>{t("owed.paymentFailed")}</div>}
          {invoice.status !== "cobrada" && (
            <>
              <button type="button" disabled={Boolean(block)} aria-describedby={blockText ? "owed-pay-block" : undefined}
                onClick={() => setSheet("pay")} style={{ ...primaryButton(Boolean(block)), marginTop: 8 }}>{t("owed.pay")}</button>
              {blockText && <div id="owed-pay-block" style={{ fontSize: 13, color: C.mut, textAlign: "center" }}>{blockText}</div>}
            </>
          )}
        </section>
      )}
      {!sheet && <ErrorMessage code={error} />}
      <Timeline items={timeline} />
      {sheet === "accept" && (
        <ConfirmSheet id="owed-accept" title={t("owed.accept")} confirmLabel={t("owed.accept")} busy={busy} error={error}
          onClose={() => setSheet(null)} onConfirm={() => confirm(onAccept)}>
          <p style={{ margin: 0 }}>{t("owed.acceptConfirm")}</p>
        </ConfirmSheet>
      )}
      {sheet === "reject" && (
        <ConfirmSheet id="owed-reject" title={t("owed.reject")} confirmLabel={t("owed.reject")} danger busy={busy} error={error}
          onClose={() => setSheet(null)} onConfirm={() => confirm(onReject)}>
          <p style={{ margin: 0 }}>{t("owed.rejectConfirm")}</p>
          {invoice.tacitAcceptanceOn && <p style={{ margin: "8px 0 0", color: C.mut }}>{t("owed.tacitOn", date(invoice.tacitAcceptanceOn))}</p>}
        </ConfirmSheet>
      )}
      {sheet === "pay" && (
        <ConfirmSheet id="owed-pay" title={t("owed.payConfirmTitle")} confirmLabel={t("owed.payConfirmBtn")} busy={busy} error={error}
          onClose={() => setSheet(null)} onConfirm={() => confirm(onPay)}>
          <p style={{ margin: "0 0 8px" }}>{t("owed.payConfirmBody")}</p>
          <Row label={t("factoring.nominal")}><Money value={invoice.nominal} strong /></Row>
          <Row label={t("owed.payTo")}>{invoice.payTo?.legalName}</Row>
          <Row label={t("owed.cvu")}><Cvu value={invoice.payTo?.cvu} /></Row>
        </ConfirmSheet>
      )}
    </div>
  );
}

export default function DebtorInvoicesScreen({ getAccessToken, paymentsMode, onBack }) {
  const { t } = useLanguage();
  const [list, setList] = useState({ loading: true, error: null, invoices: [] });
  const [view, setView] = useState({ name: "list" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [payKey, setPayKey] = useState(newIdempotencyKey);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let canceled = false;
    setList(current => ({ ...current, loading: true, error: null }));
    factoringApi("/invoices?view=owed", getAccessToken)
      .then(body => { if (!canceled) setList({ loading: false, error: null, invoices: body.invoices }); })
      .catch(error => { if (!canceled) setList({ loading: false, error: error.code, invoices: [] }); });
    return () => { canceled = true; };
  }, [getAccessToken, revision]);
  const openDetail = useCallback(async id => {
    setView(current => (current.id === id && current.invoice ? current : { name: "detail", id, loading: true }));
    try {
      const body = await factoringApi(`/invoices/${id}`, getAccessToken);
      setView({ name: "detail", id, invoice: body.invoice, timeline: body.timeline });
    } catch (error) { setView({ name: "detail", id, error: error.code }); }
  }, [getAccessToken]);
  // While a payment is in flight, refresh the detail until the worker settles it.
  const inFlight = view.invoice && PAYMENT_LIVE.includes(view.invoice.payment?.status) && view.invoice.status !== "cobrada";
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = setTimeout(() => openDetail(view.id), 4000);
    return () => clearTimeout(timer);
  }, [inFlight, view, openDetail]);
  const act = async (path, options) => {
    setBusy(true); setActionError(null);
    try {
      await factoringApi(`/invoices/${view.id}/${path}`, getAccessToken, { method: "POST", body: {}, ...options });
      setRevision(value => value + 1);
      await openDetail(view.id);
      return true;
    } catch (error) {
      setActionError(error.code);
      if (error.code === "invalid_transition" || error.code === "already_accepted_tacitly") await openDetail(view.id);
      return false;
    } finally { setBusy(false); }
  };
  const pay = async () => {
    const ok = await act("pay", { idempotencyKey: payKey });
    // A new attempt after a failure needs a new key; a double tap reuses this one.
    if (ok) setPayKey(newIdempotencyKey());
    return ok;
  };
  const back = view.name === "list" ? onBack : () => { setActionError(null); setView({ name: "list" }); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ScreenHeader title={t("owed.title")} onBack={back} />
      <SimulatedBanner paymentsMode={paymentsMode} />
      {view.name === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ListState {...list} empty={!list.invoices.length} emptyText={t("owed.empty")} onRetry={() => setRevision(value => value + 1)} />
          {!list.loading && !list.error && list.invoices.map(invoice => <InvoiceCard key={invoice.id} invoice={invoice} onOpen={id => { setActionError(null); openDetail(id); }} />)}
        </div>
      )}
      {view.name === "detail" && (
        <>
          <ListState loading={view.loading} error={view.error} onRetry={() => openDetail(view.id)} />
          {view.invoice && <OwedDetail invoice={view.invoice} timeline={view.timeline} paymentsMode={paymentsMode} busy={busy} error={actionError}
            onAccept={() => act("accept")} onReject={() => act("reject")} onPay={pay} />}
        </>
      )}
    </div>
  );
}

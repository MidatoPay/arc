import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "./i18n.jsx";
import { C, TONES } from "./designTokens.js";
import { factoringApi, newIdempotencyKey, formatBps, timeLeft, factoringErrorKey } from "./factoring.js";
import { ScreenHeader, SimulatedBanner, StatusBadge, InvoiceBadges, ListState, ErrorMessage, ConfirmSheet, Money, Row, Cvu,
  InvoiceTitle, useDate, card, primaryButton } from "./FactoringParts.jsx";
// Investor screen of the invoice cession pilot (plan 9.1): open offers with
// the server's quote, the breakdown, "accept and pay" with an exact expected
// amount, the take follow-up and the purchased invoices.

function Expiry({ expiresAt, nowMs }) {
  const { t } = useLanguage();
  const left = timeLeft(expiresAt, nowMs);
  return <span style={{ fontSize: 12.5, color: left ? C.mut : C.red }}>{left ? t("offers.expiresIn", left.hours, left.minutes) : t("offers.expired")}</span>;
}

export function OfferCard({ offer, onOpen, nowMs }) {
  const { t, lang } = useLanguage();
  const date = useDate();
  const { invoice, quote } = offer;
  return (
    <button type="button" onClick={() => onOpen?.(offer.offerId)}
      style={{ ...card, border: 0, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}><InvoiceTitle invoice={invoice} /></span>
        <Money value={invoice.nominal} strong />
      </span>
      <span style={{ fontSize: 13, color: C.mut }}>{t("factoring.debtor")}: {invoice.debtor?.legalName} · {t("factoring.issuer")}: {invoice.issuer?.legalName}</span>
      <span style={{ fontSize: 13, color: C.mut }}>{t("factoring.dueOn")} {date(invoice.dueOn)}{quote ? ` · ${quote.days} ${t("invoices.days").toLowerCase()}` : ""}</span>
      {quote && (
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13.5 }}>
          <span>{t("offers.outlay")} <Money value={quote.outlay} /></span>
          <span>{t("offers.gain")} <Money value={quote.gain} /></span>
          <span>{t("offers.tna")} {formatBps(quote.investorTnaBps, lang === "en" ? "en" : "es")}</span>
        </span>
      )}
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <InvoiceBadges invoice={invoice} />
        <Expiry expiresAt={offer.expiresAt} nowMs={nowMs} />
      </span>
    </button>
  );
}

export function TakeStatus({ take }) {
  const { t } = useLanguage();
  if (!take) return null;
  const message = { paying: [t("offers.paymentsInProgress"), "warning"], completed: [t("offers.ceded"), "success"],
    failed_net: [t("offers.netFailed"), "danger"], manual_review: [t("offers.review"), "warning"] }[take.status];
  if (!message) return null;
  return <div role="status" aria-live="polite" style={{ ...TONES[message[1]], borderRadius: 14, padding: "10px 14px", fontSize: 13.5 }}>{message[0]}</div>;
}

/** Breakdown and take confirmation. `quote` is always the server's (plan 9.1). */
export function OfferDetail({ detail, paymentsMode, nowMs, onTake, busy = false, error = null, termsChanged = false, take = null, initialSheet = false }) {
  const { t, lang } = useLanguage();
  const date = useDate();
  const [sheet, setSheet] = useState(initialSheet || termsChanged);
  const { invoice, quote, debit, offer } = detail;
  const paymentsOff = paymentsMode === "disabled" || !paymentsMode;
  const blocked = !quote?.takeable;
  // A terms change keeps the sheet open so the investor confirms the new amounts.
  useEffect(() => { if (termsChanged) setSheet(true); }, [termsChanged, quote?.outlay]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ ...card, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}><InvoiceTitle invoice={invoice} /></span>
          <StatusBadge status={invoice.status} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><InvoiceBadges invoice={invoice} /><Expiry expiresAt={offer.expiresAt} nowMs={nowMs} /></div>
        <Row label={t("factoring.debtor")}>{invoice.debtor?.legalName}</Row>
        <Row label={t("factoring.issuer")}>{invoice.issuer?.legalName}</Row>
        <Row label={t("factoring.dueOn")}>{date(invoice.dueOn)}</Row>
        <Row label={t("offers.days")}>{quote?.days}</Row>
        {quote?.outlay && (
          <>
            <Row label={t("offers.nominalAtDue")}><Money value={quote.nominal} strong /></Row>
            <Row label={t("offers.discount")}><Money value={quote.discount} /></Row>
            <Row label={t("offers.netToIssuer")}><Money value={quote.advance} /></Row>
            <div style={{ fontSize: 12.5, color: C.mut, textAlign: "right" }}>{t("offers.toCvu", "")}<Cvu value={debit.issuerCvu} /></div>
            <Row label={t("offers.feeToMidatopay")}><Money value={quote.fee} /></Row>
            <div style={{ fontSize: 12.5, color: C.mut, textAlign: "right" }}>{t("offers.toCvu", "")}<Cvu value={debit.feeCvu} /></div>
            <Row label={t("offers.totalDebit")}><Money value={quote.outlay} strong /></Row>
            <Row label={t("offers.gain")}><Money value={quote.gain} /></Row>
            <Row label={t("offers.tna")}>{formatBps(quote.investorTnaBps, lang === "en" ? "en" : "es")}</Row>
          </>
        )}
      </section>
      <TakeStatus take={take} />
      {!take && (
        <>
          <button type="button" disabled={blocked || paymentsOff} onClick={() => setSheet(true)} aria-describedby="offer-take-block"
            style={primaryButton(blocked || paymentsOff)}>{t("offers.take")}</button>
          {(paymentsOff || blocked) && <div id="offer-take-block" style={{ fontSize: 13, color: C.mut, textAlign: "center" }}>
            {paymentsOff ? t("factoring.paymentsDisabled") : quote?.blockedReason ? t(factoringErrorKey(quote.blockedReason)) : t("offers.blocked")}</div>}
        </>
      )}
      {!sheet && <ErrorMessage code={error} />}
      {sheet && quote?.outlay && (
        <ConfirmSheet id="offer-take" title={t("offers.takeConfirmTitle")} confirmLabel={t("offers.takeConfirmBtn")} busy={busy}
          error={termsChanged ? null : error} onClose={() => setSheet(false)} onConfirm={async () => { if (await onTake?.(quote.outlay)) setSheet(false); }}>
          {termsChanged && <p role="alert" style={{ margin: "0 0 8px", color: C.amber }}>{t("offers.termsChanged")}</p>}
          <p style={{ margin: "0 0 8px" }}>{t("offers.takeConfirmBody")}</p>
          <Row label={t("offers.netToIssuer")}><Money value={quote.advance} /></Row>
          <Row label={t("owed.cvu")}><Cvu value={debit.issuerCvu} /></Row>
          <Row label={t("offers.feeToMidatopay")}><Money value={quote.fee} /></Row>
          <Row label={t("owed.cvu")}><Cvu value={debit.feeCvu} /></Row>
          <Row label={t("offers.totalDebit")}><Money value={quote.outlay} strong /></Row>
          <Row label={t("offers.gain")}><Money value={quote.gain} /></Row>
          <Row label={t("offers.tna")}>{formatBps(quote.investorTnaBps, lang === "en" ? "en" : "es")}</Row>
        </ConfirmSheet>
      )}
    </div>
  );
}

export function Holdings({ holdings }) {
  const { t } = useLanguage();
  const date = useDate();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: "4px 0 0 4px", fontSize: 13, fontWeight: 500, color: C.mut }}>{t("offers.holdings")}</h3>
      {!holdings?.length && <div style={{ ...card, color: C.mut, fontSize: 14 }}>{t("offers.noHoldings")}</div>}
      {holdings?.map(({ takeId, invoice, take }) => (
        <div key={takeId} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}>{invoice ? <InvoiceTitle invoice={invoice} /> : null}</span>
            {invoice && <StatusBadge status={invoice.status} />}
          </span>
          <span style={{ fontSize: 13, color: C.mut }}>{invoice?.debtor?.legalName} · {t("factoring.dueOn")} {invoice ? date(invoice.dueOn) : ""}</span>
          <span style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13.5 }}>
            <span>{t("offers.outlay")} <Money value={take.outlay} /></span>
            <span>{t("offers.nominalAtDue")} <Money value={take.nominal} /></span>
          </span>
          {invoice?.status === "cobrada" ? <span style={{ fontSize: 13, color: C.green }}>{t("offers.collected")}</span> : <TakeStatus take={take} />}
        </div>
      ))}
    </section>
  );
}

export default function InvestorOffersScreen({ getAccessToken, paymentsMode, onBack }) {
  const { t } = useLanguage();
  const [list, setList] = useState({ loading: true, error: null, offers: [], holdings: [] });
  const [view, setView] = useState({ name: "list" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [termsChanged, setTermsChanged] = useState(false);
  const [takeKey, setTakeKey] = useState(newIdempotencyKey);
  const [revision, setRevision] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNowMs(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let canceled = false;
    setList(current => ({ ...current, loading: true, error: null }));
    factoringApi("/invoice-offers", getAccessToken)
      .then(body => { if (!canceled) setList({ loading: false, error: null, offers: body.offers, holdings: body.holdings }); })
      .catch(error => { if (!canceled) setList({ loading: false, error: error.code, offers: [], holdings: [] }); });
    return () => { canceled = true; };
  }, [getAccessToken, revision]);
  const openOffer = useCallback(async id => {
    setActionError(null); setTermsChanged(false); setTakeKey(newIdempotencyKey());
    setView({ name: "detail", id, loading: true });
    try { setView({ name: "detail", id, detail: await factoringApi(`/invoice-offers/${id}`, getAccessToken) }); }
    catch (error) { setView({ name: "detail", id, error: error.code }); }
  }, [getAccessToken]);
  // Follow the take while the worker moves the money.
  const following = view.take?.status === "paying";
  useEffect(() => {
    if (!following) return undefined;
    const timer = setTimeout(async () => {
      try {
        const { take } = await factoringApi(`/invoice-offers/takes/${view.take.id}`, getAccessToken);
        setView(current => ({ ...current, take }));
        if (take.status !== "paying") setRevision(value => value + 1);
      } catch { setView(current => ({ ...current })); }
    }, 3000);
    return () => clearTimeout(timer);
  }, [following, view, getAccessToken]);
  const take = async expectedOutlay => {
    setBusy(true); setActionError(null);
    try {
      const body = await factoringApi(`/invoice-offers/${view.id}/take`, getAccessToken, { method: "POST", body: { expectedOutlay }, idempotencyKey: takeKey });
      setTermsChanged(false);
      setView(current => ({ ...current, take: body.take }));
      return true;
    } catch (error) {
      if (error.code === "terms_changed" && error.body?.quote) {
        // New amounts: a new confirmation, so a new key.
        setTakeKey(newIdempotencyKey());
        setView(current => ({ ...current, detail: { ...current.detail, quote: { ...current.detail.quote, ...error.body.quote } } }));
        setTermsChanged(true);
      } else setActionError(error.code);
      return false;
    } finally { setBusy(false); }
  };
  const back = view.name === "list" ? onBack : () => { setView({ name: "list" }); setRevision(value => value + 1); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ScreenHeader title={t("offers.title")} onBack={back} />
      <SimulatedBanner paymentsMode={paymentsMode} />
      {view.name === "list" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ListState loading={list.loading} error={list.error} empty={!list.offers.length} emptyText={t("offers.empty")} onRetry={() => setRevision(value => value + 1)} />
            {!list.loading && !list.error && list.offers.map(offer => <OfferCard key={offer.offerId} offer={offer} onOpen={openOffer} nowMs={nowMs} />)}
          </div>
          {!list.loading && !list.error && <Holdings holdings={list.holdings} />}
        </>
      )}
      {view.name === "detail" && (
        <>
          <ListState loading={view.loading} error={view.error} onRetry={() => openOffer(view.id)} />
          {view.detail && <OfferDetail detail={view.detail} paymentsMode={paymentsMode} nowMs={nowMs} onTake={take} busy={busy}
            error={actionError} termsChanged={termsChanged} take={view.take} />}
        </>
      )}
    </div>
  );
}

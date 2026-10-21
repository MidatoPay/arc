import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { chargeApi, readChargeAttempt, saveChargeAttempt, clearChargeAttempt, prepareChargeAttempt, bindChargeAttempt, canStartNewCharge } from "./charges.js";
import { useOptionalLanguage } from "./i18n.jsx";
import { chargeErrorText } from "./errorText.js";
import { paymentReceived } from "./chargeStatus.js";
import ChargeSummary from "./ChargeSummary.jsx";

const terminal = new Set(["delivered","expired","canceled","refunded"]);
const button = { border:0,borderRadius:14,padding:"14px 18px",font:"inherit",fontWeight:600,cursor:"pointer" };
const ORANGE = "#FF5A00";
const INK = "#16161A";
const MUT = "#7A7A85";
const LINE = "#ECECF0";
const KEYS = ["1","2","3","4","5","6","7","8","9",",","0","back"];

function IconBack({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDown({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClose({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const AMOUNT_PRESETS = [200, 500, 1000];
const dismissedExpiredKey = (userId) => `midato.dismissed-expired.${userId || "anon"}`;

function readDismissedExpired(userId) {
  try {
    const raw = localStorage.getItem(dismissedExpiredKey(userId));
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissedExpired(userId, ids) {
  try {
    localStorage.setItem(dismissedExpiredKey(userId), JSON.stringify([...ids]));
  } catch { /* ignore quota */ }
}

function IconBackspace({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9.5a2 2 0 0 1-1.48-.66L3.2 12.7a1 1 0 0 1 0-1.4l4.82-5.64A2 2 0 0 1 9.5 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M16.2 9.2l-4 4M12.2 9.2l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Bandera argentina simplificada (celeste / blanco / sol). */
function FlagAr({ size = 18 }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 24 17" aria-hidden>
      <rect width="24" height="17" rx="2.5" fill="#74ACDF" />
      <rect y="5.5" width="24" height="6" fill="#FFFFFF" />
      <circle cx="12" cy="8.5" r="2.15" fill="#F6B40E" />
    </svg>
  );
}

function isExpiredCharge(c, now = Date.now()) {
  if (!c || paymentReceived(c)) return false;
  if (c.status === "expired") return true;
  if (c.status === "awaiting_payment" && c.expiresAt && new Date(c.expiresAt).getTime() <= now) return true;
  return false;
}

function formatArsAmount(raw) {
  if (!raw) return "0";
  const normalized = String(raw).replace(/\./g, "").replace(",", ".");
  const [intPart, decPart] = normalized.split(".");
  const intFormatted = Number(intPart || "0").toLocaleString("es-AR");
  if (String(raw).includes(",")) {
    if (String(raw).endsWith(",") && (decPart === undefined || decPart === "")) return `${intFormatted},`;
    return `${intFormatted},${(decPart || "").slice(0, 2)}`;
  }
  return intFormatted;
}

function appendAmountDigit(prev, key) {
  const cur = String(prev || "");
  if (key === "back") return cur.slice(0, -1);
  if (key === ",") {
    if (!cur) return "0,";
    if (cur.includes(",")) return cur;
    return `${cur},`;
  }
  if (cur.includes(",")) {
    const dec = cur.split(",")[1] || "";
    if (dec.length >= 2) return cur;
    return cur + key;
  }
  if (cur === "0") return key;
  if (cur.replace(/\D/g, "").length >= 9) return cur;
  return cur + key;
}

export function AmountKeypad({ disabled, onKey }) {
  const { t } = useOptionalLanguage();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
        userSelect: "none",
        width: "100%",
        flexShrink: 0,
      }}
    >
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onKey(key)}
          aria-label={key === "back" ? t("mpCharge.keypadDelete") : key === "," ? t("mpCharge.keypadDecimal") : key}
          style={{
            border: "1px solid #F0F0F3",
            background: "#FCFCFD",
            font: "inherit",
            fontSize: 25,
            fontWeight: 500,
            color: INK,
            height: 52,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            boxShadow: "none",
          }}
        >
          {key === "back" ? <IconBackspace /> : key}
        </button>
      ))}
    </div>
  );
}

export default function MercadoPagoCharge({ userId, address, getAccessToken, onDelivered, onPaymentReceived, chargeRequest, onChargeRequestConsumed, onBack }) {
  const lang = useOptionalLanguage();
  const { t } = lang;
  // `error` guarda un código del backend ({code}) o una clave de texto ({key}); se traduce al renderizar.
  const errorText = (e) => (!e ? "" : e.key ? t(e.key) : chargeErrorText(lang, e.code));
  const [ars,setArs] = useState(""), [charge,setCharge] = useState(null), [qr,setQr] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [history,setHistory] = useState([]);
  const [nextCursor,setNextCursor]=useState(null),[loadingHistory,setLoadingHistory]=useState(false);
  const [historyReady,setHistoryReady]=useState(false);
  const [expiredOpen, setExpiredOpen] = useState(false);
  const [successSplash, setSuccessSplash] = useState(false);
  const [dismissedExpired, setDismissedExpired] = useState(() => readDismissedExpired(userId));
  useEffect(() => {
    setDismissedExpired(readDismissedExpired(userId));
    setExpiredOpen(false);
  }, [userId]);
  const handleSplashChange = useCallback((active) => {
    setSuccessSplash(Boolean(active));
  }, []);
  const attempt = useRef(null), notified = useRef(new Set()), mounted = useRef(true), starting = useRef(false);
  const selectedId=useRef(null);
  const historyRef=useRef(history);historyRef.current=history;
  const deliveredCallback = useRef(onDelivered); deliveredCallback.current = onDelivered;
  const paidCallback = useRef(onPaymentReceived); paidCallback.current = onPaymentReceived;
  const request = useCallback(async (path,options) => chargeApi(path,await getAccessToken(),options),[getAccessToken]);
  const notify=useCallback((current)=>{
    const event=current.status==="delivered"?"delivered":paymentReceived(current)?"paid":null;
    const key=`${event}:${current.id}`;
    if(!event || notified.current.has(key))return;
    notified.current.add(key);
    Promise.resolve((event==="delivered"?deliveredCallback:paidCallback).current?.(current)).catch(()=>{
      if(mounted.current)setError({ key: "mpCharge.receivedRefresh" });
    });
  },[]);
  const accept = useCallback((current,key) => {
    if (!mounted.current) return;
    setHistory((list) => list.some((c)=>c.id===current.id)?list.map((c)=>c.id===current.id?current:c):[current,...list]);
    if (key && attempt.current?.key===key) {
      attempt.current = bindChargeAttempt(attempt.current,current,key);
      saveChargeAttempt(userId,attempt.current);
    }
    if (canStartNewCharge(current) && attempt.current?.id===current.id) {
      clearChargeAttempt(userId);attempt.current=null;
    }
    notify(current);
    // Nunca mostrar pantallas de cancelación: volver al ingreso de monto.
    if (["canceled", "cancel_pending"].includes(current.status)) {
      if (attempt.current?.id === current.id) {
        clearChargeAttempt(userId);
        attempt.current = null;
      }
      if (selectedId.current === current.id || selectedId.current == null) {
        selectedId.current = null;
        setCharge(null);
        setQr("");
      }
      return;
    }
    selectedId.current=current.id;
    setCharge(current);
  },[userId,notify]);
  const start = useCallback(async (value) => {
    if (starting.current) return;
    starting.current = true; setBusy(true); setError("");
    try {
      const saved = prepareChargeAttempt(attempt.current,value,address);
      saveChargeAttempt(userId,saved); attempt.current = saved;
      const { charge:current } = await request("/charges",{method:"POST",headers:{"Idempotency-Key":saved.key},
        body:JSON.stringify({ars:saved.ars,wallet:saved.wallet})});
      accept(current,saved.key);
    } catch (e) {
      // Keep the key even after validation errors: a previous request may still be completing.
      if (e.code === "idempotency_conflict" && attempt.current) {
        try {
          const result = await request(`/charges?attempt=${encodeURIComponent(attempt.current.key)}`);
          if (result.charge) { accept(result.charge,attempt.current.key); return; }
        } catch { /* Preserve the attempt until the server is reachable. */ }
      }
      if (mounted.current) setError({ code: e.code });
    }
    finally { starting.current=false; if (mounted.current) setBusy(false); }
  },[userId,address,request,accept]);

  useEffect(() => {
    mounted.current=true;
    let canceled=false;
    setHistoryReady(false);
    attempt.current=readChargeAttempt(userId);
    if (attempt.current) setArs(String(attempt.current.ars || "").replace(".", ","));
    request("/charges").then(({charges,nextCursor:after}) => {
      if (canceled) return;
      setHistory(charges);
      setNextCursor(after);
      const saved=attempt.current;
      const current=charges.find((c) => c.id === saved?.id) || (!saved && charges.find((c) => !canStartNewCharge(c)));
      if (current && ["canceled", "cancel_pending"].includes(current.status)) {
        if (saved?.id === current.id) { clearChargeAttempt(userId); attempt.current=null; }
      } else if (current) {
        accept(current);
      }
      else if (saved) {
        // Opening the screen only recovers an existing operation; it never starts a payment.
        return request(`/charges?attempt=${encodeURIComponent(saved.key)}`).then((result)=>{
          if (!canceled && result.charge) accept(result.charge,saved.key);
        }).catch((e)=>{ if (!canceled) setError({ code: e.code }); });
      }
    }).catch((e) => { if (!canceled) setError({ code: e.code }); })
      .finally(()=>{if(!canceled)setHistoryReady(true);});
    return () => { canceled=true; mounted.current=false; };
  },[userId,request,accept,start]);

  useEffect(() => {
    if (!chargeRequest || !historyReady) return;
    if ((!charge || canStartNewCharge(charge)) && !attempt.current && !starting.current) {
      setCharge(null);setArs(String(chargeRequest.ars));start(chargeRequest.ars);
    }
    onChargeRequestConsumed();
  },[chargeRequest,charge,start,onChargeRequestConsumed,historyReady]);

  useEffect(() => {
    let canceled=false;
    const done = charge?.status === "delivered" || charge?.settled === true;
    if (!charge?.qrData || done) {
      setQr("");
      return () => { canceled=true; };
    }
    QRCode.toDataURL(charge.qrData,{margin:4,width:320,errorCorrectionLevel:"M"})
      .then((value) => { if (!canceled) setQr(value); })
      .catch(() => { if (!canceled) setError({ key: "mpCharge.qrRenderError" }); });
    return () => { canceled=true; };
  },[charge?.id,charge?.qrData,charge?.status,charge?.settled]);

  useEffect(() => {
    if (!charge || terminal.has(charge.status)) return;
    const pollMs=["paid","delivery_pending","broadcasting","confirmed"].includes(charge.status)?2500:5000;
    let canceled=false, timer;
    const poll=async () => {
      try { const {charge:current}=await request(`/charges/${charge.id}`); if (!canceled && selectedId.current===charge.id) { accept(current); setError(""); } }
      catch (e) { if (!canceled && selectedId.current===charge.id) setError({ code: e.code }); }
      if (!canceled) timer=setTimeout(poll,pollMs);
    };
    timer=setTimeout(poll,pollMs);
    return () => { canceled=true;clearTimeout(timer); };
  },[charge?.id,charge?.status,request,accept]);

  const backgroundCharges=history.filter(c=>c.id!==charge?.id);
  const backgroundPollMs=backgroundCharges.some(c=>["paid","delivery_pending","broadcasting","confirmed"].includes(c.status))?2500:
    backgroundCharges.some(c=>c.status==="manual_review" && paymentReceived(c))?15000:null;
  useEffect(()=>{
    if(!historyReady || !backgroundPollMs)return;
    let canceled=false,timer;
    const poll=async()=>{
      const tracked=new Set(historyRef.current.filter(c=>paymentReceived(c) && c.status!=="delivered").map(c=>c.id));
      try {
        const {charges}=await request("/charges");
        if(!canceled){
          setHistory(previous=>{
            const fresh=new Map(charges.map(c=>[c.id,c]));
            return previous.map(c=>fresh.get(c.id)||c);
          });
          // Refresh completed deliveries without selecting them over a new QR.
          for(const current of charges)if(current.status==="delivered" && tracked.has(current.id))notify(current);
        }
      } catch { /* The worker continues even if a history refresh fails. */ }
      finally {if(!canceled)timer=setTimeout(poll,backgroundPollMs);}
    };
    timer=setTimeout(poll,backgroundPollMs);
    return ()=>{canceled=true;clearTimeout(timer);};
  },[historyReady,backgroundPollMs,request,notify]);

  const cancel=async () => {
    if (!charge) return;
    setBusy(true);setError("");
    try {
      const result=await request(`/charges/${charge.id}/cancel`,{method:"POST"});
      const current=result.charge;
      setHistory((list)=>list.some((c)=>c.id===current.id)?list.map((c)=>c.id===current.id?current:c):[current,...list]);
      if(attempt.current?.id===charge.id){clearChargeAttempt(userId);attempt.current=null;}
      selectedId.current=null;
      setCharge(null);setQr("");setArs("");setError("");
    }
    catch(e) { setError({ code: e.code }); }
    finally { setBusy(false); }
  };
  const reset=() => {
    if(attempt.current?.id===charge?.id){clearChargeAttempt(userId);attempt.current=null;}
    selectedId.current=null;
    setCharge(null);setQr("");setArs(attempt.current?.ars || "");setError("");
  };
  const moreHistory=async()=>{
    setLoadingHistory(true);
    try{const result=await request(`/charges?cursor=${encodeURIComponent(nextCursor)}`);
      if(mounted.current){setHistory((list)=>[...list,...result.charges.filter((c)=>!list.some((old)=>old.id===c.id))]);setNextCursor(result.nextCursor);}}
    catch(e){if(mounted.current)setError({ code: e.code });}finally{if(mounted.current)setLoadingHistory(false);}
  };

  const amountNumber = Number(String(ars).replace(/\./g, "").replace(",", "."));
  const canSubmit = historyReady && !busy && Number.isFinite(amountNumber) && amountNumber > 0;
  const displayEmpty = !ars;

  const backButton = onBack ? (
    <button
      type="button"
      onClick={onBack}
      aria-label={t("mpCharge.back")}
      style={{
        width: 40,
        height: 40,
        border: 0,
        borderRadius: 12,
        background: "transparent",
        color: INK,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        padding: 0,
        marginLeft: -6,
      }}
    >
      <IconBack />
    </button>
  ) : null;

  const expiredCharges = history
    .filter((c) => isExpiredCharge(c) && !dismissedExpired.has(c.id))
    .slice(0, 5);

  const chargeAgainFromExpired = async (c) => {
    setExpiredOpen(false);
    if (attempt.current?.id === charge?.id) {
      clearChargeAttempt(userId);
      attempt.current = null;
    }
    selectedId.current = null;
    setCharge(null);
    setQr("");
    setError("");
    const amount = String(c.ars).replace(".", ",");
    setArs(amount);
    await start(amount);
  };

  const dismissExpired = (id) => {
    setDismissedExpired((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissedExpired(userId, next);
      return next;
    });
  };

  useEffect(() => {
    if (expiredCharges.length === 0 && expiredOpen) setExpiredOpen(false);
  }, [expiredCharges.length, expiredOpen]);

  if (charge) {
    return (
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: "100%",
          gap: 0,
          padding: successSplash ? 0 : "10px 18px 18px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {!successSplash && <div style={{ flexShrink: 0 }}>{backButton}</div>}
        {!successSplash && error && (
          <div role="alert" style={{ color: "#E4483D", fontSize: 13, marginTop: 6, flexShrink: 0 }}>
            {errorText(error)}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, marginTop: successSplash ? 0 : 8 }}>
          <ChargeSummary
            charge={charge}
            qr={qr}
            busy={busy}
            onCancel={cancel}
            onReset={reset}
            onSplashChange={handleSplashChange}
            errorMessage={chargeErrorText(lang, charge.lastError)}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "100%",
        gap: 0,
        padding: "10px 18px 18px",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative", zIndex: 2 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
          <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)" }}>
            {backButton}
          </div>
          {expiredCharges.length > 0 && (
            <button
              type="button"
              onClick={() => setExpiredOpen((v) => !v)}
              aria-expanded={expiredOpen}
              style={{
                border: `1px solid ${LINE}`,
                background: expiredOpen ? "#FFF4ED" : "#FAFAFB",
                color: INK,
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                padding: "7px 10px 7px 12px",
                borderRadius: 999,
                maxWidth: "calc(100% - 88px)",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {expiredCharges.length === 1
                  ? t("mpCharge.expiredOne")
                  : t("mpCharge.expiredMany", expiredCharges.length)}
              </span>
              <span
                style={{
                  color: MUT,
                  display: "grid",
                  placeItems: "center",
                  transform: expiredOpen ? "rotate(180deg)" : "none",
                  transition: "transform .15s ease",
                  flexShrink: 0,
                }}
              >
                <IconDown />
              </span>
            </button>
          )}
        </div>

        {expiredOpen && expiredCharges.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {expiredCharges.map((c) => (
              <div
                key={c.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${LINE}`,
                  borderRadius: 14,
                  padding: "10px 8px 10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 8px 24px rgba(22,22,26,0.06)",
                }}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => chargeAgainFromExpired(c)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    background: "transparent",
                    font: "inherit",
                    textAlign: "left",
                    padding: 0,
                    cursor: busy ? "default" : "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontWeight: 700, color: INK, fontSize: 13 }}>
                    $ {Number(c.ars).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: ORANGE, flexShrink: 0 }}>{t("mpCharge.chargeAgain")}</span>
                </button>
                <button
                  type="button"
                  aria-label={t("mpCharge.dismissExpired")}
                  onClick={() => dismissExpired(c.id)}
                  style={{
                    width: 32,
                    height: 32,
                    border: 0,
                    borderRadius: 10,
                    background: "transparent",
                    color: MUT,
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <IconClose />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ color: "#E4483D", fontSize: 13, marginTop: 6, flexShrink: 0, position: "relative", zIndex: expiredOpen ? 0 : 1 }}>
          {errorText(error)}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          filter: expiredOpen ? "blur(5px)" : "none",
          opacity: expiredOpen ? 0.35 : 1,
          transition: "opacity .18s ease, filter .18s ease",
          pointerEvents: expiredOpen ? "none" : "auto",
          userSelect: expiredOpen ? "none" : "auto",
        }}
        aria-hidden={expiredOpen || undefined}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px",
            gap: 14,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: displayEmpty ? 48 : 52,
                fontWeight: 700,
                letterSpacing: -1.2,
                color: displayEmpty ? "#C5C5CC" : INK,
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ fontSize: "0.55em", fontWeight: 600, marginRight: 4, verticalAlign: "super" }}>$</span>
              {formatArsAmount(ars)}
            </div>
            <div
              style={{
                marginTop: 10,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                color: MUT,
              }}
            >
              <FlagAr />
              <span>ARS</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {AMOUNT_PRESETS.map((preset) => {
              const active = Number(String(ars).replace(/\./g, "").replace(",", ".")) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={busy}
                  onClick={() => setArs(String(preset))}
                  style={{
                    border: `1px solid ${active ? ORANGE : LINE}`,
                    background: active ? "#FFF4ED" : "#fff",
                    color: active ? ORANGE : INK,
                    borderRadius: 999,
                    padding: "8px 14px",
                    font: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  $ {preset.toLocaleString("es-AR")}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <AmountKeypad disabled={busy || expiredOpen} onKey={(key) => setArs((prev) => appendAmountDigit(prev, key))} />

          <button
            type="button"
            disabled={!canSubmit || expiredOpen}
            onClick={() => start(ars)}
            style={{
              ...button,
              background: ORANGE,
              color: "white",
              borderRadius: 18,
              padding: "16px 18px",
              fontSize: 16,
              opacity: canSubmit && !expiredOpen ? 1 : 0.4,
              boxShadow: canSubmit && !expiredOpen ? "0 8px 20px rgba(255,90,0,0.28)" : "none",
            }}
          >
            {busy ? t("mpCharge.starting") : attempt.current ? t("mpCharge.continueCharge") : t("mpCharge.charge")}
          </button>
        </div>
      </div>

      {expiredOpen && (
        <button
          type="button"
          aria-label={t("mpCharge.closeExpired")}
          onClick={() => setExpiredOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            border: 0,
            background: "transparent",
            cursor: "pointer",
            zIndex: 1,
            padding: 0,
          }}
        />
      )}
    </section>
  );
}

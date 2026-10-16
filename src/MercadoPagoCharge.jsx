import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { chargeApi, chargeError, readChargeAttempt, saveChargeAttempt, clearChargeAttempt, prepareChargeAttempt, bindChargeAttempt, canStartNewCharge } from "./charges.js";
import { chargeStatusLabel, paymentReceived } from "./chargeStatus.js";
import ChargeSummary from "./ChargeSummary.jsx";
import { useLanguage } from "./i18n.jsx";

const terminal = new Set(["delivered","expired","canceled","refunded"]);
const button = { border:0,borderRadius:14,padding:"14px 18px",font:"inherit",fontWeight:600,cursor:"pointer" };

export default function MercadoPagoCharge({ userId, address, merchantName, getAccessToken, onDelivered, onPaymentReceived, chargeRequest, onChargeRequestConsumed }) {
  const {t}=useLanguage();
  const [ars,setArs] = useState(""), [charge,setCharge] = useState(null), [qr,setQr] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [history,setHistory] = useState([]);
  const [nextCursor,setNextCursor]=useState(null),[loadingHistory,setLoadingHistory]=useState(false);
  const [historyReady,setHistoryReady]=useState(false);
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
      if(mounted.current)setError("El pago fue recibido. Volvé a abrir Activity para actualizar el historial.");
    });
  },[]);
  const accept = useCallback((current,key) => {
    if (!mounted.current) return;
    selectedId.current=current.id;
    setCharge(current);
    setHistory((list) => list.some((c)=>c.id===current.id)?list.map((c)=>c.id===current.id?current:c):[current,...list]);
    if (key && attempt.current?.key===key) {
      attempt.current = bindChargeAttempt(attempt.current,current,key);
      saveChargeAttempt(userId,attempt.current);
    }
    if (canStartNewCharge(current) && attempt.current?.id===current.id) {
      clearChargeAttempt(userId);attempt.current=null;
    }
    notify(current);
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
      if (mounted.current) setError(chargeError(e.code));
    }
    finally { starting.current=false; if (mounted.current) setBusy(false); }
  },[userId,address,request,accept]);

  useEffect(() => {
    mounted.current=true;
    let canceled=false;
    setHistoryReady(false);
    attempt.current=readChargeAttempt(userId);
    if (attempt.current) setArs(attempt.current.ars);
    request("/charges").then(({charges,nextCursor:after}) => {
      if (canceled) return;
      setHistory(charges);
      setNextCursor(after);
      const saved=attempt.current;
      const current=charges.find((c) => c.id === saved?.id) || (!saved && charges.find((c) => !canStartNewCharge(c)));
      if (current) accept(current);
      else if (saved) {
        // Opening the screen only recovers an existing operation; it never starts a payment.
        return request(`/charges?attempt=${encodeURIComponent(saved.key)}`).then((result)=>{
          if (!canceled && result.charge) accept(result.charge,saved.key);
        }).catch((e)=>{ if (!canceled) setError(chargeError(e.code)); });
      }
    }).catch((e) => { if (!canceled) setError(chargeError(e.code)); })
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
    setQr("");
    if (charge?.qrData && charge.status === "awaiting_payment" && !paymentReceived(charge) && new Date(charge.expiresAt).getTime()>Date.now()) {
      QRCode.toDataURL(charge.qrData,{margin:4,width:320,errorCorrectionLevel:"M"})
        .then((value) => { if (!canceled) setQr(value); }).catch(() => { if (!canceled) setError("No se pudo mostrar el QR. Volvé a abrir el cobro."); });
    }
    return () => { canceled=true; };
  },[charge?.qrData,charge?.status,charge?.providerStatus,charge?.providerDetail,charge?.expiresAt]);

  useEffect(() => {
    if (!charge || terminal.has(charge.status)) return;
    const pollMs=["paid","delivery_pending","broadcasting","confirmed"].includes(charge.status)?2500:5000;
    let canceled=false, timer;
    const poll=async () => {
      try { const {charge:current}=await request(`/charges/${charge.id}`); if (!canceled && selectedId.current===charge.id) { accept(current); setError(""); } }
      catch (e) { if (!canceled && selectedId.current===charge.id) setError(chargeError(e.code)); }
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
    setBusy(true);setError("");
    try { const result=await request(`/charges/${charge.id}/cancel`,{method:"POST"});accept(result.charge); }
    catch(e) { setError(chargeError(e.code)); } finally { setBusy(false); }
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
    catch(e){if(mounted.current)setError(chargeError(e.code));}finally{if(mounted.current)setLoadingHistory(false);}
  };
  return <section style={{display:"flex",flexDirection:"column",gap:16}}>
    <h2 style={{margin:0,fontSize:26,overflowWrap:"anywhere"}}>{merchantName}</h2>
    <p style={{margin:0,color:"#7A7A85"}}>Recibí el pago en pesos y acreditá USDC en tu wallet. Comisión de conversión: 0,5%.</p>
    {error && <div role="alert" style={{color:"#E4483D"}}>{error}</div>}
    {!charge ? <>
      <label style={{display:"flex",flexDirection:"column",gap:8}}>Importe en ARS
        <input value={ars} disabled={busy} inputMode="decimal" placeholder="0,00" onChange={(e)=>setArs(e.target.value)} style={{font:"inherit",padding:16,border:"1px solid #ECECF0",borderRadius:14}} />
      </label>
      <button disabled={busy || !ars || !historyReady} onClick={()=>start(ars)} style={{...button,background:"#FF5A00",color:"white",opacity:busy?0.5:1}}>{busy ? "Iniciando cobro…" : attempt.current ? "Iniciar o recuperar cobro" : "Iniciar cobro"}</button>
      {attempt.current && <small>Podés editar el importe si el cobro todavía no fue creado. Si ya existe, recuperaremos la operación original.</small>}
    </> : <ChargeSummary charge={charge} qr={qr} busy={busy} onCancel={cancel} onReset={reset} t={t} errorMessage={chargeError(charge.lastError)} />}
    {history.length>0 && <><h3 style={{marginBottom:0}}>Tus cobros</h3>{history.map((c)=><button key={c.id} disabled={busy} onClick={()=>accept(c)} style={{...button,textAlign:"left",background:"white"}}>$ {c.ars} ARS · {chargeStatusLabel(c)}<div style={{fontSize:12,color:"#7A7A85"}}>{c.reference}</div></button>)}</>}
    {nextCursor && <button disabled={loadingHistory} onClick={moreHistory} style={button}>{loadingHistory?"Cargando…":"Cargar cobros anteriores"}</button>}
  </section>;
}

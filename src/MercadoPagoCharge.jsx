import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { chargeApi, chargeError, readChargeAttempt, saveChargeAttempt, clearChargeAttempt, prepareChargeAttempt } from "./charges.js";

const terminal = new Set(["delivered","expired","canceled","refunded"]);
const labels = { creating:"Creando QR en Mercado Pago…", awaiting_payment:"Esperando pago",
  paid:"Pago confirmado. Preparando USDC…", delivery_pending:"Pago confirmado. Entrega de USDC pendiente",
  broadcasting:"Pago confirmado. Confirmando entrega de USDC…", delivered:"USDC entregados",
  cancel_pending:"Cancelación pendiente de confirmación", expired:"El QR venció", canceled:"Cobro cancelado",
  refunded:"Pago reembolsado", manual_review:"Este cobro requiere revisión" };
const button = { border:0,borderRadius:14,padding:"14px 18px",font:"inherit",fontWeight:600,cursor:"pointer" };

export default function MercadoPagoCharge({ userId, address, getAccessToken, onDelivered, chargeRequest, onChargeRequestConsumed }) {
  const [ars,setArs] = useState(""), [charge,setCharge] = useState(null), [qr,setQr] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [history,setHistory] = useState([]);
  const [nextCursor,setNextCursor]=useState(null),[loadingHistory,setLoadingHistory]=useState(false);
  const attempt = useRef(null), notified = useRef(new Set()), mounted = useRef(true), starting = useRef(false);
  const deliveredCallback = useRef(onDelivered); deliveredCallback.current = onDelivered;
  const request = useCallback(async (path,options) => chargeApi(path,await getAccessToken(),options),[getAccessToken]);
  const accept = useCallback((current) => {
    if (!mounted.current) return;
    setCharge(current);
    setHistory((list) => list.some((c)=>c.id===current.id)?list.map((c)=>c.id===current.id?current:c):[current,...list]);
    if (attempt.current && !attempt.current.id) {
      attempt.current = { ...attempt.current, id:current.id };
      saveChargeAttempt(userId,attempt.current);
    }
    if (current.status === "delivered" && !notified.current.has(current.id)) {
      notified.current.add(current.id);
      clearChargeAttempt(userId);
      Promise.resolve(deliveredCallback.current?.(current)).catch(() => {
        if (mounted.current) setError("Los USDC fueron entregados. Volvé a abrir el historial para actualizar el comprobante.");
      });
    }
  },[userId]);
  const start = useCallback(async (value) => {
    if (starting.current) return;
    starting.current = true; setBusy(true); setError("");
    try {
      const saved = prepareChargeAttempt(attempt.current,value,address);
      saveChargeAttempt(userId,saved); attempt.current = saved;
      const { charge:current } = await request("/charges",{method:"POST",headers:{"Idempotency-Key":saved.key},
        body:JSON.stringify({ars:saved.ars,wallet:saved.wallet})});
      accept(current);
    } catch (e) {
      // Keep the key even after validation errors: a previous request may still be completing.
      if (e.code === "idempotency_conflict" && attempt.current) {
        try {
          const result = await request(`/charges?attempt=${encodeURIComponent(attempt.current.key)}`);
          if (result.charge) { accept(result.charge); return; }
        } catch { /* Preserve the attempt until the server is reachable. */ }
      }
      if (mounted.current) setError(chargeError(e.code));
    }
    finally { starting.current=false; if (mounted.current) setBusy(false); }
  },[userId,address,request,accept]);

  useEffect(() => {
    mounted.current=true;
    let canceled=false;
    attempt.current=readChargeAttempt(userId);
    if (attempt.current) setArs(attempt.current.ars);
    request("/charges").then(({charges,nextCursor:after}) => {
      if (canceled) return;
      setHistory(charges);
      setNextCursor(after);
      const saved=attempt.current;
      const current=charges.find((c) => c.id === saved?.id) || charges.find((c) => !terminal.has(c.status));
      if (current) accept(current);
      else if (saved) {
        // Opening the screen only recovers an existing operation; it never starts a payment.
        request(`/charges?attempt=${encodeURIComponent(saved.key)}`).then((result)=>{
          if (!canceled && result.charge) accept(result.charge);
        }).catch((e)=>{ if (!canceled) setError(chargeError(e.code)); });
      }
    }).catch((e) => { if (!canceled) setError(chargeError(e.code)); });
    return () => { canceled=true; mounted.current=false; };
  },[userId,request,accept,start]);

  useEffect(() => {
    if (!chargeRequest) return;
    if (!charge && !attempt.current && !starting.current) { setArs(String(chargeRequest.ars)); start(chargeRequest.ars); }
    onChargeRequestConsumed();
  },[chargeRequest,charge,start,onChargeRequestConsumed]);

  useEffect(() => {
    let canceled=false;
    setQr("");
    if (charge?.qrData && charge.status === "awaiting_payment" && new Date(charge.expiresAt).getTime()>Date.now()) {
      QRCode.toDataURL(charge.qrData,{margin:4,width:320,errorCorrectionLevel:"M"})
        .then((value) => { if (!canceled) setQr(value); }).catch(() => { if (!canceled) setError("No se pudo mostrar el QR. Volvé a abrir el cobro."); });
    }
    return () => { canceled=true; };
  },[charge?.qrData,charge?.status,charge?.expiresAt]);

  useEffect(() => {
    if (!charge || terminal.has(charge.status)) return;
    let canceled=false, timer;
    const poll=async () => {
      try { const {charge:current}=await request(`/charges/${charge.id}`); if (!canceled) { accept(current); setError(""); } }
      catch (e) { if (!canceled) setError(chargeError(e.code)); }
      if (!canceled) timer=setTimeout(poll,5000);
    };
    timer=setTimeout(poll,5000);
    return () => { canceled=true;clearTimeout(timer); };
  },[charge?.id,charge?.status,request,accept]);

  const cancel=async () => {
    setBusy(true);setError("");
    try { const result=await request(`/charges/${charge.id}/cancel`,{method:"POST"});accept(result.charge); }
    catch(e) { setError(chargeError(e.code)); } finally { setBusy(false); }
  };
  const reset=() => { clearChargeAttempt(userId);attempt.current=null;setCharge(null);setQr("");setArs("");setError(""); };
  const moreHistory=async()=>{
    setLoadingHistory(true);
    try{const result=await request(`/charges?cursor=${encodeURIComponent(nextCursor)}`);
      if(mounted.current){setHistory((list)=>[...list,...result.charges.filter((c)=>!list.some((old)=>old.id===c.id))]);setNextCursor(result.nextCursor);}}
    catch(e){if(mounted.current)setError(chargeError(e.code));}finally{if(mounted.current)setLoadingHistory(false);}
  };
  return <section style={{display:"flex",flexDirection:"column",gap:16}}>
    <h2 style={{margin:0,fontSize:26}}>Cobrar con Mercado Pago</h2>
    <p style={{margin:0,color:"#7A7A85"}}>Recibí el pago en pesos y acreditá USDC en tu wallet. Comisión de conversión: 0,5%.</p>
    {error && <div role="alert" style={{color:"#E4483D"}}>{error}</div>}
    {!charge ? <>
      <label style={{display:"flex",flexDirection:"column",gap:8}}>Importe en ARS
        <input value={ars} disabled={busy} inputMode="decimal" placeholder="0,00" onChange={(e)=>setArs(e.target.value)} style={{font:"inherit",padding:16,border:"1px solid #ECECF0",borderRadius:14}} />
      </label>
      <button disabled={busy || !ars} onClick={()=>start(ars)} style={{...button,background:"#FF5A00",color:"white",opacity:busy?0.5:1}}>{busy ? "Iniciando cobro…" : attempt.current ? "Iniciar o recuperar cobro" : "Iniciar cobro"}</button>
      {attempt.current && <small>Podés editar el importe si el cobro todavía no fue creado. Si ya existe, recuperaremos la operación original.</small>}
    </> : <div style={{padding:20,borderRadius:20,background:"white",display:"flex",flexDirection:"column",gap:12}}>
      <strong aria-live="polite">{labels[charge.status] || "Actualizando cobro"}</strong>
      <div>Importe: $ {charge.ars} ARS</div>
      <div>Comisión: $ {charge.feeArs} ARS · Cotización: $ {charge.fxRate} / USDC</div>
      <strong>A recibir: {charge.usdc} USDC</strong>
      {qr && new Date(charge.expiresAt).getTime()>Date.now() && <img src={qr} width={280} height={280} alt="QR de pago Mercado Pago" style={{alignSelf:"center",maxWidth:"100%",objectFit:"contain"}} />}
      <div style={{fontSize:13,color:"#7A7A85",overflowWrap:"anywhere"}}>Operación: {charge.reference}<br/>Orden: {charge.orderId || "pendiente"}<br/>Vence: {charge.expiresAt ? new Date(charge.expiresAt).toLocaleString() : "pendiente"}</div>
      {charge.lastError && <div role="status" style={{fontSize:13,color:"#E4483D"}}>{chargeError(charge.lastError)}</div>}
      {charge.signature && <div style={{fontSize:12,overflowWrap:"anywhere"}}>Transferencia USDC: {charge.signature}</div>}
      {["creating","awaiting_payment"].includes(charge.status) && <button disabled={busy} onClick={cancel} style={button}>Cancelar cobro</button>}
      {terminal.has(charge.status) && <button onClick={reset} style={{...button,background:"#FF5A00",color:"white"}}>Nuevo cobro</button>}
    </div>}
    {history.length>0 && <><h3 style={{marginBottom:0}}>Tus cobros</h3>{history.map((c)=><button key={c.id} onClick={()=>accept(c)} style={{...button,textAlign:"left",background:"white"}}>$ {c.ars} ARS · {labels[c.status] || c.status}<div style={{fontSize:12,color:"#7A7A85"}}>{c.reference}</div></button>)}</>}
    {nextCursor && <button disabled={loadingHistory} onClick={moreHistory} style={button}>{loadingHistory?"Cargando…":"Cargar cobros anteriores"}</button>}
  </section>;
}

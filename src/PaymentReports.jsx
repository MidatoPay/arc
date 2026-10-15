import { useState,useEffect,useRef,useCallback } from "react";
import { reportsApi,csvColumns,csvCell,csvOperation } from "./paymentReports.js";
import { SOLANA } from "./chain.js";
import { chargeError } from "./charges.js";
const control={font:"inherit",padding:12,border:"1px solid #ECECF0",borderRadius:12};
const button={...control,background:"white",cursor:"pointer"};
const initial={from:"",to:"",merchant:"",status:"",source:"",environment:SOLANA.cluster==="devnet"?"test":"production"};
const params=(f)=>new URLSearchParams(Object.entries(f).filter(([,v])=>v)).toString();
const states={recorded:"Registrada",estimated:"Prevista",review:"En revisión",not_earned:"No generada",not_applicable:"No aplica"};
export default function PaymentReports({getAccessToken,onBack}) {
  const [draft,setDraft]=useState(initial),[filters,setFilters]=useState(initial),[summary,setSummary]=useState(null);
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const [exporting,setExporting]=useState(false),[count,setCount]=useState(0);
  const [readiness,setReadiness]=useState(null),[checking,setChecking]=useState(false);
  const revision=useRef(0),mounted=useRef(true);
  const load=useCallback(async()=>{
    const version=++revision.current;setLoading(true);setError("");setRows([]);setNext(null);setSummary(null);
    try {const query=params(filters);const [list,totals]=await Promise.all([
      reportsApi(`/payment-reports/operations?${query}`,getAccessToken),reportsApi(`/payment-reports/summary?${query}`,getAccessToken)]);
      if(mounted.current && version===revision.current){setRows(list.operations);setNext(list.nextCursor);setSummary(totals);}
    }catch(e){if(mounted.current && version===revision.current)setError(e.code==="admin_required"?"Acceso reservado al administrador.":"No se pudo cargar el reporte. Revisá los filtros y la configuración del servidor.");}
    finally{if(mounted.current && version===revision.current)setLoading(false);}
  },[filters,getAccessToken]);
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;revision.current++;};},[load]);
  const more=async()=>{
    const version=revision.current;setLoading(true);
    try{const result=await reportsApi(`/payment-reports/operations?${params(filters)}&cursor=${encodeURIComponent(next)}`,getAccessToken);
      if(mounted.current && version===revision.current){setRows((old)=>[...old,...result.operations]);setNext(result.nextCursor);}}
    catch{if(mounted.current)setError("No se pudo cargar la siguiente página.");}finally{if(mounted.current && version===revision.current)setLoading(false);}
  };
  const exportCsv=async()=>{
    setExporting(true);setCount(0);setError("");
    try{const lines=[csvColumns.map(csvCell).join(",")];let cursor=null,total=0;
      do{if(!mounted.current)return;const result=await reportsApi(`/payment-reports/operations?${params({...filters,limit:200})}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,getAccessToken);
        lines.push(...result.operations.map(csvOperation));total+=result.operations.length;if(mounted.current)setCount(total);cursor=result.nextCursor;
      }while(cursor);
      if(!mounted.current)return;
      const url=URL.createObjectURL(new Blob(["\ufeff",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
      const link=document.createElement("a");link.href=url;link.download=`operaciones-${filters.environment}-${filters.from || "inicio"}-${filters.to || "hoy"}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{if(mounted.current)setError("La exportación no se completó; no se generó un archivo parcial.");}
    finally{if(mounted.current)setExporting(false);}
  };
  const field=(key)=>({value:draft[key],disabled:exporting,onChange:(e)=>setDraft((f)=>({...f,[key]:e.target.value})),style:control});
  const checkReadiness=async()=>{
    setChecking(true);setError("");
    try {const result=await reportsApi("/payment-reports/readiness",getAccessToken);if(mounted.current)setReadiness(result);}
    catch(error){if(mounted.current)setError(chargeError(error.code));}
    finally {if(mounted.current)setChecking(false);}
  };
  return <section style={{display:"flex",flexDirection:"column",gap:16}}>
    <button style={button} onClick={onBack}>← Volver</button><h2 style={{margin:0}}>Operaciones y comisiones</h2>
    <p style={{margin:0,color:"#7A7A85"}}>Todos los comercios, identificados por su usuario de Privy.</p>
    <button type="button" style={button} disabled={checking} onClick={checkReadiness}>{checking?"Verificando servicios…":"Verificar configuración de cobros"}</button>
    {readiness && <div role="status" style={{padding:16,background:"white",borderRadius:16}}>
      <strong>{readiness.ready?"Servicios verificados":"Hay verificaciones pendientes"} · {readiness.environment} / {readiness.network}</strong>
      <div>Cobros {readiness.paymentsEnabled?"habilitados":"deshabilitados"}. Verificación de solo lectura.</div>
      {readiness.checks.map(check=><div key={check.name} style={{marginTop:8,color:check.status==="pass"?"#257A45":"#B54708"}}>
        {check.status==="pass"?"✓":"!"} {check.name}: {check.status}
        {check.code && <div>{check.code}</div>}
        {check.missingVariables?.length>0 && <div>Faltan: {check.missingVariables.join(", ")}</div>}
        {check.variables?.length>0 && <div>Revisar: {check.variables.join(", ")}</div>}
        {check.details?.ageSeconds!=null && <div>Cotización: {check.details.ageSeconds} segundos · máximo: {check.details.maxAgeSeconds} segundos</div>}
      </div>)}
    </div>}
    <form onSubmit={(e)=>{e.preventDefault();if(!exporting)setFilters({...draft});}} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
      <label>Desde<input type="date" {...field("from")} /></label><label>Hasta<input type="date" {...field("to")} /></label>
      <label>Comercio<input placeholder="did:privy:…" {...field("merchant")} /></label>
      <label>Ambiente<select {...field("environment")}><option value="production">Producción</option><option value="test">Prueba</option></select></label>
      <label>Tipo<select {...field("source")}><option value="">Todos</option><option value="mercadopago">Mercado Pago</option><option value="wallet">Wallet</option></select></label>
      <label>Estado<select {...field("status")}><option value="">Todos</option>{["creating","awaiting_payment","paid","delivery_pending","broadcasting","delivered","cancel_pending","expired","canceled","refunded","manual_review","confirmed"].map((v)=><option key={v}>{v}</option>)}</select></label>
      <button disabled={loading || exporting} style={{...button,background:"#FF5A00",color:"white"}}>Consultar</button>
      <button type="button" disabled={loading || exporting || !summary} onClick={exportCsv} style={button}>{exporting?`Exportando ${count}…`:"Exportar historial completo CSV"}</button>
    </form>
    {error && <div role="alert" style={{color:"#E4483D"}}>{error}</div>}{loading && <div role="status">Cargando…</div>}
    {summary && <>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {[["Operaciones",summary.totals.operations],["Comisiones registradas",`$ ${summary.totals.recordedFeeArs} ARS`],
          ["En revisión",`$ ${summary.totals.reviewFeeArs} ARS`],["Sin incidencia",`$ ${summary.totals.feeArsWithoutReview} ARS`],
          ["Previstas",`$ ${summary.totals.estimatedFeeArs} ARS`]].map(([title,value])=><div key={title} style={{padding:16,background:"white",borderRadius:16}}><div>{title}</div><strong>{value}</strong></div>)}
      </div>
      <p style={{fontSize:13,color:"#7A7A85",margin:0}}>Operaciones por fecha de creación; comisiones registradas por fecha de entrega USDC. Fechas de Argentina. Comisiones brutas, sin descontar costos de Mercado Pago y Solana. Las devoluciones requieren revisión.</p>
      <details><summary>Totales por comercio</summary>{summary.merchants.map((m)=><div key={m.merchantId} style={{padding:12,overflowWrap:"anywhere"}}>
        <button disabled={exporting} style={button} onClick={()=>{setDraft((f)=>({...f,merchant:m.merchantId}));setFilters((f)=>({...f,merchant:m.merchantId}));}}>{m.merchantId}</button>
        <div>{m.operations} operaciones · Registradas $ {m.recordedFeeArs} · En revisión $ {m.reviewFeeArs} · Previstas $ {m.estimatedFeeArs}</div>
      </div>)}</details>
    </>}
    <div style={{overflowX:"auto",background:"white",borderRadius:16}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,textAlign:"left"}}>
      <thead><tr>{["Fecha / comercio","Operación","ARS","Comisión ARS","USDC","Identificadores"].map((v)=><th key={v} style={{padding:12}}>{v}</th>)}</tr></thead>
      <tbody>{rows.map((r)=><tr key={`${r.source}:${r.id}`} style={{borderTop:"1px solid #ECECF0"}}>
        <td style={{padding:12}}>{new Date(r.createdAt).toLocaleString("es-AR",{timeZone:"America/Argentina/Buenos_Aires"})}<div style={{fontSize:11,overflowWrap:"anywhere"}}>{r.merchantId}</div></td>
        <td style={{padding:12}}>{r.source}<div>{r.status} · {r.direction}</div></td><td style={{padding:12}}>$ {r.ars}</td>
        <td style={{padding:12}}>{r.source==="mercadopago"?`$ ${r.feeArs} (${r.feeBps/100}%)`:"—"}<div>{states[r.commissionState]}</div></td>
        <td style={{padding:12}}>{r.usdc}</td><td style={{padding:12,fontSize:11,overflowWrap:"anywhere",minWidth:150}}>{r.reference}<div>{r.orderId}</div><div>{r.paymentId}</div><div>{r.signature}</div></td>
      </tr>)}</tbody>
    </table>{!loading && !rows.length && <p style={{padding:16}}>No hay operaciones para estos filtros.</p>}</div>
    {next && <button disabled={loading || exporting} onClick={more} style={button}>Cargar más</button>}
  </section>;
}

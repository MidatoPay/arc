import { useState,useEffect,useRef,useCallback } from "react";
import { reportsApi,csvColumns,csvCell,csvOperation } from "./paymentReports.js";
import { ARC } from "./chain.js";
import { useOptionalLanguage } from "./i18n.jsx";
import { chargeErrorText } from "./errorText.js";
const control={font:"inherit",padding:12,border:"1px solid #ECECF0",borderRadius:12};
const button={...control,background:"white",cursor:"pointer"};
const initial={from:"",to:"",merchant:"",status:"",source:"",environment:ARC.testnet?"test":"production"};
const params=(f)=>new URLSearchParams(Object.entries(f).filter(([,v])=>v)).toString();
export default function PaymentReports({getAccessToken,onBack}) {
  const lang=useOptionalLanguage();const {t,locale}=lang;
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
    }catch(e){if(mounted.current && version===revision.current)setError(e.code==="admin_required"?"reports.adminOnly":"reports.loadError");}
    finally{if(mounted.current && version===revision.current)setLoading(false);}
  },[filters,getAccessToken]);
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;revision.current++;};},[load]);
  const more=async()=>{
    const version=revision.current;setLoading(true);
    try{const result=await reportsApi(`/payment-reports/operations?${params(filters)}&cursor=${encodeURIComponent(next)}`,getAccessToken);
      if(mounted.current && version===revision.current){setRows((old)=>[...old,...result.operations]);setNext(result.nextCursor);}}
    catch{if(mounted.current)setError("reports.nextPageError");}finally{if(mounted.current && version===revision.current)setLoading(false);}
  };
  const exportCsv=async()=>{
    setExporting(true);setCount(0);setError("");
    try{const lines=[csvColumns.map(csvCell).join(",")];let cursor=null,total=0;
      do{if(!mounted.current)return;const result=await reportsApi(`/payment-reports/operations?${params({...filters,limit:200})}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,getAccessToken);
        lines.push(...result.operations.map(csvOperation));total+=result.operations.length;if(mounted.current)setCount(total);cursor=result.nextCursor;
      }while(cursor);
      if(!mounted.current)return;
      const url=URL.createObjectURL(new Blob(["\ufeff",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
      const link=document.createElement("a");link.href=url;link.download=`${t("reports.csvName")}-${filters.environment}-${filters.from || "start"}-${filters.to || "today"}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{if(mounted.current)setError("reports.exportError");}
    finally{if(mounted.current)setExporting(false);}
  };
  const field=(key)=>({value:draft[key],disabled:exporting,onChange:(e)=>setDraft((f)=>({...f,[key]:e.target.value})),style:control});
  const checkReadiness=async()=>{
    setChecking(true);setError("");
    try {const result=await reportsApi("/payment-reports/readiness",getAccessToken);if(mounted.current)setReadiness(result);}
    catch(error){if(mounted.current)setError({code:error.code});}
    finally {if(mounted.current)setChecking(false);}
  };
  return <section style={{display:"flex",flexDirection:"column",gap:16}}>
    <button style={button} onClick={onBack}>{t("reports.back")}</button><h2 style={{margin:0}}>{t("reports.title")}</h2>
    <p style={{margin:0,color:"#7A7A85"}}>{t("reports.subtitle")}</p>
    <button type="button" style={button} disabled={checking} onClick={checkReadiness}>{checking?t("reports.checking"):t("reports.checkConfig")}</button>
    {readiness && <div role="status" style={{padding:16,background:"white",borderRadius:16}}>
      <strong>{readiness.ready?t("reports.servicesOk"):t("reports.servicesPending")} · {readiness.environment} / {readiness.network}</strong>
      <div>{t("reports.paymentsState",readiness.paymentsEnabled)}</div>
      {readiness.checks.map(check=><div key={check.name} style={{marginTop:8,color:check.status==="pass"?"#257A45":"#B54708"}}>
        {check.status==="pass"?"✓":"!"} {check.name}: {check.status}
        {check.code && <div>{check.code}</div>}
        {check.missingVariables?.length>0 && <div>{t("reports.missing")}: {check.missingVariables.join(", ")}</div>}
        {check.variables?.length>0 && <div>{t("reports.reviewVars")}: {check.variables.join(", ")}</div>}
        {check.details?.ageSeconds!=null && <div>{t("reports.quoteAge",check.details.ageSeconds,check.details.maxAgeSeconds)}</div>}
        {check.details?.publishedHeartbeatSeconds && <div>{t("reports.heartbeat",check.details.publishedHeartbeatSeconds)}
          {check.details.maxAgeSeconds<check.details.publishedHeartbeatSeconds && t("reports.heartbeatWarning")}</div>}
      </div>)}
    </div>}
    <form onSubmit={(e)=>{e.preventDefault();if(!exporting)setFilters({...draft});}} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
      <label>{t("reports.from")}<input type="date" {...field("from")} /></label><label>{t("reports.to")}<input type="date" {...field("to")} /></label>
      <label>{t("reports.merchant")}<input placeholder="did:privy:…" {...field("merchant")} /></label>
      <label>{t("reports.environment")}<select {...field("environment")}><option value="production">{t("reports.production")}</option><option value="test">{t("reports.test")}</option></select></label>
      <label>{t("reports.type")}<select {...field("source")}><option value="">{t("reports.all")}</option><option value="mercadopago">Mercado Pago</option><option value="wallet">Wallet</option></select></label>
      <label>{t("reports.status")}<select {...field("status")}><option value="">{t("reports.all")}</option>{["creating","awaiting_payment","paid","delivery_pending","broadcasting","delivered","cancel_pending","expired","canceled","refunded","manual_review","confirmed"].map((v)=><option key={v}>{v}</option>)}</select></label>
      <button disabled={loading || exporting} style={{...button,background:"#FF5A00",color:"white"}}>{t("reports.query")}</button>
      <button type="button" disabled={loading || exporting || !summary} onClick={exportCsv} style={button}>{exporting?t("reports.exporting",count):t("reports.exportCsv")}</button>
    </form>
    {error && <div role="alert" style={{color:"#E4483D"}}>{typeof error==="string"?t(error):chargeErrorText(lang,error.code)}</div>}{loading && <div role="status">{t("reports.loading")}</div>}
    {summary && <>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {[[t("reports.totalOperations"),summary.totals.operations],[t("reports.totalRecorded"),`$ ${summary.totals.recordedFeeArs} ARS`],
          [t("reports.totalReview"),`$ ${summary.totals.reviewFeeArs} ARS`],[t("reports.totalClean"),`$ ${summary.totals.feeArsWithoutReview} ARS`],
          [t("reports.totalEstimated"),`$ ${summary.totals.estimatedFeeArs} ARS`]].map(([title,value])=><div key={title} style={{padding:16,background:"white",borderRadius:16}}><div>{title}</div><strong>{value}</strong></div>)}
      </div>
      <p style={{fontSize:13,color:"#7A7A85",margin:0}}>{t("reports.footnote")}</p>
      <details><summary>{t("reports.byMerchant")}</summary>{summary.merchants.map((m)=><div key={m.merchantId} style={{padding:12,overflowWrap:"anywhere"}}>
        <button disabled={exporting} style={button} onClick={()=>{setDraft((f)=>({...f,merchant:m.merchantId}));setFilters((f)=>({...f,merchant:m.merchantId}));}}>{m.merchantId}</button>
        <div>{t("reports.merchantLine",m)}</div>
      </div>)}</details>
    </>}
    <div style={{overflowX:"auto",background:"white",borderRadius:16}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,textAlign:"left"}}>
      <thead><tr>{t("reports.columns").map((v)=><th key={v} style={{padding:12}}>{v}</th>)}</tr></thead>
      <tbody>{rows.map((r)=><tr key={`${r.source}:${r.id}`} style={{borderTop:"1px solid #ECECF0"}}>
        <td style={{padding:12}}>{new Date(r.createdAt).toLocaleString(locale,{timeZone:"America/Argentina/Buenos_Aires"})}<div style={{fontSize:11,overflowWrap:"anywhere"}}>{r.merchantId}</div></td>
        <td style={{padding:12}}>{r.source}<div>{r.status} · {r.direction}</div></td><td style={{padding:12}}>$ {r.ars}</td>
        <td style={{padding:12}}>{r.source==="mercadopago"?`$ ${r.feeArs} (${r.feeBps/100}%)`:"—"}<div>{r.commissionState ? t(`reports.commission.${r.commissionState}`) : ""}</div></td>
        <td style={{padding:12}}>{r.usdc}</td><td style={{padding:12,fontSize:11,overflowWrap:"anywhere",minWidth:150}}>{r.reference}<div>{r.orderId}</div><div>{r.paymentId}</div><div>{r.txHash}</div></td>
      </tr>)}</tbody>
    </table>{!loading && !rows.length && <p style={{padding:16}}>{t("reports.empty")}</p>}</div>
    {next && <button disabled={loading || exporting} onClick={more} style={button}>{t("reports.loadMore")}</button>}
  </section>;
}

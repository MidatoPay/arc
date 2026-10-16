import { chargeStatusLabel, paymentReceived, deliveryPhase, deliveryNoticeKey, canStartNewCharge } from "./chargeStatus.js";

const button={border:0,borderRadius:14,padding:"14px 18px",font:"inherit",fontWeight:600,cursor:"pointer"};

export default function ChargeSummary({charge,qr,busy,onCancel,onReset,t,errorMessage,now}) {
  const received=paymentReceived(charge),phase=deliveryPhase(charge,now),noticeKey=deliveryNoticeKey(charge,now);
  const phaseKey=({pending:"chargePaidPending",confirmed:"chargeConfirmed",delayed:"chargePaidDelayed",review:"chargePaidReview",delivered:"chargeDelivered"})[phase];
  return <div style={{padding:20,borderRadius:20,background:"white",display:"flex",flexDirection:"column",gap:12}}>
    <strong aria-live="polite" style={received?{color:"#16804A"}:undefined}>{received?"✅ ":""}{chargeStatusLabel(charge)}</strong>
    <div>Importe: $ {charge.ars} ARS</div>
    <div>Comisión: $ {charge.feeArs} ARS · Cotización: $ {charge.fxRate} / USDC</div>
    <strong>{phase==="delivered"?"USDC acreditados":received?"USDC pendientes de acreditación":"A recibir"}: {charge.usdc} USDC</strong>
    {phaseKey && <div role="status" style={{fontSize:14,color:"#7A7A85"}}>{t(`movs.${phaseKey}`)}</div>}
    {noticeKey && <p style={{margin:0,fontSize:14,lineHeight:1.5,color:"#7A7A85"}}>{t(`movs.${noticeKey}`)}</p>}
    {qr && !received && charge.status==="awaiting_payment" && new Date(charge.expiresAt).getTime()>(now??Date.now()) && <img src={qr} width={280} height={280} alt="QR de pago MIDATOPAY" style={{alignSelf:"center",maxWidth:"100%",objectFit:"contain"}} />}
    <div style={{fontSize:13,color:"#7A7A85",overflowWrap:"anywhere"}}>Operación: {charge.reference}<br/>Orden: {charge.orderId || "pendiente"}{!received && <><br/>Vence: {charge.expiresAt ? new Date(charge.expiresAt).toLocaleString() : "pendiente"}</>}</div>
    {charge.lastError && !received && <div role="status" style={{fontSize:13,color:"#E4483D"}}>{errorMessage}</div>}
    {charge.signature && <div style={{fontSize:12,overflowWrap:"anywhere"}}>Transferencia USDC: {charge.signature}</div>}
    {!received && ["creating","awaiting_payment"].includes(charge.status) && <button disabled={busy} onClick={onCancel} style={button}>Cancelar cobro</button>}
    {!received && ["cancel_pending","manual_review"].includes(charge.status) &&
      <p style={{margin:0,color:"#7A7A85"}}>{charge.status === "cancel_pending" ? "La cancelación todavía no se confirmó." : "Este cobro sigue en revisión."} Podés iniciar otro cobro y consultar esta operación desde el historial.</p>}
    {canStartNewCharge(charge) && <button disabled={busy} onClick={onReset} style={{...button,background:"#FF5A00",color:"white"}}>Nuevo cobro</button>}
  </div>;
}

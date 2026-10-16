import {useEffect,useState} from 'react';
import {transferApi,transferError} from './transfers.js';
import {explorerTxUrl} from './chain.js';
export default function TransferReceipt({transfer:initial,getAccessToken,onClose,onUpdate}) {
 const [transfer,setTransfer]=useState(initial),[error,setError]=useState('');
 useEffect(()=>{
  let canceled=false,timer;
  const poll=async()=>{
   try {
    const {transfer:t}=await transferApi(`/transfers/${initial.id}`,getAccessToken);
    if(canceled)return;setTransfer(t);setError('');onUpdate?.(t);
    if(!['completed','failed'].includes(t.status))timer=setTimeout(poll,t.status==='manual_review'?15000:2500);
   }catch{if(!canceled){setError('No pudimos actualizar el estado. El envío sigue registrado; consultá Activity.');timer=setTimeout(poll,10000);}}
  };
  poll();return()=>{canceled=true;clearTimeout(timer);};
 },[initial.id,getAccessToken]);
 const labels={awaiting_signature:'Pendiente de firma',broadcasting:'Transferencia pendiente',confirmed:'Confirmada · esperando finalización',completed:'USDC enviados',failed:'Transferencia fallida',manual_review:'Transferencia en revisión'};
 return <section style={{display:'flex',flexDirection:'column',gap:16,overflowWrap:'anywhere'}}>
  <h2>{labels[transfer.status] || 'Consultando transferencia'}</h2>
  <strong>{transfer.usdc} USDC</strong>
  <div>Desde: {transfer.from}</div><div>Para: {transfer.to}</div>
  <div>Red: Solana {transfer.network}</div><div>Costo para vos: 0 SOL</div>
  {transfer.lastError && <p role="status">{transferError(transfer.lastError)}</p>}
  {error && <p role="alert">{error}</p>}
  {transfer.signature && <a href={explorerTxUrl(transfer.signature)} target="_blank" rel="noreferrer">Ver transacción en Solana Explorer ↗</a>}
  <button onClick={()=>onClose('movs')} style={{padding:14,borderRadius:12,font:'inherit'}}>Ver Activity</button>
  <button onClick={()=>onClose('home')} style={{padding:14,borderRadius:12,font:'inherit'}}>Volver al inicio</button>
 </section>;
}

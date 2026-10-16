export default function TransferApproval({engine}) {
 const a=engine.approval;if(!a)return null;
 return <div className="mp-overlay" style={{background:'rgba(16,16,22,.55)',zIndex:1000}}>
  <section role="dialog" aria-modal="true" aria-labelledby="transfer-approval" style={{background:'white',borderRadius:24,padding:24,width:'100%',maxWidth:440,boxSizing:'border-box',overflowWrap:'anywhere'}}>
   <h2 id="transfer-approval">Confirmar transferencia</h2>
   <p><strong>{a.input.amount} USDC</strong></p>
   <p>Origen: <span style={{fontFamily:'monospace'}}>{a.input.from}</span></p>
   <p>Destinatario: {a.recipient}</p>
   <p style={{fontFamily:'monospace'}}>{a.input.to}</p>
   <p>Red: Solana {a.input && (engine.network || '')}</p>
   <p>Costo para vos: <strong>0 SOL</strong>. MidatoPay cubre la red.</p>
   <p>Máximo 2 envíos por día.{engine.info?.quota && ` Disponibles: ${engine.info.quota.remaining}.`}</p>
   {engine.error && <p role="alert" style={{color:'#E4483D'}}>{engine.error}</p>}
   <button disabled={engine.busy} onClick={engine.approve} style={{padding:14,border:0,borderRadius:12,background:'#FF5A00',color:'white',font:'inherit',width:'100%'}}>{engine.busy?'Autorizando…':'Confirmar y firmar con Privy'}</button>
   <button disabled={engine.busy} onClick={engine.cancel} style={{marginTop:12,padding:12,width:'100%',font:'inherit'}}>Cancelar</button>
  </section>
 </div>;
}

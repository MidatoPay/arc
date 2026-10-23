import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {activityStatusKey,activityRefreshInterval,mergeByHash} from '../src/transactions.js';
import {assertTransferMatches} from '../src/transfers.js';
async function component(file) {
 const compiled=await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*']});
 const loaded={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
 return loaded.exports;
}
const Receipt=(await component('src/TransferReceipt.jsx')).default,approvalModule=await component('src/TransferApproval.jsx');
const Approval=approvalModule.default;
const primary='0x8ba1f109551bD432803012645Ac136ddd64DBA72',recipient='0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const transfer={id:'id',from:primary,to:recipient,usdc:'0.000001',status:'broadcasting',network:'arc-mainnet',txHash:`0x${'ab'.repeat(32)}`};
test('receipts never present pending, failed or ambiguous broadcasts as completed',()=>{
 for(const [status,label] of [['broadcasting','Transferencia pendiente'],['failed','Transferencia fallida'],['manual_review','Transferencia en revisión']]) {
  const html=renderToStaticMarkup(createElement(Receipt,{transfer:{...transfer,status}}));
  assert.match(html,new RegExp(label));assert.doesNotMatch(html,/USDC enviados/);assert.match(html,/0.000001/);
 }
 assert.match(renderToStaticMarkup(createElement(Receipt,{transfer:{...transfer,status:'completed'}})),/USDC enviados/);
});
test('approval shows the full recipient address, exact amount, network and the USDC gas paid by the user',()=>{
 const engine=fee=>({approval:{input:{from:transfer.from,to:transfer.to,amount:transfer.usdc},recipient:'Ana'},network:'arc-mainnet',info:{networkFeeUsdc:fee}});
 const html=renderToStaticMarkup(createElement(Approval,{engine:engine('0.006')}));
 // Exact amount in Argentine format (no rounding); the source is always the primary wallet, so the sheet omits it.
 for(const content of [recipient,'0,000001','Arc Mainnet','≈ 0,006 USDC','Confirmar y firmar'])assert.ok(html.includes(content),content);
 for(const absent of ['Solana','SOL','Disponibles'])assert.ok(!html.includes(absent),absent);
 assert.ok(renderToStaticMarkup(createElement(Approval,{engine:engine(null)})).includes('Se calcula al confirmar'));
 assert.equal(approvalModule.networkFeeText('0.000500000000000000'),'≈ 0,0005 USDC');
 assert.equal(approvalModule.networkFeeText('0'),null);
});
test('Activity tracks pending transfers and replaces them with a unique finalized entry',()=>{
 assert.equal(activityStatusKey({source:'transfer',status:'completed'}),'transferCompleted');
 assert.equal(activityRefreshInterval([{source:'transfer',status:'broadcasting'}]),2500);
 assert.equal(activityRefreshInterval([{source:'transfer',status:'completed'}]),null);
 const old={hash:'temporary',transferId:'id'},fresh={hash:'final',transferId:'id'};
 assert.deepEqual(mergeByHash([fresh],[old]),[fresh]);
});
test('recovery cannot substitute the recipient, source, amount, flow or network approved by the user',()=>{
 const expected={from:primary,to:recipient,amount:'0.123031',kind:'pay'};
 const valid={from:primary.toLowerCase(),to:recipient,usdc:'0.123031',kind:'pay',network:'arc-mainnet'};
 assert.doesNotThrow(()=>assertTransferMatches(valid,expected,'arc-mainnet'));
 const another='0x0000000000000000000000000000000000000001';
 for(const changed of [{from:another},{to:another},{usdc:'1'},{kind:'voice'},{network:'other-network'}])
  assert.throws(()=>assertTransferMatches({...valid,...changed},expected,'arc-mainnet'),/no coincide/);
});

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
 return loaded.exports.default;
}
const Receipt=await component('src/TransferReceipt.jsx'),Approval=await component('src/TransferApproval.jsx');
const transfer={id:'id',from:'primary-address',to:'recipient-address',usdc:'0.000001',status:'broadcasting',network:'mainnet-beta',signature:'signature'};
test('receipts never present pending, failed or ambiguous broadcasts as completed',()=>{
 for(const [status,label] of [['broadcasting','Transferencia pendiente'],['confirmed','esperando finalización'],['failed','Transferencia fallida'],['manual_review','Transferencia en revisión']]) {
  const html=renderToStaticMarkup(createElement(Receipt,{transfer:{...transfer,status}}));
  assert.match(html,new RegExp(label));assert.doesNotMatch(html,/USDC enviados/);assert.match(html,/0.000001/);
 }
 assert.match(renderToStaticMarkup(createElement(Receipt,{transfer:{...transfer,status:'completed'}})),/USDC enviados/);
});
test('approval shows full addresses, exact amount, zero user cost, network and daily quota',()=>{
 const html=renderToStaticMarkup(createElement(Approval,{engine:{approval:{input:{from:transfer.from,to:transfer.to,amount:transfer.usdc},recipient:'Ana'},network:'mainnet-beta',info:{quota:{remaining:1}}}}));
 for(const content of ['primary-address','recipient-address','0.000001','0 SOL','mainnet-beta','Disponibles: 1','Confirmar y firmar'])assert.ok(html.includes(content));
});
test('Activity tracks pending transfers and replaces them with a unique finalized entry',()=>{
 assert.equal(activityStatusKey({source:'transfer',status:'completed'}),'transferCompleted');
 assert.equal(activityRefreshInterval([{source:'transfer',status:'broadcasting'}]),2500);
 assert.equal(activityRefreshInterval([{source:'transfer',status:'completed'}]),null);
 const old={hash:'temporary',transferId:'id'},fresh={hash:'final',transferId:'id'};
 assert.deepEqual(mergeByHash([fresh],[old]),[fresh]);
});
test('recovery cannot substitute the recipient, source, amount, flow or network approved by the user',()=>{
 const expected={from:'primary',to:'recipient',amount:'0.123031',kind:'pay'};
 const valid={from:'primary',to:'recipient',usdc:'0.123031',kind:'pay',network:'mainnet-beta'};
 assert.doesNotThrow(()=>assertTransferMatches(valid,expected,'mainnet-beta'));
 for(const changed of [{from:'another'},{to:'another'},{usdc:'1'},{kind:'voice'},{network:'devnet'}])
  assert.throws(()=>assertTransferMatches({...valid,...changed},expected,'mainnet-beta'),/no coincide/);
});

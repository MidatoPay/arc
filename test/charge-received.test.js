import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { paymentReceived,deliveryPhase,deliveryNoticeKey,chargeStatusLabel,canStartNewCharge } from "../src/chargeStatus.js";
import { activityStatusKey } from "../src/transactions.js";

const now=Date.parse("2026-10-16T10:00:00Z");
const base={id:"paid-charge",status:"paid",providerStatus:"processed",providerDetail:"accredited",
  paidAt:new Date(now).toISOString(),createdAt:new Date(now-14*60*1000).toISOString(),
  ars:"22.00",feeArs:"0.11",fxRate:"1617.46",usdc:"0.013533",reference:"reference",orderId:"ORDPAY",
  qrData:"original-qr",expiresAt:new Date(now+60000).toISOString(),source:"mercadopago",settled:false};

test("verified payment is received throughout USDC settlement and remains available for another charge",()=>{
  for(const status of ["paid","delivery_pending","broadcasting","confirmed","delivered","manual_review"]){
    const charge={...base,status};
    assert.equal(paymentReceived(charge),true);assert.equal(canStartNewCharge(charge),true);
    assert.equal(chargeStatusLabel(charge),"Pago recibido");
  }
  for(const status of ["creating","awaiting_payment"]){
    const unpaid={...base,status,providerStatus:"created",providerDetail:"created"};
    assert.equal(paymentReceived(unpaid),false);assert.equal(canStartNewCharge(unpaid),false);
    assert.equal(deliveryNoticeKey(unpaid,now),null);
  }
  assert.equal(paymentReceived({...base,status:"awaiting_payment"}),true);
});

test("three-minute estimate uses payment time and never changes persistent status or marks the payment as failed",()=>{
  assert.equal(deliveryPhase(base,now),"pending");
  assert.equal(deliveryNoticeKey(base,now),"chargeDeliveryEstimate");
  const before=JSON.stringify(base);
  assert.equal(deliveryPhase(base,now+179999),"pending");
  assert.equal(deliveryPhase(base,now+180000),"delayed");
  assert.equal(deliveryNoticeKey(base,now+180000),"chargeDeliveryDelayedNotice");
  assert.equal(activityStatusKey(base,now+180000),"chargePaidDelayed");
  assert.equal(chargeStatusLabel(base),"Pago recibido");
  assert.equal(JSON.stringify(base),before);
  for(const paidAt of [null,"invalid",new Date(now+30000).toISOString()])
    assert.equal(deliveryPhase({...base,paidAt},now),"pending");
});

test("review preserves received payment while refunds and unpaid reviews cannot claim receipt",()=>{
  const reviewed={...base,status:"manual_review"};
  assert.equal(deliveryPhase(reviewed,now+600000),"review");
  assert.equal(deliveryNoticeKey(reviewed,now),"chargeDeliveryReviewNotice");
  assert.equal(activityStatusKey(reviewed),"chargePaidReview");
  for(const change of [{status:"refunded"},{status:"expired"},{status:"canceled"},
    {status:"manual_review",providerStatus:"refunded"},{status:"manual_review",lastError:"mercadopago_refund_after_payout"},
    {status:"manual_review",providerStatus:null,providerDetail:null}]){
    const charge={...base,...change};
    assert.equal(paymentReceived(charge),false);assert.equal(deliveryPhase(charge,now),null);
    assert.notEqual(chargeStatusLabel(charge),"Pago recibido");
  }
});

test("confirmed is distinct from USDC credited and finalized delivery removes the wait estimate",()=>{
  const confirmed={...base,status:"confirmed"};
  assert.equal(deliveryPhase(confirmed,now),"confirmed");
  assert.equal(activityStatusKey(confirmed,now),"chargeConfirmed");
  assert.equal(confirmed.settled,false);
  assert.equal(deliveryNoticeKey(confirmed,now+180000),"chargeDeliveryDelayedNotice");
  const delivered={...base,status:"delivered",settled:true};
  assert.equal(deliveryPhase(delivered,now),"delivered");
  assert.equal(deliveryNoticeKey(delivered,now),null);
});

const compiled=await build({entryPoints:[fileURLToPath(new URL("../src/ChargeSummary.jsx",import.meta.url))],
  bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",external:["react","react/*"]});
const loaded={exports:{}};
new Function("require","module","exports",compiled.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const ChargeSummary=loaded.exports.default;
const render=charge=>renderToStaticMarkup(createElement(ChargeSummary,{charge,qr:"data:image/png;base64,qr",busy:false,now,t:key=>key}));

test("paid charge renders success, new-charge action and pending USDC without its payable QR or cancellation action",()=>{
  const html=render(base);
  assert.match(html,/Pago recibido/);assert.match(html,/Nuevo cobro/);
  assert.match(html,/USDC pendientes de acreditación/);assert.match(html,/movs.chargeDeliveryEstimate/);
  assert.doesNotMatch(html,/<img|Cancelar cobro|Vence:|USDC acreditados:/);
  const unpaid=render({...base,status:"awaiting_payment",providerStatus:"created",providerDetail:"created"});
  assert.match(unpaid,/<img/);assert.match(unpaid,/Cancelar cobro/);
  assert.doesNotMatch(unpaid,/Nuevo cobro|Pago recibido|movs.chargeDeliveryEstimate/);
});

test("delayed, reviewed and finalized screens retain the correct distinction between payment and delivery",()=>{
  const delayed=render({...base,paidAt:new Date(now-180000).toISOString()});
  assert.match(delayed,/Pago recibido/);assert.match(delayed,/movs.chargeDeliveryDelayedNotice/);
  assert.doesNotMatch(delayed,/requiere revisión/);
  const reviewed=render({...base,status:"manual_review",lastError:"solana_expired_requires_review"});
  assert.match(reviewed,/Pago recibido/);assert.match(reviewed,/movs.chargeDeliveryReviewNotice/);
  const delivered=render({...base,status:"delivered"});
  assert.match(delivered,/USDC acreditados:/);assert.match(delivered,/Nuevo cobro/);
  assert.doesNotMatch(delivered,/pendientes de acreditación|movs.chargeDeliveryEstimate|<img/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { act, create } from "react-test-renderer";
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
const render=charge=>renderToStaticMarkup(createElement(ChargeSummary,{charge,qr:"data:image/png;base64,qr",busy:false,now}));

test("received payments retain the QR and a disabled processing action until USDC delivery",()=>{
  for(const status of ["paid","delivery_pending","broadcasting","confirmed"]){
    const html=render({...base,status});
    assert.match(html,/Escanear y pagar/);
    assert.match(html,/<img[^>]+alt="QR de pago"/);
    assert.match(html,/<button[^>]+disabled=""[^>]+aria-busy="true"[^>]*>[\s\S]*?Procesando pago<\/button>/);
    assert.doesNotMatch(html,/Cancelar cobro|Cobrar de nuevo|Cobro exitoso|El dinero ya está en tu cuenta/);
  }
});

test("unpaid charges show the QR and cancellation without claiming payment success",()=>{
  const unpaid=render({...base,status:"awaiting_payment",providerStatus:"created",providerDetail:"created"});
  assert.match(unpaid,/<img[^>]+alt="QR de pago"/);assert.match(unpaid,/Cancelar cobro/);
  assert.doesNotMatch(unpaid,/Procesando pago|Cobrar de nuevo|Cobro exitoso|aria-busy="true"/);
});

test("delayed and received payments under review remain processing without claiming delivery",()=>{
  for(const charge of [
    {...base,paidAt:new Date(now-180000).toISOString()},
    {...base,status:"manual_review",lastError:"solana_expired_requires_review"},
  ]){
    const html=render(charge);
    assert.match(html,/Procesando pago/);
    assert.match(html,/<img[^>]+alt="QR de pago"/);
    assert.doesNotMatch(html,/Cobro exitoso|El dinero ya está en tu cuenta|Cobrar de nuevo|Cancelar cobro/);
  }
  const unpaidReview=render({...base,status:"manual_review",providerStatus:null,providerDetail:null});
  assert.match(unpaidReview,/En revisión/);
  assert.doesNotMatch(unpaidReview,/Procesando pago|Cobro exitoso|QR de pago/);
});

test("finalized delivery initially renders the success splash without the QR or processing action",()=>{
  // Static rendering covers the initial splash; effects and its three-second timer do not run here.
  for(const charge of [{...base,status:"delivered"},{...base,status:"confirmed",settled:true}]){
    const html=render(charge);
    assert.match(html,/class="mp-overlay"/);
    assert.match(html,/role="status" aria-label="Cobro exitoso"/);
    assert.doesNotMatch(html,/QR de pago|Procesando pago|Cancelar cobro|aria-busy="true"/);
  }
});

test("USDC delivery shows a three-second success splash, then the receipt and new-charge action",t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  let renderer,resetCalls=0;
  const splashChanges=[];
  const onSplashChange=value=>splashChanges.push(value);
  const element=charge=>createElement(ChargeSummary,{
    charge,qr:"data:image/png;base64,qr",busy:false,now,
    onReset:()=>resetCalls++,onSplashChange,
  });
  t.after(()=>{if(renderer)act(()=>renderer.unmount());});

  act(()=>{renderer=create(element(base));});
  assert.match(JSON.stringify(renderer.toJSON()),/Procesando pago/);
  assert.equal(renderer.root.findAllByProps({alt:"QR de pago"}).length,1);

  act(()=>renderer.update(element({...base,status:"delivered",settled:true})));
  assert.equal(renderer.root.findByProps({role:"status"}).props["aria-label"],"Cobro exitoso");
  assert.equal(renderer.root.findAllByType("button").length,0);
  assert.equal(renderer.root.findAllByProps({alt:"QR de pago"}).length,0);
  assert.equal(splashChanges.at(-1),true);

  act(()=>t.mock.timers.tick(2999));
  assert.equal(renderer.root.findAllByProps({role:"status"}).length,1);
  act(()=>t.mock.timers.tick(1));
  assert.equal(renderer.root.findAllByProps({role:"status"}).length,0);
  assert.equal(splashChanges.at(-1),false);
  assert.match(JSON.stringify(renderer.toJSON()),/Cobro exitoso/);
  assert.match(JSON.stringify(renderer.toJSON()),/El dinero ya está en tu cuenta/);
  assert.equal(renderer.root.findAllByProps({alt:"QR de pago"}).length,0);
  const newCharge=renderer.root.findAllByType("button").find(button=>button.children.join("")==="Cobrar de nuevo");
  assert.ok(newCharge);
  assert.equal(newCharge.props.disabled,false);
  act(()=>newCharge.props.onClick());
  assert.equal(resetCalls,1);

  act(()=>renderer.update(element({...base,id:"next-charge",status:"awaiting_payment",
    providerStatus:"created",providerDetail:"created",paidAt:null})));
  act(()=>t.mock.timers.tick(10000));
  assert.equal(renderer.root.findAllByProps({alt:"QR de pago"}).length,1);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/Cobro exitoso|Procesando pago|Cobrar de nuevo/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mergeByHash,activityStatusKey,activityRefreshInterval } from "../src/transactions.js";

test("a delivered charge replaces its cached unsigned activity without duplicating the operation",()=>{
  const cached={hash:"charge:charge-id",chargeId:"charge-id",status:"manual_review"};
  const delivered={hash:"real-signature",chargeId:"charge-id",status:"delivered"};
  assert.deepEqual(mergeByHash([delivered],[cached]),[delivered]);
});

test("Activity distinguishes an accredited payment under review from a completed USDC delivery",()=>{
  const charge={source:"mercadopago",status:"manual_review",providerStatus:"processed",providerDetail:"accredited"};
  assert.equal(activityStatusKey(charge),"chargePaidReview");
  assert.equal(activityStatusKey({...charge,providerStatus:null}),"chargeReview");
  assert.equal(activityStatusKey({...charge,status:"delivered"}),"chargeDelivered");
  assert.equal(activityStatusKey({...charge,status:"confirmed"}),"chargeConfirmed");
  assert.equal(activityStatusKey({source:"wallet"}),null);
});

test("Activity adapts polling to unpaid, active and reviewed deliveries and stops for completed charges",()=>{
  const charge={source:"mercadopago",settled:false,status:"awaiting_payment"};
  assert.equal(activityRefreshInterval([charge]),5000);
  for(const status of ["paid","delivery_pending","broadcasting","confirmed"])
    assert.equal(activityRefreshInterval([charge,{...charge,status}]),2500);
  assert.equal(activityRefreshInterval([{...charge,status:"delivered",settled:true}]),null);
  assert.equal(activityRefreshInterval([{...charge,status:"manual_review"}]),null);
  assert.equal(activityRefreshInterval([{...charge,status:"manual_review",providerStatus:"processed",providerDetail:"accredited"}]),15000);
  assert.equal(activityRefreshInterval([{source:"wallet",status:"confirmed"}]),null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mergeByHash,activityStatusKey } from "../src/transactions.js";

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
  assert.equal(activityStatusKey({source:"wallet"}),null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { isPaymentAdmin, assertPaymentAdmin, reportFilters, decodeCursor } from "../netlify/functions/lib/paymentReporting.js";
import { csvCell,csvOperation } from "../src/paymentReports.js";

test("administrative access uses a private exact allowlist, denied by default",()=>{
  assert.equal(isPaymentAdmin("did:privy:owner","did:privy:owner,did:privy:second"),true);
  assert.equal(isPaymentAdmin("did:privy:ow","did:privy:owner"),false);
  assert.equal(isPaymentAdmin("did:privy:merchant",""),false);
  const previous=process.env.PAYMENTS_ADMIN_USER_IDS;delete process.env.PAYMENTS_ADMIN_USER_IDS;
  try{assert.throws(()=>assertPaymentAdmin("did:privy:merchant"),/admin_required/);}
  finally{if(previous!==undefined)process.env.PAYMENTS_ADMIN_USER_IDS=previous;}
});
test("report dates are inclusive Argentina days with an exclusive UTC end",()=>{
  const f=reportFilters({from:"2026-10-13",to:"2026-10-13",environment:"production"});
  assert.equal(f.from,"2026-10-13T03:00:00.000Z");assert.equal(f.to,"2026-10-14T03:00:00.000Z");assert.equal(f.network,"mainnet-beta");
});
test("invalid filters, environment, cursor and excessive page size are rejected",()=>{
  for(const q of [{from:"2026-02-30"},{from:"2026-10-14",to:"2026-10-13"},{limit:"201"},{limit:"-1"},{environment:"all"},{merchant:"not-a-privy-id"},{status:"anything"},{source:"anything"}])assert.throws(()=>reportFilters(q));
  assert.throws(()=>decodeCursor("invalid"));assert.throws(()=>decodeCursor("a".repeat(1600)));
});
test("CSV protects formula cells and escapes quotes, commas and newlines",()=>{
  assert.equal(csvCell('=IMPORT("evil")'),'"\'=IMPORT(""evil"")"');
  assert.equal(csvCell(" a,b\nline"),'" a,b\nline"');
  assert.equal(csvCell(" @formula"),'"\' @formula"');
  const row=csvOperation({merchantId:"did:privy:merchant",feeArs:"50.00",feeBps:50,commissionState:"recorded"});
  assert.ok(row.includes('"50.00","0.5","recorded"'));
});

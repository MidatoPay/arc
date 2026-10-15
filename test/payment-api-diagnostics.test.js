import test from "node:test";
import assert from "node:assert/strict";
import { chargeApi } from "../src/charges.js";

test("payment API diagnostics preserve HTTP errors and Netlify request IDs without private data",async(t)=>{
  const originalFetch=globalThis.fetch,originalConsole=console.error,logs=[];
  console.error=(...args)=>logs.push(args);
  t.after(()=>{globalThis.fetch=originalFetch;console.error=originalConsole;});
  await t.test("unknown backend code remains available with the request ID",async()=>{
    globalThis.fetch=async()=>new Response(JSON.stringify({error:"unexpected_backend_failure",details:"private-db-url",stack:"private-stack"}),
      {status:503,headers:{"x-nf-request-id":"01NETLIFY123"}});
    await assert.rejects(()=>chargeApi("/charges?private-query=private-query-value","private-token",
      {method:"POST",headers:{Cookie:"private-cookie"},body:JSON.stringify({wallet:"private-wallet",ars:"private-amount"})}),error=>{
      assert.equal(error.code,"unexpected_backend_failure");assert.equal(error.status,503);assert.equal(error.requestId,"01NETLIFY123");
      assert.equal(error.diagnostic.endpoint,"/charges");assert.equal(error.diagnostic.method,"POST");return true;
    });
  });
  await t.test("HTML errors and invalid JSON never dump response content",async()=>{
    globalThis.fetch=async()=>new Response("<html>private-server-content</html>",{status:502});
    await assert.rejects(()=>chargeApi("/charges","private-token"),error=>{
      assert.equal(error.diagnostic.responseFormat,"non_json");assert.equal(error.status,502);return true;
    });
    globalThis.fetch=async()=>new Response("null",{status:503});
    await assert.rejects(()=>chargeApi("/charges","private-token"),{code:"payment_service_unavailable"});
  });
  await t.test("transport failures distinguish timeouts from network errors and discard raw error messages",async()=>{
    globalThis.fetch=async()=>{throw new DOMException("private-url","TimeoutError");};
    await assert.rejects(()=>chargeApi("/charges","private-token"),{code:"payment_request_timeout",status:0});
    globalThis.fetch=async()=>{throw new TypeError("private-network-detail");};
    await assert.rejects(()=>chargeApi("https://private-host/private-path?token=private-token","private-token"),error=>{
      assert.equal(error.code,"payment_network_error");assert.equal(error.diagnostic.endpoint,"payment_api");return true;
    });
  });
  await t.test("verbose provider errors cannot be used as console messages",async()=>{
    globalThis.fetch=async()=>new Response(JSON.stringify({error:"SQL failure: private-password"}),{status:503});
    await assert.rejects(()=>chargeApi("/charges","private-token"),{code:"payment_service_unavailable"});
  });
  await t.test("successes are unchanged and malformed successful responses are reported",async()=>{
    const before=logs.length;
    globalThis.fetch=async()=>new Response(JSON.stringify({charge:{id:"example",status:"creating"}}),{status:202});
    assert.deepEqual(await chargeApi("/charges","private-token"),{charge:{id:"example",status:"creating"}});
    assert.equal(logs.length,before);
    globalThis.fetch=async()=>new Response("<html>private-server-content</html>",{status:200});
    await assert.rejects(()=>chargeApi("/charges","private-token"),{code:"invalid_payment_response",status:200});
  });
  assert.ok(logs.length>0);assert.ok(!JSON.stringify(logs).includes("private"));
});

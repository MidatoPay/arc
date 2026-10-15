import { runPaymentPreflight } from "../netlify/functions/lib/paymentPreflight.js";
import { getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";

try {
  const userId=process.argv.find(arg=>arg.startsWith("--user-id="))?.slice(10);
  const report=await runPaymentPreflight({userId});
  console.log(JSON.stringify(report,null,2));
  if(!report.ready)process.exitCode=1;
}catch {console.error(JSON.stringify({ready:false,error:"configuration_check_failed"}));process.exitCode=1;}
finally {
  if(process.env.AIVEN_PG_URL?.trim() && process.env.AIVEN_PG_CA_CERT?.trim()) {
    try{await getPaymentDb().end();}catch{}
  }
}

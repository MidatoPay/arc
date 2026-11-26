import { getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";
import { inspectPaymentDatabase, inspectFactoringDatabase } from "../netlify/functions/lib/paymentDatabase.js";

let pool,db;
try {
  pool=getPaymentDb();db=await pool.connect();
  await db.query("BEGIN READ ONLY");
  const report=await inspectPaymentDatabase(db);
  // Factoring readiness is informative only: it never changes the payments exit code.
  report.factoring=await inspectFactoringDatabase(db);
  await db.query("ROLLBACK");
  console.log(JSON.stringify(report,null,2));
  if(!report.ready)process.exitCode=1;
} catch(error){
  if(db)await db.query("ROLLBACK").catch(()=>{});
  console.error(JSON.stringify({ready:false,error:error.code || "database_check_failed"}));process.exitCode=1;
} finally {db?.release();if(pool)await pool.end();}

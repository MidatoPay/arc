import { getPaymentDb } from "../netlify/functions/lib/paymentRuntime.js";
import { inspectPaymentDatabase } from "../netlify/functions/lib/paymentDatabase.js";

let pool,db;
try {
  pool=getPaymentDb();db=await pool.connect();
  await db.query("BEGIN READ ONLY");
  const report=await inspectPaymentDatabase(db);
  await db.query("ROLLBACK");
  console.log(JSON.stringify(report,null,2));
  if(!report.ready)process.exitCode=1;
} catch(error){
  if(db)await db.query("ROLLBACK").catch(()=>{});
  console.error(JSON.stringify({ready:false,error:error.code || "database_check_failed"}));process.exitCode=1;
} finally {db?.release();if(pool)await pool.end();}

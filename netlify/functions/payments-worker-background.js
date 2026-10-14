import { internalAuthorized } from "./lib/paymentRuntime.js";
import { runPaymentWorker } from "./lib/paymentWorker.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST" || !internalAuthorized(event)) return { statusCode:401, body:"unauthorized" };
  await runPaymentWorker();
  return { statusCode:200, body:"ok" };
};

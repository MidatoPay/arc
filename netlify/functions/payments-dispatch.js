import { kickWorker } from "./lib/paymentRuntime.js";
export const handler = async () => {
  await kickWorker();
  return { statusCode:200, body:"dispatched" };
};

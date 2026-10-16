import {kickWorker} from './lib/paymentRuntime.js';
export const handler=async()=>{
 const result=await kickWorker({functionName:'transfers-worker-background'});
 return {statusCode:result.accepted?200:503,body:JSON.stringify(result)};
};

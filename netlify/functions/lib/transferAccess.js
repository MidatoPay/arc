import {PaymentError} from './paymentCore.js';

// This list is server configuration, never a client-controlled address or role.
export function transfersEnabledFor(userId,env=process.env) {
 if(env.TRANSFERS_ENABLED==='true')return true;
 if(typeof userId!=='string' || !userId)return false;
 return (env.TRANSFERS_ALLOWED_USER_IDS || '').split(/[\s,]+/).filter(Boolean).includes(userId);
}
export function assertTransfersEnabled(userId,env=process.env) {
 if(!transfersEnabledFor(userId,env))throw new PaymentError('transfers_disabled',503);
}

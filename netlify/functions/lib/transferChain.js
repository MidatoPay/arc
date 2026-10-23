// Arc transaction building and verification for user USDC transfers.
// The user's Privy wallet signs and pays its own gas in USDC; the server only
// prepares, verifies, stores and broadcasts the exact signed transaction.
import {Transaction} from 'ethers';
import {NETWORK} from '../../../src/network.js';
import {feeFields,gasLimitWithMargin,memoTransferData,normalizeAddress,sameAddress} from '../../../src/arc.js';
import {PaymentError} from './paymentCore.js';
import {ArcRpcRejected,assertArcNetwork,createArcRpc} from './arcRpc.js';

export const transferRpc=createArcRpc({unavailable:'transfer_rpc_unavailable',timeout:'transfer_rpc_unavailable',rejected:'transfer_rpc_rejected'});

/** Native USDC balance of an account, in wei (18 decimals). */
export async function sourceBalance(owner,rpc=transferRpc,network=NETWORK) {
 await assertArcNetwork(rpc,network);
 return BigInt(await rpc('eth_getBalance',[normalizeAddress(owner),'latest']));
}

/** Contract recipients are rejected; plain EOAs and EIP-7702 delegated EOAs are accepted. */
async function assertWalletRecipient(rpc,to) {
 const code=String(await rpc('eth_getCode',[to,'latest']) || '0x').toLowerCase();
 if(code!=='0x' && !code.startsWith('0xef0100'))throw new PaymentError('recipient_not_wallet',400);
}

/**
 * Builds the unsigned EIP-1559 transaction the user's wallet will sign:
 * Memo.memo(USDC, transfer(to, raw), keccak256(reference), memo).
 */
export async function prepareTransfer({from,to,raw,memo,reference},adapters={}) {
 const rpc=adapters.rpc || transferRpc,network=adapters.network || NETWORK;
 const sender=normalizeAddress(from),recipient=normalizeAddress(to);
 await assertArcNetwork(rpc,network);
 await assertWalletRecipient(rpc,recipient);
 const data=memoTransferData({to:recipient,raw,memo,reference,network});
 let gasEstimate;
 try {gasEstimate=await rpc('eth_estimateGas',[{from:sender,to:network.memo,data}]);}
 catch(error){if(error instanceof ArcRpcRejected)throw new PaymentError('transfer_simulation_failed',409);throw error;}
 const [gasPrice,nonce]=await Promise.all([rpc('eth_gasPrice',[]),rpc('eth_getTransactionCount',[sender,'pending'])]);
 const gasLimit=gasLimitWithMargin(gasEstimate),fees=feeFields({gasPrice,network});
 const tx=Transaction.from({type:2,chainId:network.chainId,to:network.memo,data,value:0n,nonce:Number(BigInt(nonce)),gasLimit,...fees});
 return {unsigned_tx:tx.unsignedSerialized,nonce:String(BigInt(nonce)),max_gas_wei:String(gasLimit*fees.maxFeePerGas),
  request:{from:sender,to:network.memo,data,value:'0x0',nonce:Number(BigInt(nonce)),chainId:network.chainId,type:2,
   gasLimit:`0x${gasLimit.toString(16)}`,maxFeePerGas:`0x${fees.maxFeePerGas.toString(16)}`,
   maxPriorityFeePerGas:`0x${fees.maxPriorityFeePerGas.toString(16)}`}};
}

/** Rebuilds the wallet request from a stored unsigned transaction. */
export function signingRequest(t) {
 const tx=Transaction.from(t.unsigned_tx);
 return {from:t.from_address,to:tx.to,data:tx.data,value:'0x0',nonce:tx.nonce,chainId:Number(tx.chainId),type:2,
  gasLimit:`0x${tx.gasLimit.toString(16)}`,maxFeePerGas:`0x${tx.maxFeePerGas.toString(16)}`,
  maxPriorityFeePerGas:`0x${tx.maxPriorityFeePerGas.toString(16)}`};
}

/** The signed transaction must be exactly the prepared one, signed by the transfer's sender. */
export function validateUserSignature(prepared,signedTx,network=NETWORK) {
 if(typeof signedTx!=='string' || signedTx.length>20000 || !/^0x[0-9a-fA-F]+$/.test(signedTx))throw new PaymentError('invalid_signed_transaction',400);
 let tx;
 try {tx=Transaction.from(signedTx);}catch{throw new PaymentError('invalid_signed_transaction',400);}
 if(!tx.signature || !tx.from)throw new PaymentError('invalid_signed_transaction',400);
 if(tx.unsignedSerialized!==prepared.unsigned_tx || BigInt(tx.chainId)!==BigInt(network.chainId))throw new PaymentError('transfer_message_changed',400);
 if(!sameAddress(tx.from,prepared.from_address))throw new PaymentError('invalid_user_signature',403);
 return {hash:tx.hash,signed_tx:tx.serialized,request:{from:tx.from,to:tx.to,data:tx.data}};
}

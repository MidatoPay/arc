import {
 address,createNoopSigner,createTransactionMessage,setTransactionMessageFeePayer,
 setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,
 getTransactionEncoder,getTransactionDecoder,getBase64EncodedWireTransaction,getSignatureFromTransaction,
 getPublicKeyFromAddress,verifySignature,partiallySignTransaction,
} from '@solana/kit';
import {TOKEN_PROGRAM_ADDRESS,findAssociatedTokenPda,getCreateAssociatedTokenIdempotentInstruction,getTransferCheckedInstruction} from '@solana-program/token';
import {getAddMemoInstruction} from '@solana-program/memo';
import {NETWORK} from '../../../src/network.js';
import {PaymentError} from './paymentCore.js';
import {getTreasurySigner} from './treasuryPayout.js';

export async function transferRpc(method,params) {
 try {
  const response=await fetch(process.env.SOLANA_RPC || NETWORK.rpc,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  const body=await response.json();
  if(!response.ok || body.error || !Object.hasOwn(body,'result'))throw new PaymentError('transfer_rpc_unavailable');
  return body.result;
 }catch(error){if(error instanceof PaymentError)throw error;throw new PaymentError('transfer_rpc_unavailable');}
}
export async function tokenAddress(owner,network=NETWORK) {
 return String((await findAssociatedTokenPda({owner:address(owner),mint:address(network.mint),tokenProgram:TOKEN_PROGRAM_ADDRESS}))[0]);
}
export async function sourceBalance(owner,rpc=transferRpc,network=NETWORK) {
 if(await rpc('getGenesisHash',[])!==network.genesis)throw new PaymentError('solana_rpc_network_mismatch');
 const ata=await tokenAddress(owner,network);
 const account=(await rpc('getAccountInfo',[ata,{encoding:'jsonParsed',commitment:'finalized'}])).value;
 if(!account)return 0n;
 const info=account.data?.parsed?.info;
 if(account.owner!==TOKEN_PROGRAM_ADDRESS || info?.owner!==owner || info?.mint!==network.mint ||
   info?.tokenAmount?.decimals!==6 || info?.state!=='initialized')throw new PaymentError('invalid_usdc_account',409);
 return BigInt(info.tokenAmount.amount);
}
export async function prepareTransfer({from,to,raw,memo},adapters={}) {
 const rpc=adapters.rpc || transferRpc,network=adapters.network || NETWORK;
 const signer=await (adapters.signer || getTreasurySigner)();
 const user=createNoopSigner(address(from)),payer=createNoopSigner(signer.address);
 const [source,destination]=await Promise.all([tokenAddress(from,network),tokenAddress(to,network)]);
 const target=(await rpc('getAccountInfo',[to,{encoding:'jsonParsed',commitment:'confirmed'}])).value;
 if(target && target.owner!== '11111111111111111111111111111111')throw new PaymentError('recipient_not_wallet',400);
 const latest=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value;
 let message=createTransactionMessage({version:0});
 message=setTransactionMessageFeePayer(signer.address,message);
 message=setTransactionMessageLifetimeUsingBlockhash({blockhash:latest.blockhash,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight)},message);
 message=appendTransactionMessageInstructions([
  getCreateAssociatedTokenIdempotentInstruction({payer,ata:address(destination),owner:address(to),mint:address(network.mint),tokenProgram:TOKEN_PROGRAM_ADDRESS}),
  getTransferCheckedInstruction({source:address(source),mint:address(network.mint),destination:address(destination),authority:user,amount:BigInt(raw),decimals:6}),
  getAddMemoInstruction({memo,signers:[user]}),
 ],message);
 const tx=compileTransaction(message);
 const fee=(await rpc('getFeeForMessage',[Buffer.from(tx.messageBytes).toString('base64'),{commitment:'confirmed'}])).value;
 if(fee===null)throw new PaymentError('transfer_blockhash_expired',409);
 // Reserve worst-case rent, even when the ATA exists: it can be closed before broadcast.
 const rent=await rpc('getMinimumBalanceForRentExemption',[165,{commitment:'confirmed'}]);
 return {unsigned_wire:Buffer.from(getTransactionEncoder().encode(tx)).toString('base64'),
  last_valid_block_height:String(latest.lastValidBlockHeight),fee_payer:String(signer.address),cost_lamports:String(BigInt(fee)+BigInt(rent))};
}

export async function validateUserSignature(prepared,wire) {
 if(typeof wire!=='string' || wire.length>1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(wire))throw new PaymentError('invalid_signed_transaction',400);
 let tx,original;
 try {tx=getTransactionDecoder().decode(Buffer.from(wire,'base64'));original=getTransactionDecoder().decode(Buffer.from(prepared.unsigned_wire,'base64'));}
 catch {throw new PaymentError('invalid_signed_transaction',400);}
 if(!Buffer.from(tx.messageBytes).equals(Buffer.from(original.messageBytes)) ||
   Object.keys(tx.signatures).sort().join(',')!==Object.keys(original.signatures).sort().join(','))throw new PaymentError('transfer_message_changed',400);
 const signature=tx.signatures[prepared.from_address];
 if(!signature || !(await verifySignature(await getPublicKeyFromAddress(address(prepared.from_address)),signature,tx.messageBytes)))
  throw new PaymentError('invalid_user_signature',403);
 return tx;
}
export async function signSponsoredTransfer(prepared,tx,adapters={}) {
 const signer=await (adapters.signer || getTreasurySigner)();
 if(signer.address!==prepared.fee_payer)throw new PaymentError('transfer_treasury_changed',409);
 const signed=await partiallySignTransaction([signer.keyPair],tx);
 return {signature:String(getSignatureFromTransaction(signed)),signed_wire:getBase64EncodedWireTransaction(signed)};
}

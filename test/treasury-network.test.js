import test from "node:test";
import assert from "node:assert/strict";
import { Transaction, Wallet, keccak256, toUtf8Bytes, toUtf8String } from "ethers";
import { NETWORK, networkConfig } from "../src/network.js";
import { ERC20, MEMO } from "../src/arc.js";
import { treasuryLiquidity, prepareTreasuryPayout, sendTreasuryPayout, TREASURY_GAS_RESERVE_WEI } from "../netlify/functions/lib/treasuryPayout.js";
import { hex } from "../netlify/functions/lib/arcRpc.js";

const owner="0x8ba1f109551bD432803012645Ac136ddd64DBA72";

test("Arc Mainnet configuration is the only network and uses native USDC through its ERC-20 interface",()=>{
  const network=networkConfig("mainnet");
  assert.equal(network.network,"arc-mainnet");assert.equal(network.chainId,5042);assert.equal(network.testnet,false);
  assert.equal(network.usdc,"0x3600000000000000000000000000000000000000");assert.equal(network.usdcDecimals,6);assert.equal(network.nativeDecimals,18);
  assert.throws(()=>networkConfig("devnet"),/invalid_arc_network/);
  assert.throws(()=>networkConfig("testnet"),/invalid_arc_network/);
});

test("treasury liquidity keeps a gas reserve and rejects an RPC serving another chain",async()=>{
  const rpc=balance=>async method=>method==="eth_chainId"?hex(NETWORK.chainId):method==="eth_getBalance"?hex(balance):assert.fail(method);
  const adapters=balance=>({rpc:rpc(balance),getTreasuryAddress:async()=>owner});
  const funded=await treasuryLiquidity(adapters(TREASURY_GAS_RESERVE_WEI+10n**18n+999_999_999_999n));
  // Wei below one USDC unit (1e12) cannot be moved through the ERC-20 interface.
  assert.deepEqual(funded,{owner,raw:"1000000",nativeWei:String(TREASURY_GAS_RESERVE_WEI+10n**18n+999_999_999_999n)});
  assert.equal((await treasuryLiquidity(adapters(TREASURY_GAS_RESERVE_WEI))).raw,"0");
  assert.equal((await treasuryLiquidity(adapters(1n))).raw,"0");
  for(const wrong of ["0x1","0x4cef52","0x13b1"])
    await assert.rejects(()=>treasuryLiquidity({...adapters(10n**18n),rpc:async method=>method==="eth_chainId"?wrong:assert.fail(method)}),{code:"arc_rpc_network_mismatch"});
});

test("payout preparation signs one memo-wrapped transfer with the assigned nonce and never transmits it",async()=>{
  const signer=Wallet.createRandom(),to="0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",methods=[];
  const rpc=async(method)=>{methods.push(method);
    if(method==="eth_chainId")return hex(NETWORK.chainId);
    if(method==="eth_estimateGas")return "0x15f90";
    if(method==="eth_gasPrice")return hex(20_000_000_000n);
    assert.fail(`unexpected RPC: ${method}`);
  };
  const prepared=await prepareTreasuryPayout({to,rawAmount:"6030303",kind:"charge_mercadopago",ars:"10000.00",fxRate:"1650",factura:"ref-1",nonce:7n},
    {rpc,signer:async()=>signer});
  const tx=Transaction.from(prepared.signedTx);
  assert.equal(tx.from,signer.address);assert.equal(tx.hash,prepared.hash);assert.equal(tx.nonce,7);assert.equal(prepared.nonce,"7");
  assert.equal(tx.chainId,5042n);assert.equal(tx.to,NETWORK.memo);assert.equal(tx.value,0n);assert.equal(tx.maxFeePerGas,40_000_000_000n);
  const [target,inner,memoId,memoData]=MEMO.decodeFunctionData("memo",tx.data);
  assert.equal(target,NETWORK.usdc);assert.equal(memoId,keccak256(toUtf8Bytes("ref-1")));
  assert.equal(toUtf8String(memoData),prepared.memo);assert.match(prepared.memo,/^MIDATO\|v1\|inv:ref-1\|kind:charge_mercadopago\|cur:ARS\|amt:10000.00\|fx:1650.00\|usdc:6.030303$/);
  assert.deepEqual([...ERC20.decodeFunctionData("transfer",inner)],[to,6030303n]);
  assert.ok(!methods.includes("eth_sendRawTransaction"));assert.ok(!methods.includes("eth_getTransactionCount"));
  await assert.rejects(()=>prepareTreasuryPayout({to:"not-an-address",rawAmount:"1",nonce:0n},{rpc,signer:async()=>signer}),{code:"invalid_wallet"});
  await assert.rejects(()=>sendTreasuryPayout({to,rawAmount:"1",nonce:0n},{rpc,signer:async()=>signer}),/direct_treasury_payout_disabled/);
});

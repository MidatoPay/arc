import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, toBeHex, toUtf8Bytes, keccak256, zeroPadValue } from "ethers";
import { NETWORK } from "../src/network.js";
import { ERC20, MEMO, TRANSFER_TOPIC, isAddress, normalizeAddress, sameAddress, usdcToRaw, weiToUsdc, weiToUsdcRaw,
  feeFields, gasLimitWithMargin, memoTransferData, memoFromLogs, usdcTransfers, armarMemo } from "../src/arc.js";
import { parseScanTarget } from "../src/scanTarget.js";
import { reconcileWallet, MAX_LOG_RANGE } from "../netlify/functions/lib/reconcile.js";

const me="0x8ba1f109551bD432803012645Ac136ddd64DBA72",peer="0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const topic=address=>zeroPadValue(address.toLowerCase(),32);

test("addresses are EVM addresses with a valid checksum, never the zero address or another chain's format",()=>{
  assert.equal(isAddress(me),true);assert.equal(isAddress(me.toLowerCase()),true);
  assert.equal(isAddress("0x8ba1f109551bD432803012645Ac136ddd64DBA73"),false,"bad checksum");
  for(const value of ["0x0000000000000000000000000000000000000000","25uPNxXCXSDRAct1tFGFBtEWQr3xUL9pdEmBzWSXwHGd","0x123",null,undefined,42])
    assert.equal(isAddress(value),false,String(value));
  assert.equal(normalizeAddress(me.toLowerCase()),me);assert.throws(()=>normalizeAddress("bad"),/invalid_address/);
  assert.equal(sameAddress(me,me.toLowerCase()),true);assert.equal(sameAddress(me,peer),false);assert.equal(sameAddress("x","x"),false);
});

test("USDC units: 6 decimals on the ERC-20 interface, 18 decimals for native balances and gas",()=>{
  assert.equal(usdcToRaw("0.123031"),123031n);assert.throws(()=>usdcToRaw("0"));
  assert.equal(weiToUsdc(1_500_000_000_000_000_000n),"1.5");assert.equal(weiToUsdc(1n),"0.000000000000000001");
  // Dust below one ERC-20 unit cannot be moved, so spendable balances truncate.
  assert.equal(weiToUsdcRaw(1_000_000_999_999_999_999n),1_000_000n);
});

test("fees respect Arc's 20 gwei floor and gas limits include a safety margin",()=>{
  assert.deepEqual(feeFields({gasPrice:"0x1"}),{maxFeePerGas:20_000_000_000n,maxPriorityFeePerGas:0n});
  assert.equal(feeFields({gasPrice:30_000_000_000n}).maxFeePerGas,60_000_000_000n);
  assert.equal(feeFields({gasPrice:30_000_000_000n,priorityFee:10n**12n}).maxPriorityFeePerGas,60_000_000_000n);
  assert.equal(gasLimitWithMargin("0x15f90"),113_000n);
});

test("memo-wrapped USDC transfers encode the target, amount, reference and MIDATO memo, and receipts decode them back",()=>{
  const memo=armarMemo({inv:"f-1",kind:"pay",usdc:"1.000000",empty:""});
  assert.equal(memo,"MIDATO|v1|inv:f-1|kind:pay|usdc:1.000000");
  const data=memoTransferData({to:peer,raw:1_000_000n,memo,reference:"f-1"});
  const [target,inner,memoId]=MEMO.decodeFunctionData("memo",data);
  assert.equal(target,NETWORK.usdc);assert.equal(memoId,keccak256(toUtf8Bytes("f-1")));
  assert.deepEqual([...ERC20.decodeFunctionData("transfer",inner)],[peer,1_000_000n]);
  const memoLog={address:NETWORK.memo,...MEMO.encodeEventLog(MEMO.getEvent("Memo"),[me,NETWORK.usdc,keccak256(inner),memoId,toUtf8Bytes(memo),0n])};
  const transferLog={address:NETWORK.usdc,...ERC20.encodeEventLog(ERC20.getEvent("Transfer"),[me,peer,1_000_000n])};
  const foreign={...transferLog,address:peer};
  assert.equal(memoFromLogs([transferLog,memoLog]),memo);assert.equal(memoFromLogs([{...memoLog,address:peer}]),null);
  assert.deepEqual(usdcTransfers([foreign,memoLog,transferLog]),[{from:me,to:peer,value:1_000_000n}]);
});

test("the scanner accepts Arc addresses and EIP-681 USDC requests and explains everything else",()=>{
  const usdc=NETWORK.usdc;
  assert.deepEqual(parseScanTarget(` ${peer}\n`),{kind:"pay",addr:peer,name:"",usdc:null,ars:null,factura:""});
  assert.equal(parseScanTarget(`ethereum:${usdc}@5042/transfer?address=${peer}&uint256=1500000`).usdc,"1.500000");
  assert.equal(parseScanTarget(`ethereum:${usdc}/transfer?address=${peer}`).usdc,null);
  assert.equal(parseScanTarget(`ethereum:${peer}@5042`).addr,peer);
  const cases={
    [`ethereum:${usdc}@1/transfer?address=${peer}&uint256=1`]:"other_network",
    [`ethereum:${peer}?value=1e18`]:"native_request",
    [`ethereum:${usdc}@5042/approve?address=${peer}&uint256=1`]:"transaction_request",
    [`ethereum:${peer}@5042/transfer?address=${me}&uint256=1`]:"other_token",
    [`ethereum:${usdc}@5042/transfer?address=${peer}&uint256=0`]:"invalid_amount",
    [`ethereum:${usdc}@5042/transfer?address=${peer}&uint256=1.5`]:"invalid_amount",
    [`ethereum:${usdc}@5042/transfer?address=bad`]:"invalid",
    "solana:25uPNxXCXSDRAct1tFGFBtEWQr3xUL9pdEmBzWSXwHGd?amount=1":"invalid",
    "":"empty",
  };
  for(const [text,error] of Object.entries(cases))assert.deepEqual(parseScanTarget(text),{error},text);
  assert.deepEqual(parseScanTarget(peer,{self:peer.toLowerCase()}),{error:"self"});
});

test("reconciliation reads only the system emitter, skips worker-owned movements and records memo metadata once",async()=>{
  const signer=Wallet.createRandom(),hashes={in:`0x${"a1".repeat(32)}`,out:`0x${"b2".repeat(32)}`,job:`0x${"c3".repeat(32)}`};
  const systemLog=(hash,from,to,wei,block)=>({address:NETWORK.systemEmitter,topics:[TRANSFER_TOPIC,topic(from),topic(to)],
    data:zeroPadValue(toBeHex(wei),32),blockNumber:toBeHex(block),transactionHash:hash,removed:false});
  const memo="MIDATO|v1|inv:f-9|kind:pay|cur:ARS|amt:3000|usdc:2.000000";
  const memoLog={address:NETWORK.memo,...MEMO.encodeEventLog(MEMO.getEvent("Memo"),[peer,NETWORK.usdc,`0x${"00".repeat(32)}`,`0x${"11".repeat(32)}`,toUtf8Bytes(memo),0n])};
  const filters=[],inserts=[];
  const rpc=async(method,params)=>{
    if(method==="eth_blockNumber")return "0x64";
    if(method==="eth_getLogs"){
      const [filter]=params;filters.push(filter);
      return filter.topics[2]===topic(me)
        ?[systemLog(hashes.in,peer,me,2n*10n**18n,95),systemLog(hashes.job,peer,me,1n,96)]
        :[systemLog(hashes.out,me,signer.address,5n*10n**17n,97)];
    }
    if(method==="eth_getTransactionReceipt")return {status:"0x1",gasUsed:"0x15f90",effectiveGasPrice:toBeHex(20_000_000_000n),
      logs:params[0]===hashes.in?[memoLog]:[]};
    if(method==="eth_getBlockByNumber")return {timestamp:"0x6560f000"};
    assert.fail(`unexpected RPC: ${method}`);
  };
  const db={query:async(sql,params)=>{
    if(sql.startsWith("SELECT id FROM wallet_transfers"))return {rowCount:params[0]===hashes.job?1:0,rows:[]};
    if(sql.includes("INSERT INTO transactions")){inserts.push(params);return {rowCount:1,rows:[]};}
    return {rowCount:0,rows:[]};
  }};
  const synced=await reconcileWallet(db,{userId:"u1",address:me,lastSyncedBlock:90,getFxRate:async()=>1500},{rpc});
  assert.equal(synced,"100");
  assert.ok(filters.every(filter=>filter.address===NETWORK.systemEmitter && filter.fromBlock==="0x5b" && filter.toBlock==="0x64"));
  assert.equal(inserts.length,2);
  const [incoming,outgoing]=inserts;
  assert.deepEqual([incoming[1],incoming[2],incoming[4],incoming[6],incoming[7],incoming[9],incoming[12]],[hashes.in,"pay","2.0",3000,"f-9",memo,"in"]);
  assert.equal(incoming[13],null,"the receiver does not pay the fee");
  assert.deepEqual([outgoing[1],outgoing[2],outgoing[4],outgoing[6],outgoing[12],outgoing[13]],[hashes.out,"received","0.5",750,"out","0.0018"]);
  assert.ok(inserts.every(params=>params[11]==="arc-mainnet"));
});

test("reconciliation bounds each eth_getLogs range and resumes long gaps across runs",async()=>{
  const filters=[];
  const rpc=async(method,params)=>{if(method==="eth_blockNumber")return toBeHex(100_000);filters.push(params[0]);return [];};
  const synced=await reconcileWallet({query:async()=>({rowCount:0,rows:[]})},{userId:"u1",address:me,lastSyncedBlock:0,getFxRate:async()=>1},{rpc});
  assert.equal(filters.length,12);
  assert.ok(filters.every(filter=>BigInt(filter.toBlock)-BigInt(filter.fromBlock)+1n<=MAX_LOG_RANGE));
  assert.equal(synced,String(6n*MAX_LOG_RANGE));
  const fresh=[];
  await reconcileWallet({query:async()=>({rowCount:0,rows:[]})},{userId:"u1",address:me,lastSyncedBlock:null,getFxRate:async()=>1},
    {rpc:async(method,params)=>{if(method==="eth_blockNumber")return toBeHex(50_000);fresh.push(params[0]);return [];}});
  assert.equal(fresh[0].fromBlock,toBeHex(50_000n-MAX_LOG_RANGE));
});

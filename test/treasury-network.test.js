import test from "node:test";
import assert from "node:assert/strict";
import { networkConfig } from "../src/network.js";
import { treasuryLiquidity } from "../netlify/functions/lib/treasuryPayout.js";

test("treasury accepts the complete genesis hashes returned by actual Solana clusters",async()=>{
  const hashes={devnet:"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG","mainnet-beta":"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"};
  for(const cluster of Object.keys(hashes)){
    const network=networkConfig(cluster);assert.equal(network.genesis,hashes[cluster]);
    const rpc=async method=>method==="getGenesisHash"?hashes[cluster]:method==="getBalance"?{value:20000000}:{value:[]};
    const adapters={network,rpc,getTreasuryAddress:async()=>"11111111111111111111111111111111"};
    const result=await treasuryLiquidity(adapters);assert.equal(result.raw,"0");assert.equal(result.solLamports,"20000000");
    for(const wrong of [hashes[cluster].slice(0,32),"wrong",hashes[cluster==="devnet"?"mainnet-beta":"devnet"]])
      await assert.rejects(()=>treasuryLiquidity({...adapters,rpc:async method=>method==="getGenesisHash"?wrong:rpc(method)}),{code:"solana_rpc_network_mismatch"});
  }
});

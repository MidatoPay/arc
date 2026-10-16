import test from "node:test";
import assert from "node:assert/strict";
import { openTreasuryWalletExport, treasuryExportWallets } from "../src/treasuryWalletExport.js";

const treasury = "F7dfgm1WjNRGc7g8WMjqBgiNFwLTwXTcwBVQ8wLzKJLs";
const other = "FmucTWqgc31CoxjtBKhqqZizQfUEYtPE5S93jnAJt5Gx";
const embedded = address => ({ type: "wallet", walletClientType: "privy", chainType: "solana", hdWalletIndex:0, address });
const user = { id: "did:privy:treasury-owner", linkedAccounts: [embedded(treasury)] };

test("treasury key export rejects another owner's wallet, external wallets and unauthenticated sessions before invoking Privy", async () => {
  let calls = 0;
  const options = { ready: true, authenticated: true, user, address: treasury, exportWallet: async () => { calls++; } };
  for (const change of [
    { ready: false }, { authenticated: false }, { user: null }, { address: other },
    { user: { id: "different-user", linkedAccounts: [embedded(other)] } },
    { user: { ...user, linkedAccounts: [{ ...embedded(treasury), walletClientType: "phantom" }] } },
    { user: { ...user, linkedAccounts: [{ ...embedded(treasury), chainType: "ethereum" }] } },
  ]) await assert.rejects(() => openTreasuryWalletExport({ ...options, ...change }), /wallet_export_not_owned/);
  assert.equal(calls, 0);
});

test("treasury export selects the exact owned Solana address and never returns SDK export data", async () => {
  const owner = { ...user, linkedAccounts: [{...embedded(other),hdWalletIndex:1}, embedded(treasury), embedded(treasury), embedded("invalid")] };
  assert.deepEqual(treasuryExportWallets(owner), [other, treasury]);
  const calls = [];
  const result = await openTreasuryWalletExport({ ready: true, authenticated: true, user: owner, address: treasury,
    authorize:async()=>({authorized:true,address:treasury}),
    exportWallet: async options => { calls.push(options); return "private-sentinel"; } });
  assert.deepEqual(calls, [{ address: treasury }]);
  assert.equal(result, undefined);
});

test('export requires fresh server authorization, the configured address and primary ownership',async()=>{
 for(const access of [{authorized:false,address:null},{authorized:true,address:other}])
  await assert.rejects(()=>openTreasuryWalletExport({ready:true,authenticated:true,user,address:treasury,
   authorize:async()=>access,exportWallet:()=>assert.fail('Must not export')}),/forbidden/);
});

// Writes the public addresses the apps and docs read. No keys, by construction: only named fields are copied.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT, key, readState } from "./lib/env";

const s = readState();
const out = {
  network: "frames-devnet",
  chainId: 1337,
  mempool: "https://altmempool.forshtat.com/rpc",
  gateway: "https://altmempoolgateway.forshtat.com/rpc",
  node: "https://altmempool.forshtat.com",
  explorer: "https://explorer.altmempool.wtf/",
  stakingRegistry: "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
  expiryVerifier: "0x0000000000000000000000000000000000008141",
  frameReader: s.frameReader,
  statelessRenderer: s.statelessRenderer,
  revocations: s.revocations,
  trustAdmin: s.trustAdmin,
  account: s.account,
  emptyDepositAccount: s.account2,
  paymaster: s.paymaster,
  accountCodehash: s.accountCodehash,
  deployTxs: s.deployTxs,
  stakeTx: s.staked,
  refreshTrustTx: s.refreshTx,
  tokens: { dUSDC: s.tokenA, dWETH: s.tokenB },
  evilVault: s.evilVault,
  skimHook: s.skimHook,
  gasBurner: s.gasBurner,
  returnBomb: s.returnBomb,
  reenterer: s.reenterer,
  pools: { honest: s.poolEthHonest, evil: s.poolEthEvil, erc20Honest: s.poolHonest, erc20Evil: s.poolEvil },
  uniswap: {
    router: "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    poolManager: "0x6bF9Aa9c04fd001385742d61f6818C3236429848",
    positionManager: "0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B",
    weth9: "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6",
  },
  owners: ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map((k) => privateKeyToAccount(key(k)).address),
  threshold: 2,
};
writeFileSync(resolve(ROOT, "contracts/deployments/devnet.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote contracts/deployments/devnet.json");

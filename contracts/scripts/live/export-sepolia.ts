// Writes contracts/deployments/sepolia.json from contracts/.state/sepolia.json, so the site and the apps read what was deployed. No transactions.
// The quoter is Uniswap's official Sepolia v4 Quoter (Uniswap/docs, v4 deployments), for quotes against the demo pools.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./lib/env";
import { ENTRY_POINT, UNI, WETH_SEPOLIA, readS } from "./lib/sepolia";

const st = readS();
const out = {
  network: "sepolia",
  chainId: 11155111,
  entryPoint: ENTRY_POINT,
  account: st.account4337,
  statelessRenderer: st.statelessRenderer,
  revocations: st.revocations,
  ensTrustChecker: st.checker,
  ensTrustAnchor: st.anchor,
  skimHook: st.skimHook,
  tokens: { dUSDC: st.tokenA, dWETH: st.tokenB },
  pools: { eth: st.poolEth, erc20: st.pool, ...(st.poolEthEvil ? { ethEvil: st.poolEthEvil } : {}) },
  uniswap: { router: UNI.router, poolManager: UNI.poolManager, positionManager: UNI.positionManager, permit2: UNI.permit2, weth9: WETH_SEPOLIA, quoter: "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227", routerLegacyParams: true },
  ens: {
    publisher: "verbatim-demo.eth",
    publisherResolver: st["verbatim-demo"].resolver,
    recipient: st["verbatim-demo"].nameAddress,
    anchor: "verbatim-anchor.eth",
    anchorResolver: st["verbatim-anchor"].resolver,
    attestorsRecordTx: st.attestorsRecord,
    lookalike: "verbatim-dem0.eth",
  },
};
writeFileSync(resolve(ROOT, "contracts/deployments/sepolia.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote contracts/deployments/sepolia.json");

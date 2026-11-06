// A devnet snapshot lasts six hours. This renews it without redeploying anything: the attestors re-sign the published root, unchanged,
// with fresh timestamps; the paymaster stores that through an empty `refreshTrust` (same root, no descriptors, next epoch); and the
// published file is rewritten to match. It attests nothing new. Pending paymaster-path transactions signed under the old
// timestamps are invalidated, which is the cost the invalidation bench measures. Usage: tsx refresh-devnet.ts [--force]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { emptyUpdate } from "@verbatim/attestor-cli";
import { snapshotTypedData, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { ROOT, key } from "./lib/env";
import { pub } from "./lib/chain";
import { attest } from "./lib/trust-update";
import { state } from "./lib/verbatim";

const s = state();
const STORE = parseAbi(["function trustEpoch() view returns (uint64)", "function snapshot() view returns (bytes32 root, uint64 issuedAt, uint64 expiry)"]);
const file = resolve(ROOT, "contracts/deployments/snapshot-devnet.json");
const snap: PublishedSnapshot = JSON.parse(readFileSync(file, "utf8"));

const [epoch, [root, , expiry]] = await Promise.all([
  pub.readContract({ address: s.paymaster, abi: STORE, functionName: "trustEpoch" }),
  pub.readContract({ address: s.paymaster, abi: STORE, functionName: "snapshot" }),
]);
const block = await pub.getBlock();
const left = Number(expiry) - Number(block.timestamp);
console.log(`on chain: epoch ${epoch}, root ${root.slice(0, 14)}…, ${left > 0 ? `${Math.floor(left / 60)} min left` : `expired ${Math.floor(-left / 60)} min ago`}`);
if (root.toLowerCase() !== snap.root.toLowerCase()) throw new Error("the published snapshot is not the one on chain: refusing to guess; run fresh-deploy.sh");
if (left > 3600 && !process.argv.includes("--force")) {
  console.log("more than an hour left: nothing to do (pass --force to renew anyway)");
  process.exit(0);
}

const issuedAt = block.timestamp - 60n;
const u = emptyUpdate(epoch + 1n, snap.root as Hex, issuedAt);
const r = await attest(s.paymaster, u);
console.log(`refreshTrust ${r.transactionHash} (epoch ${u.epoch}), good until ${new Date(Number(u.expiry) * 1000).toISOString().slice(11, 16)} UTC`);

const listed = new Set(snap.attestors.map((a) => a.toLowerCase()));
const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => privateKeyToAccount(key(k))).filter((a) => listed.has(a.address.toLowerCase())).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)).slice(0, 2);
const typed = snapshotTypedData(BigInt(snap.chainId), snap.root as Hex, u.issuedAt, u.expiry, snap.schema);
const signatures = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(typed as never) })));
writeFileSync(file, JSON.stringify({ ...snap, issuedAt: u.issuedAt.toString(), expiry: u.expiry.toString(), signatures }, null, 1) + "\n");
console.log("rewrote contracts/deployments/snapshot-devnet.json; run `pnpm --filter @verbatim/web sync` to copy it to the site's data");

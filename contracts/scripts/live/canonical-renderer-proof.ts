// §8: an unstaked RendererPaymaster on the live devnet. The public sidecar must refuse it. The transaction and its real
// ethrex trace go to contracts/docs/upstream/unstaked-renderer.json, which the patched fork's validator then judges.
// Run: VERBATIM_STATE=contracts/.state/unstaked.json SKIP_STAKE=1 npx tsx deploy-devnet.ts, then with the same state file, this.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, parseAbi, type Hex } from "viem";
import { simulate, submit, toWire } from "@verbatim/frames-sdk";
import { addr, ROOT } from "./lib/env";
import { pub } from "./lib/chain";
import { prepareTx, sign, state, transferCall } from "./lib/verbatim";
import { record } from "./lib/proofs";

const s = state();
const REGISTRY = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f" as const;
const info = (await pub.readContract({ address: REGISTRY, abi: parseAbi(["function getDepositInfo(address) view returns ((uint256 stake, uint32 unstakeDelaySec, uint256 withdrawTime))"]), functionName: "getDepositInfo", args: [s.paymaster] })) as { stake: bigint };
if (info.stake !== 0n) throw new Error("this paymaster is staked; the proof needs it not to be");
const tx = await sign(await prepareTx([transferCall(s.tokenA, addr("OWNER3_KEY"), 1n)]));
const sim = await simulate(tx, undefined, true);
let refusal = "";
try {
  await submit(tx);
} catch (e) {
  refusal = (e as Error).message;
}
const codehash = keccak256((await pub.getCode({ address: s.paymaster })) as Hex);
writeFileSync(resolve(ROOT, "contracts/docs/upstream/unstaked-renderer.json"), JSON.stringify({ paymaster: s.paymaster, codehash, stake: "0", publicSidecarRefusal: refusal, tx: toWire(tx), simResult: sim }, null, 1) + "\n");
console.log("code hash", codehash, "\npublic sidecar:", refusal.slice(0, 200) || "ADMITTED");
if (!/unstaked/.test(refusal)) throw new Error("expected the public sidecar to refuse an unstaked paymaster");
record({ id: "CANONICAL-UNSTAKED", title: "Unstaked renderer: the public sidecar refuses it", expected: "unstaked payer", pass: true, outcome: "rejected-at-mempool", message: refusal.slice(0, 200) });

import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { simulate, submit, waitReceipt, RpcError } from "@verbatim/frames-sdk";
import { prepareTx, sign, state, transferCall } from "./lib/verbatim";
import { addr } from "./lib/env";
const s = state();
const call = transferCall(s.tokenA, addr("OWNER3_KEY"), 1_000_000n);
const big = await sign(await prepareTx([call], { gas: { frame0: 300_000n, frame1: 900_000n, frame2: 1_200_000n, frame2State: 400_000n } }));
const sim = await simulate(big);
console.log("measured", sim.frames?.map((f: any) => parseInt(f.gasUsed, 16)), sim.executionError, sim.revertData);
const q = await prepareTx([call]);
for (const l of formatForDevice(decodeTree(q.tree))) console.log("  ".repeat(l.indent) + l.text);
const tx = await sign(q);
try {
  const h = await submit(tx);
  console.log("ADMITTED", h);
  const r = await waitReceipt(h);
  console.log(JSON.stringify({ status: r.status, block: r.blockNumber, payer: r.payer, frames: r.frameReceipts?.map((f) => ({ s: f.status, g: f.gasUsed, logs: f.logs?.length })) }));
} catch (e) { console.log("REJECTED", (e as RpcError).code, (e as RpcError).message); }

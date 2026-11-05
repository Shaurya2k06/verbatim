import { encodeFunctionData, parseAbi, parseEther, type Address } from "viem";
import { simulate } from "@verbatim/frames-sdk";
import { v4SwapCall } from "@verbatim/urrender";
import { prepareTx, sign, state, ERC20, transferCall } from "./lib/verbatim";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, addr } from "./lib/env";
const s = state();
const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const big = { expiry: 100_000n, account: 300_000n, paymaster: 900_000n, execute: 2_000_000n, executeState: 1_500_000n };
const cases: [string, any][] = [
  ["transfer", transferCall(s.tokenA, addr("OWNER3_KEY"), 1n)],
  ["approve", { target: s.tokenA, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, 5n] }) }],
  ["permit2.approve", { target: PERMIT2, value: 0n, data: encodeFunctionData({ abi: P2, functionName: "approve", args: [s.tokenB, ROUTER, parseEther("500"), 2 ** 47] }) }],
  ["v4 swap (ETH in)", { target: ROUTER, value: parseEther("0.001"), data: v4SwapCall({ key: s.poolEthHonest.key, zeroForOne: true, amountIn: parseEther("0.001"), amountOutMinimum: 2_000_000n }, BigInt(Math.floor(Date.now() / 1000) + 3600)) }],
];
const rows: { name: string; expiry: number; frame0: number; frame1: number }[] = [];
for (const [name, c] of cases) {
  const p = await prepareTx([c], { gas: big, maxFeePerGas: 10_000n });
  const sim = await simulate(await sign(p));
  if (!sim.executionError) rows.push({ name, expiry: parseInt(sim.frames[0].gasUsed, 16), frame0: parseInt(sim.frames[1].gasUsed, 16), frame1: parseInt(sim.frames[2].gasUsed, 16) });
  console.log(name, sim.frames?.map((f: any) => parseInt(f.gasUsed, 16)), (sim.executionError ?? "").slice(-70), sim.revertData ?? "", "maxCost", sim.maxCost, "tree", (p.tree.length - 2) / 2, "spec", (p.spec.length - 2) / 2);
}
writeFileSync(resolve(ROOT, "docs/prefix-measurements.json"), JSON.stringify(rows, null, 1) + "\n");

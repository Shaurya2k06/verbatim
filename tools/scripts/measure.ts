import { encodeFunctionData, parseAbi, parseEther, type Address } from "viem";
import { simulate } from "@verbatim/frames-sdk";
import { v4SwapCall } from "@verbatim/urrender";
import { prepareTx, sign, state, ERC20, transferCall } from "./lib/verbatim";
import { addr } from "./lib/env";
const s = state();
const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const big = { frame0: 300_000n, frame1: 900_000n, frame2: 2_000_000n, frame2State: 1_500_000n };
const zeroForOne = s.poolHonest.key.currency0.toLowerCase() === s.tokenB.toLowerCase();
const cases: [string, any][] = [
  ["transfer", transferCall(s.tokenA, addr("OWNER3_KEY"), 1n)],
  ["approve", { target: s.tokenA, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, 5n] }) }],
  ["permit2.approve", { target: PERMIT2, value: 0n, data: encodeFunctionData({ abi: P2, functionName: "approve", args: [s.tokenB, ROUTER, parseEther("500"), 2 ** 47] }) }],
  ["v4 swap", { target: ROUTER, value: 0n, data: v4SwapCall({ key: s.poolHonest.key, zeroForOne, amountIn: parseEther("1"), amountOutMinimum: 2_000_000_000n }, BigInt(Math.floor(Date.now() / 1000) + 3600)) }],
];
for (const [name, c] of cases) {
  const p = await prepareTx([c], { gas: big, fee: { asset: "0x0000000000000000000000000000000000000000", amount: 999_000_000_000n } });
  const sim = await simulate(await sign(p));
  console.log(name, sim.frames?.map((f: any) => parseInt(f.gasUsed, 16)), (sim.executionError ?? "").slice(-70), sim.revertData ?? "", "maxCost", sim.maxCost, "tree", (p.tree.length - 2) / 2, "spec", (p.spec.length - 2) / 2);
}

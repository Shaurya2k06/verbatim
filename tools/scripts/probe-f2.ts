import { encodeFunctionData, type Hex, decodeEventLog } from "viem";
import { Mode, Scope, RpcError, STAKING_REGISTRY, frame, newTx, simulate, submit, waitReceipt, rpc, DEVNET, sigHash } from "@verbatim/frames-sdk";
import { readState } from "./lib/env";
import { artifact, pub } from "./lib/chain";
const s = readState();
const acc = artifact("Probes.sol", "ProbeAccount");
const pm = artifact("Probes.sol", "ProbePaymaster");
const account = s.probeAccount, paymaster = s.probePaymaster;
const SIG = ("0x" + "ab".repeat(65)) as Hex;
const sigWord = BigInt("0x" + "ab".repeat(32));
const build = async (rounds: bigint, accGas: bigint, pmGas: bigint) => newTx({
  chainId: 1337, sender: account, nonce: BigInt(await pub.getTransactionCount({ address: account })), maxFeePerGas: 2_000_000_000n,
  signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: SIG }],
  frames: [
    frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION, target: account, execution: accGas, data: encodeFunctionData({ abi: acc.abi, functionName: "verifyFrame", args: [3n, sigWord] }) }),
    frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: paymaster, execution: pmGas, data: encodeFunctionData({ abi: pm.abi, functionName: "pay", args: [rounds] }) }),
    frame({ mode: Mode.SENDER, target: account, execution: 200_000n, state: 200_000n, data: encodeFunctionData({ abi: acc.abi, functionName: "report", args: [1n] }) }),
  ],
});
console.log("stake", await pub.readContract({ address: STAKING_REGISTRY, abi: [{ type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] }] as const, functionName: "getDepositInfo", args: [paymaster] }).catch((e) => String(e).slice(0, 200)));
const attempt = async (label: string, tx: any) => {
  const sim = await simulate(tx, undefined, true).catch((e: Error) => ({ simError: e.message }));
  const t = sim.erc7562Trace;
  console.log(label, "sim", JSON.stringify({ shape: sim.prefixShape, canonical: sim.canonicalMempoolViolation, frames: sim.frames, err: sim.executionError, simError: sim.simError, traceErr: sim.erc7562TraceError }));
  try { const h = await submit(tx); console.log(label, "ADMITTED", h); return h; }
  catch (e) { console.log(label, "REJECTED", (e as RpcError).code, (e as RpcError).message); return null; }
};
// small: total under 100k, staked paymaster reading own storage
const small = await build(10n, 30_000n, 60_000n);
const h = await attempt("small-staked", small);
if (h) {
  const r = await waitReceipt(h);
  console.log("receipt", JSON.stringify({ status: r.status, block: r.blockNumber, payer: r.payer, frames: r.frameReceipts?.map((f) => ({ s: f.status, g: f.gasUsed })) }));
  const logs = (r.frameReceipts ?? []).flatMap((f) => f.logs ?? []);
  for (const l of logs) { const d = decodeEventLog({ abi: acc.abi, data: l.data, topics: l.topics }) as any; console.log("Probe", JSON.stringify(d.args, (_, v) => typeof v === "bigint" ? "0x" + v.toString(16) : v)); }
  console.log("expected sigHash", sigHash(small));
}
await new Promise((r) => setTimeout(r, 15000));
for (const [rounds, gas] of [[500n, 300_000n], [3000n, 950_000n], [3000n, 1_100_000n], [3000n, 2_400_000n]] as const) {
  await attempt(`big-${gas}`, await build(rounds, 30_000n, gas));
  await new Promise((r) => setTimeout(r, 15000));
}

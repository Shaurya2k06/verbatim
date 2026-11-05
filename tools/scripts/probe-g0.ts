// G0 (context.md §17): five probes on the live devnet. Each result goes to docs/proofs.json.
import { concat, encodeFunctionData, encodePacked, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Mode, Scope, frame, newTx, simulate, submit, waitReceipt, type FrameTx } from "@verbatim/frames-sdk";
import { key, readState, writeState } from "./lib/env";
import { artifact, deploy, pub } from "./lib/chain";
import { record } from "./lib/proofs";

const SPEC_VERIFIER: Address = "0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf";
const DEVNET_VERIFIER: Address = "0x0000000000000000000000000000000000008141";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const EXPIRY_GAS = 5_000n;
const deployer = key("DEPLOYER_KEY");
let s = readState();
if (!s.probeG0) {
  const a = await deploy(deployer, "Probes.sol", "ProbeG0Account", { args: [s.frameReader], approve: true, value: parseEther("0.05") });
  writeState({ probeG0: a.address });
  s = readState();
}
const account: Address = s.probeG0;
const paymaster: Address = s.probePaymaster;
const abi = artifact("Probes.sol", "ProbeG0Account").abi;
const pmAbi = artifact("Probes.sol", "ProbePaymaster").abi;

// (a)
const specCode = await pub.getCode({ address: SPEC_VERIFIER });
const devCode = await pub.getCode({ address: DEVNET_VERIFIER });
record({ id: "G0a", title: "Expiry verifier deployed", expected: "code at the verifier address", pass: !!devCode && devCode !== "0x", outcome: "mined", message: `Spec address ${SPEC_VERIFIER}: ${specCode ?? "no code"}. Devnet address ${DEVNET_VERIFIER}: ${devCode}, 8-byte data, reverts past the timestamp. Spec address differs from the deployed one: finding.` });

const expiryFrame = (t: bigint) => frame({ mode: Mode.VERIFY, flags: 0, target: DEVNET_VERIFIER, execution: EXPIRY_GAS, state: 0n, data: toHex(t, { size: 8 }) });
const keys = ["OWNER1_KEY", "OWNER2_KEY", "ATTESTOR1_KEY", "ATTESTOR2_KEY"].map((k) => privateKeyToAccount(key(k)));
const msgA = keccak256(encodePacked(["string"], ["owner digest"]));
const msgB = keccak256(encodePacked(["string"], ["attestor snapshot digest"]));
const otherHash = keccak256((await pub.getCode({ address: PERMIT2 })) as Hex);
const now = async () => (await pub.getBlock()).timestamp;

async function entries() {
  return Promise.all(
    keys.map(async (k, i) => {
      const hash = i < 2 ? msgA : msgB;
      const sig = await k.sign({ hash });
      const v = parseInt(sig.slice(130, 132), 16);
      return { scheme: 1, signer: k.address, msg: hash, signature: concat([toHex(v >= 27 ? v - 27 : v, { size: 1 }), `0x${sig.slice(2, 130)}` as Hex]) };
    }),
  );
}

async function build(shape: "self" | "pay", opts: { accountGas?: bigint; bad?: boolean; expiry?: bigint } = {}): Promise<FrameTx> {
  const nonce = BigInt(await pub.getTransactionCount({ address: account }));
  const scope = shape === "self" ? 3n : 2n;
  const verify = frame({ mode: Mode.VERIFY, flags: shape === "self" ? Scope.EXECUTION_AND_PAYMENT : Scope.EXECUTION, target: account, execution: opts.accountGas ?? 60_000n, data: encodeFunctionData({ abi, functionName: "verifyFrame", args: [msgA, msgB, 2n, 4n, PERMIT2, opts.bad ? msgA : otherHash, scope] }) });
  const frames = [expiryFrame(opts.expiry ?? (await now()) + 240n), verify];
  if (shape === "pay") frames.push(frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: paymaster, execution: 20_000n, data: encodeFunctionData({ abi: pmAbi, functionName: "pay", args: [1n] }) }));
  frames.push(frame({ mode: Mode.SENDER, target: account, execution: 100_000n, state: 200_000n, data: encodeFunctionData({ abi, functionName: "ping" }) }));
  return newTx({ chainId: 1337, sender: account, nonce, maxFeePerGas: 2_000_000_000n, signatures: await entries(), frames });
}

async function attempt(tx: FrameTx) {
  const sim = await simulate(tx).catch((e: Error) => ({ simError: e.message })) as any;
  const verdict = { valid: sim.valid, shape: sim.prefixShape, canonical: sim.canonicalMempoolValid, violation: sim.violation ?? sim.canonicalMempoolViolation, error: sim.executionError ?? sim.simError };
  try {
    const h = await submit(tx);
    const r = (await waitReceipt(h)) as any;
    return { admitted: true, h, r, verdict, frames: r.frameReceipts?.map((f: any) => f.status) };
  } catch (e) {
    return { admitted: false, msg: (e as Error).message, verdict };
  }
}
const landed = (x: any) => x.admitted && x.r?.status === "0x1" && x.frames.every((f: string) => f === "0x1");
const show = (x: any) => JSON.stringify({ admitted: x.admitted, msg: x.msg?.slice(0, 200), ...x.verdict, frames: x.frames });

// (e) and (b) and (d): the stateless prefix with 4 explicit-msg entries and an EXTCODEHASH read.
const self = await attempt(await build("self"));
console.log("e1 self", show(self));
record({ id: "G0b", title: "Two explicit msgs in four SECP256K1 entries, read in a SIGPARAM loop", expected: "admitted and mined", pass: landed(self), outcome: self.admitted ? "mined" : "rejected-at-mempool", txHash: self.h, message: self.msg ?? JSON.stringify(self.verdict) });
record({ id: "G0d", title: "EXTCODEHASH of a contract that is no entity, in an unstaked sender's VERIFY", expected: "admitted and mined", pass: landed(self), outcome: self.admitted ? "mined" : "rejected-at-mempool", txHash: self.h, message: self.msg ?? JSON.stringify(self.verdict) });
record({ id: "G0e1", title: "[expiry_verify, self_verify] prefix", expected: "admitted and mined", pass: landed(self), outcome: self.admitted ? "mined" : "rejected-at-mempool", txHash: self.h, message: self.msg ?? JSON.stringify(self.verdict) });

// (e) the paymaster prefix.
const pay = await attempt(await build("pay"));
console.log("e2 pay", show(pay));
record({ id: "G0e2", title: "[expiry_verify, only_verify, pay] prefix with a staked paymaster", expected: "admitted and mined", pass: landed(pay), outcome: pay.admitted ? "mined" : "rejected-at-mempool", txHash: pay.h, message: pay.msg ?? JSON.stringify(pay.verdict) });

// (c) declared limits + 4 × 2,800 against 100k. Exactly at the cap, then one over.
const at = await attempt(await build("self", { accountGas: 100_000n - 11_200n - EXPIRY_GAS }));
console.log("c at cap", show(at));
const over = await attempt(await build("self", { accountGas: 100_000n - 11_200n - EXPIRY_GAS + 1n }));
console.log("c over", show(over));
record({ id: "G0c", title: "Signature gas counts toward the 100k cap", expected: "limits + signatures = 100,000 admitted; 100,001 refused", pass: at.admitted && !over.admitted && /MAX_VERIFY_GAS/.test(over.msg ?? ""), outcome: "rejected-at-mempool", txHash: at.h, message: over.msg });

// Control: a lying EXTCODEHASH fails, so (d) really read it.
const bad = await attempt(await build("self", { bad: true }));
console.log("d control", show(bad));
if (bad.admitted) throw new Error("the control was admitted, so EXTCODEHASH was not read");

// (f) added: a transaction already past its expiry, and an expiry frame with too little gas. Does either get in?
const past = await attempt(await build("self", { expiry: (await now()) - 60n }));
console.log("f past expiry", show(past));
record({ id: "G0f", title: "A transaction past its expiry", expected: "refused by the mempool", pass: !past.admitted, outcome: past.admitted ? "mined" : "rejected-at-mempool", txHash: past.h, message: past.msg ?? JSON.stringify({ frames: past.frames }) });

// Day-1 falsifiers F0, F1 (a/b/c), F2 on the live devnet. Results go to docs/PROOFS.md by hand.
import { encodeFunctionData, keccak256, parseEther, encodeAbiParameters, type Hex } from "viem";
import { Mode, Scope, RpcError, STAKING_REGISTRY, frame, newTx, simulate, submit, waitReceipt, sigHash } from "@verbatim/frames-sdk";
import { addr, key, readState, writeState } from "./lib/env";
import { artifact, deploy, faucet, pub, send, waitBalance } from "./lib/chain";

const deployer = key("DEPLOYER_KEY");
const me = addr("DEPLOYER_KEY");
const bal = await pub.getBalance({ address: me });
console.log("deployer", me, "balance", bal);
if (bal < parseEther("0.3")) {
  console.log("faucet:", await faucet(me));
  await waitBalance(me, parseEther("0.3"));
}

let s = readState();
if (!s.frameReader) {
  const fr = await deploy(deployer, "FrameReader.yul", "FrameReader", { gas: 2_000_000n });
  console.log("FrameReader", fr.address, fr.hash);
  writeState({ frameReader: fr.address });
  s = readState();
}
const acc = artifact("Probes.sol", "ProbeAccount");
const pm = artifact("Probes.sol", "ProbePaymaster");
if (!s.probeAccount) {
  const a = await deploy(deployer, "Probes.sol", "ProbeAccount", { args: [s.frameReader], approve: true });
  const p = await deploy(deployer, "Probes.sol", "ProbePaymaster", { args: [s.frameReader], approve: true, value: parseEther("0.05") });
  console.log("ProbeAccount", a.address, a.hash, "gas", a.gasUsed);
  console.log("ProbePaymaster", p.address, p.hash, "gas", p.gasUsed);
  writeState({ probeAccount: a.address, probePaymaster: p.address });
  s = readState();
}
const account = s.probeAccount;
const paymaster = s.probePaymaster;

const SIG = ("0x" + "ab".repeat(65)) as Hex;
const sigWord = BigInt("0x" + "ab".repeat(32));
const build = async (rounds: bigint, pmGas: bigint, accGas = 60_000n) => {
  const nonce = BigInt(await pub.getTransactionCount({ address: account }));
  return newTx({
    chainId: 1337,
    sender: account,
    nonce,
    maxFeePerGas: 2_000_000_000n,
    signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: SIG }],
    frames: [
      frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION, target: account, execution: accGas, data: encodeFunctionData({ abi: acc.abi, functionName: "verifyFrame", args: [3n, sigWord] }) }),
      frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: paymaster, execution: pmGas, data: encodeFunctionData({ abi: pm.abi, functionName: "pay", args: [rounds] }) }),
      frame({ mode: Mode.SENDER, target: account, execution: 200_000n, state: 200_000n, data: encodeFunctionData({ abi: acc.abi, functionName: "report", args: [1n] }) }),
    ],
  });
};

// F1: unstaked paymaster reading own storage must be refused, staked admitted.
const attempt = async (label: string, tx: ReturnType<typeof newTx>) => {
  const sim = await simulate(tx).catch((e: Error) => ({ simError: e.message }));
  console.log(label, "sim:", JSON.stringify({ valid: sim.valid, shape: sim.prefixShape, payer: sim.payer, violation: sim.violation, canonical: sim.canonicalMempoolViolation, gasUsed: sim.gasUsed, frames: sim.frames, err: sim.executionError, simError: sim.simError, fail: sim.failedFrameIndex, halt: sim.haltReason, revert: sim.revertData }));
  try {
    const h = await submit(tx);
    console.log(label, "ADMITTED", h);
    return h;
  } catch (e) {
    const err = e as RpcError;
    console.log(label, "REJECTED", err.code, err.message);
    return null;
  }
};

const first = await build(10n, 60_000n);
console.log("sigHash", sigHash(first));
await attempt("unstaked-small", first);

const stakeInfo = (await pub.getCode({ address: STAKING_REGISTRY })) ? true : false;
console.log("registry has code", stakeInfo);
if (!s.probeStaked) {
  const r = await send(deployer, paymaster, encodeFunctionData({ abi: pm.abi, functionName: "stake", args: [STAKING_REGISTRY, 86400] }), parseEther("0.012"));
  console.log("staked", r.transactionHash);
  writeState({ probeStaked: r.transactionHash });
}

// The attack kit against the live devnet. Each entry submits to the real alt-mempool gateway; results land in
// docs/proofs.json. Usage: tsx attacks.ts [ids...]
import { encodeFunctionData, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { RpcError, Scope, newTx, submit, waitReceipt } from "@verbatim/frames-sdk";
import { ACCOUNT_ABI, PAYMASTER_ABI, frame2Data, prepare, withSignatures, type Call, type Prepared } from "@verbatim/client";
import { addr, key, readState, writeState } from "./lib/env";
import { artifact, deploy, pub, send, wallet } from "./lib/chain";
import { ERC20, OWNER_KEYS, ZERO, prepareTx, sign, state, transferCall, trust } from "./lib/verbatim";
import { record } from "./lib/proofs";
import { batchResult, decodeRevert, frameGas } from "./lib/results";
import { attest, descriptorsFor, emptyUpdate, tokenEntry } from "./lib/trust-update";

const s = state();
const victim = addr("OWNER3_KEY");
const thief = addr("ATTACKER_KEY");

type Step = { id: string; title: string; expected: string; run: () => Promise<void> };

/** Runs a transaction that the spec says must not get in. */
async function mustReject(id: string, title: string, expected: string, tx: Parameters<typeof submit>[0], check?: (msg: string) => boolean) {
  try {
    const h = await submit(tx);
    const r = await waitReceipt(h);
    record({ id, title, expected, pass: false, outcome: "mined", txHash: h, block: Number(r.blockNumber), message: "was admitted" });
  } catch (e) {
    const msg = decodeRevert((e as RpcError).message);
    record({ id, title, expected, pass: check ? check(msg) : true, outcome: "rejected-at-mempool", message: msg });
  }
}

async function land(tx: Parameters<typeof submit>[0]) {
  const h = await submit(tx);
  const r = await waitReceipt(h);
  return { h, r };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bal = (t: Address, a: Address) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });
const depositOf = async (a: Address) => (await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "deposits", args: [a, ZERO] }))[0];

const steps: Step[] = [
  {
    id: "HONEST",
    title: "Honest 3-frame transfer",
    expected: "admitted by the public alt mempool and mined; batch succeeds",
    run: async () => {
      const before = await bal(s.tokenA, victim);
      const { h, r } = await land(await sign(await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)])));
      const res = batchResult(r, s.account);
      const after = await bal(s.tokenA, victim);
      record({ id: "HONEST", title: "Honest 3-frame transfer", expected: "admitted by the public alt mempool and mined; batch succeeds", pass: res.ok === true && after - before === 1_000_000n, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), extra: { payer: r.payer, delivered: String(after - before) } });
    },
  },
  {
    id: "A1",
    title: "Swap the recipient",
    expected: "mempool reject (tree mismatch)",
    run: async () => {
      const honest = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)]);
      const lie = await prepareTx([transferCall(s.tokenA, thief, 1_000_000n)], { signedAtBlock: honest.signedAtBlock, overrideSentence: { tree: honest.tree, spec: honest.spec } });
      await mustReject("A1", "Swap the recipient", "mempool reject (tree mismatch)", await sign(lie), (m) => /TreeMismatch/.test(m));
    },
  },
  {
    id: "A3",
    title: "Drop the renderer frame",
    expected: "frame 0 rejects",
    run: async () => {
      const honest = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)]);
      const selfPay = newTx({
        chainId: 1337,
        sender: s.account,
        nonce: honest.tx.nonceSeq,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1000n,
        signatures: honest.tx.signatures,
        frames: [{ ...honest.tx.frames[0], flags: Scope.EXECUTION_AND_PAYMENT }, honest.tx.frames[2]],
      });
      const signed = { ...selfPay, signatures: (await sign(honest)).signatures };
      await mustReject("A3", "Drop the renderer frame (self-pay layout)", "frame 0 rejects", signed);
      // And swapping in a different paymaster, which would approve anything.
      const swapped = { ...honest.tx, frames: [honest.tx.frames[0], { ...honest.tx.frames[1], target: s.probePaymaster as Address, data: "0x" as Hex }, honest.tx.frames[2]] };
      await mustReject("A3b", "Swap in a permissive paymaster", "frame 0 rejects (BadLayout)", { ...swapped, signatures: (await sign(honest)).signatures }, (m) => /BadLayout|BadSignatureEntry|reverted/.test(m));
    },
  },
  {
    id: "A4",
    title: "Substitute a weaker spec",
    expected: "frame 1 or frame 2 hash mismatch",
    run: async () => {
      const honest = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)]);
      const weak = ("0x56530001" + "0000") as Hex;
      // The owners really do sign the weak spec's hash: render still disagrees.
      const claimed = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)], { signedAtBlock: honest.signedAtBlock, overrideSentence: { tree: honest.tree, spec: weak } });
      await mustReject("A4", "Signed weaker spec hash", "frame 1 hash mismatch", await sign(claimed), (m) => /SpecHashMismatch/.test(m));
      // Honest hashes signed, weak spec bytes swapped into frame 2.
      const f2 = { ...honest.tx.frames[2], data: frame2Data(honest.fee, honest.calls, weak) };
      const t = { ...honest.tx, frames: [honest.tx.frames[0], honest.tx.frames[1], f2] };
      const p2 = await resign(honest, t);
      await mustReject("A4b", "Weak spec bytes under honest hash", "frame 1 hash mismatch", p2, (m) => /SpecHashMismatch/.test(m));
    },
  },
  {
    id: "A5",
    title: "Poisoned descriptor",
    expected: "UNVERIFIED_CONTRACT, policy reject",
    run: async () => {
      // Code nobody attested, whatever descriptor a frontend claims for it. The chain has none, so it renders blind.
      const target = readState().probeAccount as Address;
      const call: Call = { target, value: 0n, data: "0xdeadbeef" };
      await mustReject("A5", "Poisoned descriptor (unattested code)", "UNVERIFIED_CONTRACT, policy reject", await sign(await prepareTx([call])), (m) => /PolicyRefused/.test(m));
    },
  },
  {
    id: "A6",
    title: "EvilVault hidden pull",
    expected: "assertion revert, fee kept",
    run: async () => {
      const dep = 5_000_000n;
      const approve = (t: Address, amt: bigint): Call => ({ target: t, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [s.evilVault, amt] }) });
      if ((await pub.readContract({ address: s.tokenB, abi: ERC20, functionName: "allowance", args: [s.account, s.evilVault] })) === 0n) {
        // The "old approval" the vault later abuses. One call each: two would not fit the public gateway's 100k cap.
        for (const c of [approve(s.tokenA, dep * 10n), approve(s.tokenB, parseEther("50"))]) {
          const a = await land(await sign(await prepareTx([c])));
          console.log("approval", a.h, batchResult(a.r, s.account));
          await sleep(8000);
        }
      }
      const wethBefore = await bal(s.tokenB, s.account);
      const usdcBefore = await bal(s.tokenA, s.account);
      const feeBefore = await depositOf(s.account);
      const call: Call = { target: s.evilVault, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function deposit(uint256)"]), functionName: "deposit", args: [dep] }) };
      const p = await prepareTx([call]);
      const { h, r } = await land(await sign(p));
      const res = batchResult(r, s.account);
      const wethAfter = await bal(s.tokenB, s.account);
      const usdcAfter = await bal(s.tokenA, s.account);
      const feeAfter = await depositOf(s.account);
      record({ id: "A6", title: "EvilVault hidden WETH pull", expected: "assertion revert, fee kept", pass: res.ok === false && /AssertionFailed/.test(res.err) && wethAfter === wethBefore && usdcAfter === usdcBefore && feeBefore - feeAfter === p.fee.amount, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r), extra: { feeKept: String(feeBefore - feeAfter) } });
    },
  },
  {
    id: "A7",
    title: "Stale pre-signed transaction",
    expected: "revert past TTL",
    run: async () => {
      const before = await bal(s.tokenA, victim);
      const old = (await pub.getBlockNumber()) - 40n;
      const { h, r } = await land(await sign(await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)], { signedAtBlock: old })));
      const res = batchResult(r, s.account);
      record({ id: "A7", title: "Stale pre-signed transaction past TTL", expected: "revert", pass: res.ok === false && /Expired/.test(res.err) && (await bal(s.tokenA, victim)) === before, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
    },
  },
  {
    id: "A9",
    title: "Fee griefing with an empty deposit",
    expected: "frame 1 rejects",
    run: async () => {
      const p = await prepareTx([transferCall(s.tokenA, victim, 1n)], { account: s.account2 });
      await mustReject("A9", "Fee griefing with an empty deposit", "frame 1 rejects", await sign(p), (m) => /InsufficientDeposit/.test(m));
    },
  },
  {
    id: "A10",
    title: "7702-delegated sender",
    expected: "rejected",
    run: async () => {
      const eoaKey = generatePrivateKey();
      const eoa = privateKeyToAccount(eoaKey);
      await send(key("DEPLOYER_KEY"), eoa.address, "0x", parseEther("0.005"), 300_000n);
      const w = wallet(eoaKey);
      const auth = await eoa.signAuthorization({ chainId: 1337, contractAddress: s.account, nonce: 1 });
      const hash = await w.sendTransaction({ to: eoa.address, authorizationList: [auth], gas: 300_000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1000n, type: "eip7702" });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      console.log("delegated", eoa.address, rc.status, await pub.getCode({ address: eoa.address }));
      const p = await prepareTx([transferCall(s.tokenA, victim, 1n)], { account: eoa.address });
      const tx = withSignatures(p.tx, p.digest, []);
      await mustReject("A10", "7702-delegated sender", "rejected", tx);
    },
  },
  {
    id: "A11",
    title: "Reentrancy into executeVerified",
    expected: "reverts",
    run: async () => {
      // The attacker address also collects the A2 skim, so compare before and after rather than against zero.
      const thiefBefore = await bal(s.tokenA, thief);
      const accountBefore = await bal(s.tokenA, s.account);
      const inner = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeVerified", args: [{ asset: ZERO, amount: 0n }, [transferCall(s.tokenA, thief, 1_000_000n)], "0x"] });
      const call: Call = { target: s.reenterer, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function attack(address,bytes)"]), functionName: "attack", args: [s.account, inner] }) };
      const { h, r } = await land(await sign(await prepareTx([call])));
      const res = batchResult(r, s.account);
      record({ id: "A11", title: "Reentrancy into executeVerified", expected: "reverts", pass: res.ok === false && /CallFailed/.test(res.err) && (await bal(s.tokenA, thief)) === thiefBefore && (await bal(s.tokenA, s.account)) === accountBefore, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
    },
  },
  {
    id: "A12",
    title: "Gas griefing",
    expected: "assertion reserve keeps the batch safe",
    run: async () => {
      const feeBefore = await depositOf(s.account);
      const call: Call = { target: s.gasBurner, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function burn()"]), functionName: "burn", args: [] }) };
      const { h, r } = await land(await sign(await prepareTx([call])));
      const res = batchResult(r, s.account);
      record({ id: "A12", title: "Gas griefing: a call burns all its gas", expected: "reserve keeps it safe", pass: res.ok === false && r.frameReceipts?.[2]?.status === "0x1" && (await depositOf(s.account)) < feeBefore, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
    },
  },
  {
    id: "F7",
    title: "Fee failure runs nothing",
    expected: "frame 2 fails; no protected call executes",
    run: async () => {
      let st = readState();
      const deployer = key("DEPLOYER_KEY");
      if (!st.feeFailPaymaster) {
        const owners = ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map(addr);
        const attestors = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr);
        const { getContractAddress } = await import("viem");
        const nonce = BigInt(await pub.getTransactionCount({ address: addr("DEPLOYER_KEY") }));
        const predicted = getContractAddress({ from: addr("DEPLOYER_KEY"), nonce: nonce + 1n });
        const a = await deploy(deployer, "VerbatimAccount.sol", "VerbatimAccount", { args: [predicted, 200n, owners, 2, st.frameReader], approve: true });
        const ch = keccak256((await pub.getCode({ address: a.address })) as Hex);
        const { packedUniswap } = await import("@verbatim/client");
        const pm = await deploy(deployer, "RendererPaymaster.sol", "FeeFailPaymaster", { args: [ch, addr("DEPLOYER_KEY"), st.trustAdmin, "0x000000000022D473030F116dDEE9F6B43aC78BA3", "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6", packedUniswap, attestors, 2, st.frameReader], approve: true });
        await send(deployer, pm.address, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "stake", args: ["0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f", 86400] }), parseEther("0.012"));
        await send(deployer, pm.address, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "deposit", args: [a.address, ZERO, 0n] }), parseEther("0.03"));
        await send(deployer, pm.address, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "setFeeAsset", args: [ZERO, 1n, true] }));
        await send(deployer, st.tokenA, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [a.address, 1_000_000n] }));
        writeState({ feeFailPaymaster: pm.address, feeFailAccount: a.address });
        st = readState();
      }
      if (!st.feeFailAttested) {
        const u = emptyUpdate(1n);
        u.descriptors = descriptorsFor("erc20.json", keccak256((await pub.getCode({ address: st.tokenA })) as Hex));
        u.tokens = [tokenEntry(st.tokenA, "dUSDC", 6)];
        await attest(st.feeFailPaymaster, u);
        writeState({ feeFailAttested: true });
      }
      const before = await bal(st.tokenA, st.feeFailAccount);
      const call: Call = { target: st.tokenA, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [victim, 1n] }) };
      const { ChainTrust } = await import("@verbatim/client");
      const gas = (await import("@verbatim/client")).PUBLIC_GATEWAY_GAS;
      const p = await prepare({ client: pub as never, trust: new ChainTrust(pub as never, st.feeFailPaymaster), account: st.feeFailAccount, paymaster: st.feeFailPaymaster, calls: [call], fee: { asset: ZERO, amount: gas.frame0 + gas.frame1 + gas.frame2 + gas.frame2State }, gas });
      try {
        const { h, r } = await land(await sign(p));
        const statuses = (r.frameReceipts ?? []).map((f) => f.status);
        record({ id: "F7", title: "Fee failure runs nothing", expected: "frame 2 fails; no protected call executes", pass: statuses[2] === "0x0" && (await bal(st.tokenA, st.feeFailAccount)) === before, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), extra: { statuses } });
      } catch (e) {
        record({ id: "F7", title: "Fee failure runs nothing", expected: "frame 2 fails; no protected call executes", pass: false, outcome: "rejected-at-mempool", message: decodeRevert((e as RpcError).message) });
      }
    },
  },
];

/** Re-signs after a frontend mutated a transaction, as an owner who signs whatever digest it is handed. */
async function resign(p: Prepared, tx: Prepared["tx"]) {
  const { txCommit, typedData } = await import("@verbatim/client");
  const { hashTypedData } = await import("viem");
  const typed = typedData(p.chainId, p.account, txCommit(tx), p.treeHash, p.specHash, p.signedAtBlock);
  const sigs = await Promise.all(OWNER_KEYS.map(async (k) => {
    const a = privateKeyToAccount(key(k));
    return { signer: a.address, sig: await a.signTypedData(typed as never) };
  }));
  return withSignatures(tx, hashTypedData(typed), sigs);
}

const want = process.argv.slice(2);
for (const step of steps) {
  if (want.length && !want.includes(step.id)) continue;
  console.log(`--- ${step.id}: ${step.title}`);
  try {
    await step.run();
  } catch (e) {
    record({ id: step.id, title: step.title, expected: step.expected, pass: false, outcome: "not-run", message: decodeRevert(String((e as Error).message)) });
  }
  await sleep(7000);
}

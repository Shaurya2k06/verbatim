// The attack kit against the live devnet. Each entry submits to the real alt-mempool gateway; results land in
// docs/proofs.json. Usage: tsx attacks.ts [ids...]
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { RpcError, Scope, newTx, submit, waitReceipt } from "@verbatim/frames-sdk";
import { ACCOUNT_ABI, ChainTrust, PAYMASTER_ABI, frame2Data, withSignatures, type Call, type Prepared } from "@verbatim/client";
import { addr, key, readState, writeState } from "./lib/env";
import { artifact, deploy, pub, send, wallet } from "./lib/chain";
import { ERC20, OWNER_KEYS, TICKET, ZERO, prepareTx, sign, state, transferCall } from "./lib/verbatim";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { review } from "@verbatim/signer";
import { CMD, executeData, v4ExactInSingleInput } from "@verbatim/urrender";
import { record } from "./lib/proofs";
import { batchResult, decodeRevert, frameGas } from "./lib/results";
import { attest, descriptorsFor, emptyUpdate, tokenEntry } from "./lib/trust-update";

const s = state();
const victim = addr("OWNER3_KEY");
const thief = addr("ATTACKER_KEY");
const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";

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
const feesTaken = () => pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "feesAccrued", args: [ZERO] });

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
      const lie = await prepareTx([transferCall(s.tokenA, thief, 1_000_000n)], { validUntil: honest.validUntil, overrideSentence: { tree: honest.tree, spec: honest.spec } });
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
        maxFeePerGas: honest.tx.fees.maxFeePerGas,
        maxPriorityFeePerGas: honest.tx.fees.maxPriorityFeePerGas,
        signatures: honest.tx.signatures,
        frames: [{ ...honest.tx.frames[0], flags: Scope.EXECUTION_AND_PAYMENT }, honest.tx.frames[2]],
      });
      const signed = { ...selfPay, signatures: (await sign(honest)).signatures };
      await mustReject("A3", "Drop the renderer frame (self-pay layout)", "frame 0 rejects with BadLayout", signed, (m) => /BadLayout\(0x0\)/.test(m));
      // And swapping in a different paymaster, which would approve anything.
      const swapped = { ...honest.tx, frames: [honest.tx.frames[0], { ...honest.tx.frames[1], target: s.probePaymaster as Address, data: "0x" as Hex }, honest.tx.frames[2]] };
      await mustReject("A3b", "Swap in a permissive paymaster", "frame 0 rejects (BadLayout)", { ...swapped, signatures: (await sign(honest)).signatures }, (m) => /BadLayout\(0x4\)/.test(m));
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
      const claimed = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)], { validUntil: honest.validUntil, overrideSentence: { tree: honest.tree, spec: weak } });
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
      const feeBefore = await feesTaken();
      const call: Call = { target: s.evilVault, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function deposit(uint256)"]), functionName: "deposit", args: [dep] }) };
      const p = await prepareTx([call]);
      const { h, r } = await land(await sign(p));
      const res = batchResult(r, s.account);
      const wethAfter = await bal(s.tokenB, s.account);
      const usdcAfter = await bal(s.tokenA, s.account);
      const feeAfter = await feesTaken();
      record({ id: "A6", title: "EvilVault hidden WETH pull", expected: "assertion revert, fee kept", pass: res.ok === false && /AssertionFailed/.test(res.err) && wethAfter === wethBefore && usdcAfter === usdcBefore && feeAfter - feeBefore === p.fee.amount, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r), extra: { feeKept: String(feeAfter - feeBefore) } });
    },
  },
  {
    id: "A7",
    title: "Stale pre-signed transaction",
    expected: "revert past TTL",
    run: async () => {
      const before = await bal(s.tokenA, victim);
      // Signed while valid, held back until it is not: a real replay.
      const now = (await pub.getBlock()).timestamp;
      const signed = await sign(await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)], { validUntil: now + 10n }));
      while ((await pub.getBlock()).timestamp <= now + 12n) await sleep(3000);
      const { h, r } = await land(signed);
      const res = batchResult(r, s.account);
      record({ id: "A7", title: "Stale pre-signed transaction past validUntil", expected: "revert", pass: res.ok === false && /Expired/.test(res.err) && (await bal(s.tokenA, victim)) === before, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
    },
  },
  {
    id: "A9",
    title: "No fee ticket for this nonce",
    expected: "frame 1 rejects",
    run: async () => {
      const p = await prepareTx([transferCall(s.tokenA, victim, 1n)], { account: s.account2, skipTickets: true });
      await mustReject("A9", "No fee ticket for this nonce", "frame 1 rejects", await sign(p), (m) => /NoTicket/.test(m));
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
    id: "A18",
    title: "Return bomb",
    expected: "the batch reverts and the fee stays paid",
    run: async () => {
      const feeBefore = await feesTaken();
      const call: Call = { target: s.returnBomb, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function detonate(uint256)"]), functionName: "detonate", args: [500_000n] }) };
      const { h, r } = await land(await sign(await prepareTx([call])));
      const res = batchResult(r, s.account);
      record({ id: "A18", title: "Return bomb: a call reverts with 500 KB", expected: "batch reverts, fee stays paid", pass: res.ok === false && r.frameReceipts?.[2]?.status === "0x1" && (await feesTaken()) > feeBefore, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err.slice(0, 200), frameGas: frameGas(r) });
    },
  },
  {
    id: "A12",
    title: "Gas griefing",
    expected: "assertion reserve keeps the batch safe",
    run: async () => {
      const feeBefore = await feesTaken();
      const call: Call = { target: s.gasBurner, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function burn()"]), functionName: "burn", args: [] }) };
      const { h, r } = await land(await sign(await prepareTx([call])));
      const res = batchResult(r, s.account);
      record({ id: "A12", title: "Gas griefing: a call burns all its gas", expected: "reserve keeps it safe", pass: res.ok === false && r.frameReceipts?.[2]?.status === "0x1" && (await feesTaken()) > feeBefore, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
    },
  },
  {
    id: "A13",
    title: "Future-dated validUntil",
    expected: "the device refuses; signed anyway, the policy cap reverts the batch",
    run: async () => {
      const before = await bal(s.tokenA, victim);
      const far = (await pub.getBlock()).timestamp + 3600n;
      const p = await prepareTx([transferCall(s.tokenA, victim, 1_000_000n)], { validUntil: far });
      let device = "accepted";
      try {
        review({ tree: p.tree, specHash: p.specHash, txCommit: p.txCommit });
      } catch (e) {
        device = (e as Error).message;
      }
      const { h, r } = await land(await sign(p));
      const res = batchResult(r, s.account);
      record({ id: "A13", title: "Future-dated validUntil", expected: "the device refuses; signed anyway, the policy cap reverts the batch", pass: /stay valid/.test(device) && res.ok === false && /TtlTooLong/.test(res.err) && (await bal(s.tokenA, victim)) === before, outcome: "reverted-in-batch", txHash: h, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r), extra: { device } });
    },
  },
  {
    id: "A14",
    title: "Two transactions, one fee ticket",
    expected: "the second is rejected: tickets are per nonce",
    run: async () => {
      const acct = s.account2 as Address;
      const nonce = BigInt(await pub.getTransactionCount({ address: acct }));
      await send(key("DEPLOYER_KEY"), s.paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [acct, nonce, 1n] }), TICKET, 2_000_000n);
      const first = await sign(await prepareTx([transferCall(s.tokenA, victim, 0n)], { account: acct, skipTickets: true }));
      const { h, r } = await land(first);
      const firstOk = r.frameReceipts?.[2]?.status === "0x1";
      await sleep(7000);
      const second = await sign(await prepareTx([transferCall(s.tokenA, victim, 0n)], { account: acct, skipTickets: true }));
      await mustReject("A14", "Two transactions, one fee ticket", "the second is rejected: tickets are per nonce", second, (m) => firstOk && /NoTicket/.test(m));
      console.log("first drew the ticket", h);
    },
  },
  {
    id: "A16",
    title: "Router command with the allow-revert flag",
    expected: "UR_ALLOW_REVERT in the sentence, then policy refusal",
    run: async () => {
      const k = s.poolHonest.key;
      const zeroForOne = k.currency0.toLowerCase() === s.tokenB.toLowerCase();
      const input = v4ExactInSingleInput({ key: k, zeroForOne, amountIn: 1n, amountOutMinimum: 1n });
      const p = await prepareTx([{ target: ROUTER, value: 0n, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [input], BigInt(Math.floor(Date.now() / 1000) + 600)) }]);
      const shown = formatForDevice(decodeTree(p.tree)).some((l) => /MAY PARTIALLY FAIL/.test(l.text));
      await mustReject("A16", "Router command with the allow-revert flag", "UR_ALLOW_REVERT in the sentence, then policy refusal", await sign(p), (m) => shown && /PolicyRefused/.test(m));
    },
  },
  {
    id: "A17",
    title: "Unknown router command and v4 action",
    expected: "BLIND, then refusal",
    run: async () => {
      const dl = BigInt(Math.floor(Date.now() / 1000) + 600);
      const p = await prepareTx([{ target: ROUTER, value: 0n, data: executeData([0x0a], ["0x1234"], dl) }]);
      await mustReject("A17", "Unknown router command (PERMIT2_PERMIT)", "BLIND, then refusal", await sign(p), (m) => /PolicyRefused/.test(m));
      await sleep(3000);
      const params = ["0x01", "0x02", "0x03"].map((x) => encodeAbiParameters([{ type: "uint256" }], [BigInt(x)]));
      const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x070c0f", params]);
      const q = await prepareTx([{ target: ROUTER, value: 0n, data: executeData([CMD.V4_SWAP], [input], dl) }]);
      await mustReject("A17b", "Unknown v4 action (SWAP_EXACT_IN)", "BLIND, then refusal", await sign(q), (m) => /PolicyRefused/.test(m));
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
        const a = await deploy(deployer, "VerbatimAccount.sol", "VerbatimAccount", { args: [predicted, owners, 2, st.frameReader], approve: true });
        const ch = keccak256((await pub.getCode({ address: a.address })) as Hex);
        const { packedUniswap } = await import("@verbatim/client");
        const pm = await deploy(deployer, "RendererPaymaster.sol", "FeeFailPaymaster", { args: [ch, addr("DEPLOYER_KEY"), st.trustAdmin, "0x000000000022D473030F116dDEE9F6B43aC78BA3", "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6", packedUniswap, attestors, 2, st.frameReader], approve: true });
        await send(deployer, pm.address, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "stake", args: ["0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f", 86400] }), parseEther("0.012"));
        await send(deployer, pm.address, "0x", parseEther("0.01"), 200_000n);
        await send(deployer, st.tokenA, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [a.address, 1_000_000n] }));
        writeState({ feeFailPaymaster: pm.address, feeFailAccount: a.address });
        st = readState();
      }
      if (!st.feeFailAttested) {
        const u = emptyUpdate(1n);
        u.descriptors = await descriptorsFor("erc20.json", keccak256((await pub.getCode({ address: st.tokenA })) as Hex));
        u.tokens = [tokenEntry(st.tokenA, "dUSDC", 6)];
        await attest(st.feeFailPaymaster, u);
        writeState({ feeFailAttested: true });
      }
      const before = await bal(st.tokenA, st.feeFailAccount);
      const call: Call = { target: st.tokenA, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [victim, 1n] }) };
      const p = await prepareTx([call], { trust: new ChainTrust(pub as never, st.feeFailPaymaster), account: st.feeFailAccount, paymaster: st.feeFailPaymaster });
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
  const typed = typedData(p.chainId, p.account, txCommit(tx), p.treeHash, p.specHash, p.validUntil);
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

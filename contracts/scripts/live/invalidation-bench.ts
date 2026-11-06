// context.md §16.3: N = 50 pending transactions across 50 senders, then a trust update, then rotating the snapshot. How many stop
// validating, on each path? Each sender has one transaction because a sender's next sequence is the only one validation accepts.
// Validation is re-run through ethrex's simulator, the call the sidecar makes for admission and revalidation. The transactions
// are not held in a live pool: the miner would land them within seconds, which ends the experiment.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAYMASTER_ABI, prepareStateless, withStatelessSignatures, type Call } from "@verbatim/client";
import { readFileSync } from "node:fs";
import { encodeFunctionData, keccak256, parseAbi, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { simulate } from "@verbatim/frames-sdk";
import type { PublishedSnapshot } from "@verbatim/snapshot-cli";
import { ROOT, key, addr, readState, writeState } from "./lib/env";
import { LEGACY_GAS_PRICE, artifact, pub, wallet } from "./lib/chain";
import { TICKET, prepareTx, sign, transferCall } from "./lib/verbatim";
import { attest, emptyUpdate } from "./lib/trust-update";
import { record } from "./lib/proofs";
import { decodeRevert } from "./lib/results";

const N = Number(process.argv[2] ?? 50);
const s = readState();
const deployer = key("DEPLOYER_KEY");
const me = addr("DEPLOYER_KEY");
const w = wallet(deployer);
const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/snapshot-devnet.json"), "utf8"));
const router = { permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address, weth: "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6" as Address, publisher: (await import("@verbatim/client")).packedUniswap };

/** Sends in a burst with explicit nonces, then waits for them all. A chain with six-second blocks makes one at a time too slow. */
async function burst(list: { to?: Address; data: Hex; value?: bigint; gas: bigint }[]) {
  const out = [];
  for (let i = 0; i < list.length; i += 20) {
    const nonce = await pub.getTransactionCount({ address: me, blockTag: "pending" });
    const hashes = await Promise.all(list.slice(i, i + 20).map((t, j) => w.sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0n, gas: t.gas, gasPrice: LEGACY_GAS_PRICE, type: "legacy", nonce: nonce + j })));
    for (const hash of hashes) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (r.status !== "success") throw new Error(`reverted: ${hash}`);
      out.push(r);
    }
  }
  return out;
}

// The same creation bytes as the deployed account, so the same code hash, which is what the paymaster pins.
let senders: Address[] = readState().benchSenders ?? [];
if (senders.length < N) {
  const creation = (await pub.getTransaction({ hash: s.deployTxs.account })).input;
  const made = await burst(Array.from({ length: N - senders.length }, () => ({ data: creation, gas: 50_000_000n })));
  senders = [...senders, ...made.map((r) => r.contractAddress as Address)];
  writeState({ benchSenders: senders });
  const code = await pub.getCode({ address: senders[0] });
  if (keccak256(code as Hex) !== s.accountCodehash) throw new Error("a bench sender's code hash differs from the account's");
  console.log("deployed", senders.length, "senders");
}
senders = senders.slice(0, N);
const ERC20 = artifact("TestTokens.sol", "TestToken").abi;
const unfunded: Address[] = [];
for (const a of senders) if ((await pub.getBalance({ address: a })) === 0n) unfunded.push(a);
if (unfunded.length) {
  await burst(unfunded.flatMap((a) => [
    { to: a, data: "0x" as Hex, value: parseEther("0.001"), gas: 200_000n },
    { to: s.tokenA as Address, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [a, 1_000_000n] }), gas: 500_000n },
  ]));
  console.log("funded", unfunded.length);
}
// A contract's sequence starts at 1, and tickets are per sequence.
const unticketed: { a: Address; nonce: bigint }[] = [];
for (const a of senders) {
  const nonce = BigInt(await pub.getTransactionCount({ address: a }));
  const [amount] = (await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "feeTicket", args: [a, nonce] })) as [bigint];
  if (amount < TICKET) unticketed.push({ a, nonce });
}
if (unticketed.length) await burst(unticketed.map(({ a, nonce }) => ({ to: s.paymaster as Address, data: encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [a, nonce, 1n] }), value: TICKET, gas: 2_000_000n })));

const victim = addr("OWNER3_KEY");
const owners = ["OWNER1_KEY", "OWNER2_KEY"].map((k) => privateKeyToAccount(key(k)));
const call: Call = transferCall(s.tokenA, victim, 1n);
// All signed against one expiry, which also has to outlast the measuring. Reads are concurrent, or signing alone would use it up.
const expiry = (await pub.getBlock()).timestamp + 280n;
const paymasterTxs: unknown[] = [];
const statelessTxs: unknown[] = [];
const started = Date.now();
for (let i = 0; i < senders.length; i += 10) {
  const part = senders.slice(i, i + 10);
  paymasterTxs.push(...(await Promise.all(part.map(async (account) => sign(await prepareTx([call], { account, expiry, skipTickets: true }))))));
  statelessTxs.push(...(await Promise.all(part.map(async (account) => {
    const p = await prepareStateless({ client: pub as never, account, calls: [call], snapshot: snap, router, expiry });
    const sigs = await Promise.all(owners.map(async (o) => ({ signer: o.address, sig: (await o.signTypedData(p.digestTypedData as never)) as Hex })));
    return withStatelessSignatures(p, sigs);
  }))));
}
console.log("signed", paymasterTxs.length + statelessTxs.length, "in", Date.now() - started, "ms");

async function count(txs: unknown[]) {
  const start = Date.now();
  const res = await Promise.all(txs.map(async (tx) => {
    const r = await simulate(tx as never);
    const failed = !r.frames || /Invalid|reverted/i.test(String(r.executionError ?? ""));
    return { ok: !failed, why: failed ? decodeRevert(String(r.revertData && r.revertData !== "0x" ? r.revertData : r.executionError ?? "")) : "" };
  }));
  const reasons = [...new Set(res.filter((r) => !r.ok).map((r) => r.why.replace(/^.*=> /, "").replace(/\(.*$/, "")))];
  return { valid: res.filter((r) => r.ok).length, stopped: res.filter((r) => !r.ok).length, reasons, ms: Date.now() - start };
}
const measure = async () => ({ paymaster: await count(paymasterTxs), stateless: await count(statelessTxs) });
const settle = () => new Promise((r) => setTimeout(r, 8000));

const [root, issuedAt, snapExpiry] = (await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "snapshot" })) as [Hex, bigint, bigint];
const epoch = BigInt(await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "trustEpoch" }));

const before = await measure();
console.log("before", JSON.stringify(before));

// A trust update that keeps the snapshot.
const refresh = await attest(s.paymaster, { ...emptyUpdate(epoch + 1n), root, issuedAt, expiry: snapExpiry });
await settle();
const afterRefresh = await measure();
console.log("after refreshTrust", JSON.stringify(afterRefresh));

// Rotating the snapshot: same contents, new root, because the signature covers the root.
const rotated = keccak256(toHex("verbatim bench rotation"));
const rotate = await attest(s.paymaster, { ...emptyUpdate(epoch + 2n), root: rotated, issuedAt, expiry: snapExpiry });
await settle();
const afterRotation = await measure();
console.log("after rotation", JSON.stringify(afterRotation));

// Put the published snapshot back. Everything else on this chain depends on it.
await attest(s.paymaster, { ...emptyUpdate(epoch + 3n), root, issuedAt, expiry: snapExpiry });
await settle();

const result = { n: N, senders: N, method: "ethrex_simulateFrameTransaction, the sidecar's own revalidation call; one pending transaction per sender", before, afterRefresh, afterRotation, txs: { refresh: refresh.transactionHash, rotate: rotate.transactionHash }, at: new Date().toISOString() };
writeFileSync(resolve(ROOT, "contracts/docs/invalidation-bench.json"), JSON.stringify(result, null, 1) + "\n");
const pass = before.paymaster.valid === N && before.stateless.valid === N && afterRefresh.paymaster.valid === N && afterRefresh.stateless.valid === N && afterRotation.paymaster.stopped === N && afterRotation.stateless.valid === N;
record({ id: "BENCH-N50", title: `${N} pending transactions, ${N} senders: a trust update, then rotating the snapshot`, expected: "refresh stops 0 on both; rotation stops all N on the paymaster path, 0 on the stateless path", pass, outcome: "mined", txHash: rotate.transactionHash, message: `refresh: ${afterRefresh.paymaster.stopped} paymaster, ${afterRefresh.stateless.stopped} stateless. Rotation: ${afterRotation.paymaster.stopped} paymaster, ${afterRotation.stateless.stopped} stateless. ${afterRotation.paymaster.reasons.join(",")}` });

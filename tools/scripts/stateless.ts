// G2 on the live devnet: the stateless path. No paymaster and no stake: the account renders in its own VERIFY frame, from proofs.
// Usage: tsx stateless.ts [measure | ids...]. Results land in docs/proofs.json.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeFunctionData, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RpcError, simulate, submit, waitReceipt, type FrameTx } from "@verbatim/frames-sdk";
import { ACCOUNT_ABI, packedUniswap, prepareStateless, withStatelessSignatures, type Call, type PreparedStateless } from "@verbatim/client";
import { encodeProofs, leafHash, treeOf, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { executeData, v4SwapCall, wrapInput, CMD, MSG_SENDER } from "@verbatim/urrender";
import { ROOT, addr, key } from "./lib/env";
import { pub, send } from "./lib/chain";
import { OWNER_KEYS, ERC20, state, transferCall } from "./lib/verbatim";
import { record } from "./lib/proofs";
import { batchResult, decodeRevert, frameGas } from "./lib/results";

const s = state();
const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "deployments/snapshot-devnet.json"), "utf8"));
const router = { permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address, weth: "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6" as Address, publisher: packedUniswap };
const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";
const victim = addr("OWNER3_KEY");
const thief = addr("ATTACKER_KEY");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bal = (t: Address, a: Address) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });
const ONE = parseEther("0.001");
const swap = (key_: unknown, min: bigint) => ({ target: ROUTER, value: ONE, data: v4SwapCall({ key: key_ as never, zeroForOne: true, amountIn: ONE, amountOutMinimum: min }, BigInt(Math.floor(Date.now() / 1000) + 3600)) });
type Args = Partial<Parameters<typeof prepareStateless>[0]>;
const prep = (calls: Call[], extra: Args = {}) => prepareStateless({ client: pub as never, account: s.account, calls, snapshot: snap, router, ...extra });

async function sign(p: PreparedStateless, snapshot = p.snapshot): Promise<FrameTx> {
  const sigs = await Promise.all(OWNER_KEYS.map(async (k) => {
    const a = privateKeyToAccount(key(k));
    return { signer: a.address, sig: (await a.signTypedData(p.digestTypedData as never)) as Hex };
  }));
  return withStatelessSignatures({ ...p, snapshot }, sigs);
}

async function reject(id: string, title: string, expected: string, tx: FrameTx, check: (m: string) => boolean) {
  try {
    const h = await submit(tx);
    const r = await waitReceipt(h);
    record({ id, title, expected, pass: false, outcome: "mined", txHash: h, block: Number(r.blockNumber), message: "was admitted" });
  } catch (e) {
    const msg = decodeRevert((e as RpcError).message);
    record({ id, title, expected, pass: check(msg), outcome: "rejected-at-mempool", message: msg });
  }
}

async function land(tx: FrameTx) {
  const h = await submit(tx);
  const r = await waitReceipt(h);
  return { h, r, res: batchResult(r, s.account) };
}

const steps: Record<string, () => Promise<void>> = {
  async S_HONEST() {
    const before = await bal(s.tokenA, victim);
    const feesBefore = await pub.getBalance({ address: s.paymaster });
    const { h, r, res } = await land(await sign(await prep([transferCall(s.tokenA, victim, 1_000_000n)])));
    record({ id: "S-HONEST", title: "Stateless path: honest transfer, no paymaster, no stake", expected: "admitted by the public alt mempool and mined", pass: res.ok === true && (await bal(s.tokenA, victim)) - before === 1_000_000n && (await pub.getBalance({ address: s.paymaster })) === feesBefore, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r) });
  },
  async S_SWAP() {
    const before = await bal(s.tokenA, s.account);
    const { h, r, res } = await land(await sign(await prep([swap(s.poolEthHonest.key, 2_000_000n)])));
    record({ id: "S-SWAP", title: "Stateless path: v4 swap through the real Universal Router", expected: "mined, minimum output respected", pass: res.ok === true && (await bal(s.tokenA, s.account)) - before >= 2_000_000n, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), message: res.err });
  },
  async S_WRAP() {
    const amount = 1_000_000_000_000n;
    const { h, r, res } = await land(await sign(await prep([{ target: ROUTER, value: amount, data: executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, amount)], BigInt(Math.floor(Date.now() / 1000) + 600)) }])));
    record({ id: "S-WRAP", title: "Stateless path: WRAP_ETH through the real Universal Router", expected: "mined", pass: res.ok === true, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), message: res.err });
  },
  async S_A1() {
    const honest = await prep([transferCall(s.tokenA, victim, 1_000_000n)]);
    const lie = await prep([transferCall(s.tokenA, thief, 1_000_000n)], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: honest.spec } });
    await reject("S-A1", "Stateless: recipient swapped under an honest sentence", "mempool reject: TreeMismatch", await sign(lie), (m) => /TreeMismatch/.test(m));
  },
  async S_A2() {
    const honest = await prep([swap(s.poolEthHonest.key, 2_000_000n)]);
    const lie = await prep([swap(s.poolEthEvil.key, 0n)], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: honest.spec } });
    await reject("S-A2", "Stateless: minOut=0 through SkimHook under an honest sentence", "mempool reject: TreeMismatch", await sign(lie), (m) => /TreeMismatch/.test(m));
    await sleep(2000);
    await reject("S-A2b", "Stateless: the true SkimHook sentence", "policy refuses", await sign(await prep([swap(s.poolEthEvil.key, 0n)])), (m) => /PolicyRefused/.test(m));
  },
  async B1() {
    const data = encodeFunctionData({ abi: parseAbi(["function setApprovalForAll(address,bool)"]), functionName: "setApprovalForAll", args: [thief, true] });
    await reject("B1", "NFT drainer through an unattested collection", "rendered blind, policy refuses", await sign(await prep([{ target: s.reenterer, value: 0n, data }])), (m) => /PolicyRefused/.test(m));
  },
  async B3() {
    // Attestors signed for another chain: same root and times, other domain.
    const other = await Promise.all(["ATTESTOR1_KEY", "ATTESTOR2_KEY"].map(async (k) => {
      const a = privateKeyToAccount(key(k));
      const { snapshotTypedData } = await import("@verbatim/snapshot-cli");
      return { signer: a.address, sig: await a.signTypedData(snapshotTypedData(1n, snap.root, BigInt(snap.issuedAt), BigInt(snap.expiry)) as never) };
    }));
    other.sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1));
    const p = await prep([transferCall(s.tokenA, victim, 1n)]);
    await reject("B3", "Attestors signed this snapshot for another chain", "refused: wrong D_snapshot", await sign(p, { ...snap, signatures: other }), (m) => /BadSignatureEntry/.test(m));
  },
  async B5() {
    // A token leaf's item, relabelled. The render finds no token; a descriptor lookup finds nothing of that type either.
    const t = treeOf(snap);
    const token = t.leaves.find((l) => l.type === 2)!;
    const forged = encodeProofs(t, [token]).replace(/^0x(..)02/, "0x$101") as Hex;
    await reject("B5", "A TOKEN leaf presented as a DESC", "refused, not believed", await sign(await prep([transferCall(s.tokenA, victim, 1n)], { proofsOverride: forged })), (m) => /PolicyRefused|BadProof/.test(m));
  },
  async B6() {
    const p = await prep([transferCall(s.tokenA, victim, 1n)]);
    const tx = await sign(p);
    const padded = { ...tx, signatures: [...tx.signatures, tx.signatures[3]] };
    await reject("B6", "Padding the signature list", "refused", padded, (m) => /BadSignatureEntry/.test(m));
  },
  async B7() {
    const t = treeOf(snap);
    const honest = await prep([transferCall(s.tokenA, victim, 1n)]);
    const desc = t.leaves.filter((l) => l.type === 1 && honest.proofs.includes(keccak256(l.vdesc as Hex).slice(2)));
    await reject("B7", "Leaving the TOKEN proof out", "refused", await sign(await prep([transferCall(s.tokenA, victim, 1n)], { proofsOverride: encodeProofs(t, desc) })), (m) => /PolicyRefused|TreeMismatch/.test(m));
  },
  async B9() {
    await reject("B9", "A far-future snapshot expiry", "refused: over maxSnapshotTtl", await sign(await prep([transferCall(s.tokenA, victim, 1n)], { extraOverride: (x) => ({ ...x, snapExpiry: x.issuedAt + 7n * 3600n }) })), (m) => /SnapshotTtlTooLong/.test(m));
  },
  async B10() {
    // Keep a signed transaction back, revoke a leaf it uses, then send it: admitted, and refused at execution.
    const p = await prep([transferCall(s.tokenA, victim, 1_000_000n)]);
    const tx = await sign(p);
    const before = await bal(s.tokenA, victim);
    const t = treeOf(snap);
    const descLeaf = t.leaves.find((l) => l.type === 1 && p.proofs.includes(keccak256(l.vdesc as Hex).slice(2)))!;
    const h = leafHash(descLeaf);
    const REG = parseAbi(["function digest(bytes32[]) view returns (bytes32)", "function revoke(bytes32[], bytes[])", "function isRevoked(bytes32) view returns (bool)"]);
    const d = await pub.readContract({ address: s.revocations, abi: REG, functionName: "digest", args: [[h]] });
    const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY"].map((k) => ({ k: key(k), a: privateKeyToAccount(key(k)).address })).sort((x, y) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
    const sigs = await Promise.all(signers.map((x) => privateKeyToAccount(x.k).sign({ hash: d })));
    await send(key("DEPLOYER_KEY"), s.revocations, encodeFunctionData({ abi: REG, functionName: "revoke", args: [[h], sigs] }), 0n, 500_000n);
    await sleep(7000);
    const { h: hash, r, res } = await land(tx);
    record({ id: "B10", title: "A leaf revoked while the transaction is pending", expected: "still admitted; execution refuses: LeafRevoked", pass: res.ok === false && /LeafRevoked/.test(res.err) && (await bal(s.tokenA, victim)) === before, outcome: "reverted-in-batch", txHash: hash, block: Number(r.blockNumber), message: res.err, frameGas: frameGas(r) });
  },
  async B11() {
    const p = await prep([transferCall(s.tokenA, victim, 1n)]);
    const tx = await sign(p);
    const f = tx.frames;
    // A3: a paymaster-path layout under a stateless signature. A7: expired. A7b: starved expiry frame.
    await reject("B11-A3", "Stateless: signing for one layout, sending another", "BadLayout", { ...tx, frames: [f[0], { ...f[1], flags: 2 }, f[2]] }, (m) => /BadLayout/.test(m));
    await sleep(1500);
    const now = (await pub.getBlock()).timestamp;
    const stale = await sign(await prep([transferCall(s.tokenA, victim, 1n)], { expiry: now + 8n }));
    while ((await pub.getBlock()).timestamp <= now + 10n) await sleep(2000);
    await reject("B11-A7", "Stateless: stale signature", "the expiry frame refuses it", stale, (m) => /frame 0/.test(m));
    await sleep(1500);
    const starved = await sign(await prep([transferCall(s.tokenA, victim, 1n)], { gas: { expiry: 2_000n, account: 85_300n, execute: 1_200_000n, executeState: 1_500_000n } }));
    await reject("B11-A7b", "Stateless: expiry frame starved of gas", "refused", starved, (m) => /BadLayout\(0x8\)|frame 0: ran out of gas/.test(m));
  },
  async B12() {
    const p = await prep([transferCall(s.tokenA, victim, 1n)]);
    const tx = await sign(p);
    const { h, res } = await land(tx);
    await sleep(7000);
    // The same bytes again. The node's nonce check speaks first if it may; the account's guard is what keys cannot get around.
    const d = p.digest;
    const consumed = await pub.readContract({ address: s.account, abi: ACCOUNT_ABI, functionName: "consumed", args: [d] });
    await reject("S-B12", "Stateless: the same signed content again", "refused", tx, (m) => m.length > 0);
    record({ id: "I13", title: "One digest executes at most once", expected: "consumed after landing", pass: res.ok === true && consumed === true, outcome: "mined", txHash: h });
  },
};

if (process.argv[2] === "measure") {
  const big = { expiry: 100_000n, account: 900_000n, execute: 2_000_000n, executeState: 1_500_000n };
  const rows: unknown[] = [];
  for (const [name, c] of [["transfer", transferCall(s.tokenA, victim, 1n)], ["approve (Permit2)", { target: s.tokenA, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [router.permit2, 5n] }) }], ["v4 swap (ETH in)", swap(s.poolEthHonest.key, 2_000_000n)], ["WRAP_ETH", { target: ROUTER, value: 1_000_000_000_000n, data: executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, 1_000_000_000_000n)], BigInt(Math.floor(Date.now() / 1000) + 600)) }]] as [string, Call][]) {
    const p = await prep([c], { gas: big });
    const tx = await sign(p);
    const sim = await simulate(tx);
    const used = sim.frames?.map((f: { gasUsed: string }) => parseInt(f.gasUsed, 16));
    console.log(name, used, "proofs", (p.proofs.length - 2) / 2, "bytes", "error", (sim.executionError ?? "").slice(0, 120), sim.revertData?.slice(0, 74));
    if (used) rows.push({ name, expiry: used[0], account: used[1], signatures: 11200, prefix: used[0] + used[1] + 11200, proofBytes: (p.proofs.length - 2) / 2 });
  }
  writeFileSync(resolve(ROOT, "docs/prefix-stateless.json"), JSON.stringify(rows, null, 1) + "\n");
  process.exit(0);
}

const want = process.argv.slice(2);
if ((await pub.getBalance({ address: s.account })) < parseEther("0.05")) await send(key("DEPLOYER_KEY"), s.account, "0x", parseEther("0.2"), 500_000n);
for (const [id, run] of Object.entries(steps)) {
  if (want.length && !want.includes(id)) continue;
  console.log("---", id);
  try {
    await run();
  } catch (e) {
    record({ id, title: id, expected: "", pass: false, outcome: "not-run", message: decodeRevert(String((e as Error).message)) });
  }
  await sleep(7000);
}

// The production leg on Sepolia: through two real bundlers, with the official Uniswap contracts and ENSv2 as the trust root.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeDeployData, encodeFunctionData, getAddress, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeTree, formatForDevice, packStr } from "@verbatim/displayvm-ts";
import { leafHash, treeOf, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { v4SwapCall } from "@verbatim/urrender";
import { ROOT, addr, key, loadEnv } from "./lib/env";
import { artifact } from "./lib/chain";
import { record } from "./lib/proofs";
import { ENS, RESOLVER_ABI, UNI, dnsName, namedKey, pub, readS, tx, wallet } from "./lib/sepolia";
import { buildOp, sendOp, waitOp, type Built } from "./lib/userop";
import { decodeRevert } from "./lib/results";

const env = loadEnv();
const s = readS();
const account: Address = s.account4337;
const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "deployments/snapshot-sepolia.json"), "utf8"));
const ERC20 = parseAbi(["function transfer(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const named = s["verbatim-demo"].nameAddress as Address;
const dUSDC = s.tokenA as Address;
const bal = (t: Address, a: Address) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });
const transfer = (to: Address, n: bigint) => ({ target: dUSDC, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, n] }) });
const show = (b: Built) => formatForDevice(decodeTree(b.tree)).forEach((l) => console.log("  ".repeat(l.indent) + l.text));
const ONE = parseEther("0.001");
const swap = (k: unknown, min: bigint) => ({ target: UNI.router, value: ONE, data: v4SwapCall({ key: k as never, zeroForOne: true, amountIn: ONE, amountOutMinimum: min, legacyParams: true }, BigInt(Math.floor(Date.now() / 1000) + 3600)) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const build = (calls: Parameters<typeof buildOp>[1], bundler: string, opts: Parameters<typeof buildOp>[4] = {}) => buildOp(account, calls, bundler, snap, opts);

async function submit(bundler: string, b: Built) {
  const h = await sendOp(bundler, b.op);
  const r = await waitOp(bundler, h);
  return { h, r, tx: r.receipt?.transactionHash as Hex };
}

const council = () => namedKey("ens-council");
const anchorDns = dnsName("verbatim-anchor.eth");
const anchorResolver = () => s["verbatim-anchor"].resolver as Address;
const allAttestors = () => ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr).map((a) => a.toLowerCase()).join(",");

const steps: Record<string, () => Promise<void>> = {
  async B_PIMLICO() {
    const before = await bal(dUSDC, named);
    const b = await build([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    show(b);
    const { r, tx: t } = await submit(env.BUNDLER_URL, b);
    const got = (await bal(dUSDC, named)) - before;
    const lines = formatForDevice(decodeTree(b.tree)).map((l) => l.text).join("\n");
    record({ id: "B-honest-pimlico", title: "Honest transfer on Sepolia via Pimlico, recipient shown by ENS name", expected: "bundler accepts; lands; delivered; name in the sentence", pass: r.success === true && got === 1_000_000n && /verbatim-demo\.eth \(/.test(lines), outcome: "mined", txHash: t, message: r.reason, extra: { actualGasUsed: String(BigInt(r.actualGasUsed)), bundler: "pimlico", sentence: lines } });
  },
  async B_ALCHEMY() {
    if (!env.ALCHEMY_BUNDLER_URL) throw new Error("ALCHEMY_BUNDLER_URL missing");
    const before = await bal(dUSDC, named);
    const b = await build([transfer(named, 1_000_000n)], env.ALCHEMY_BUNDLER_URL);
    const { r, tx: t } = await submit(env.ALCHEMY_BUNDLER_URL, b);
    record({ id: "B-honest-alchemy", title: "Honest transfer on Sepolia via Alchemy", expected: "bundler accepts; lands; delivered", pass: r.success === true && (await bal(dUSDC, named)) - before === 1_000_000n, outcome: "mined", txHash: t, extra: { actualGasUsed: String(BigInt(r.actualGasUsed)), bundler: "alchemy" } });
  },
  async B_SWAP() {
    const before = await bal(dUSDC, account);
    const b = await build([swap(s.poolEth.key, 2_000_000n)], env.BUNDLER_URL);
    show(b);
    const { r, tx: t } = await submit(env.BUNDLER_URL, b);
    const got = (await bal(dUSDC, account)) - before;
    record({ id: "B-swap", title: "v4 swap through Uniswap's official Sepolia Universal Router and PoolManager", expected: "lands; minimum output respected", pass: r.success === true && got >= 2_000_000n, outcome: "mined", txHash: t, extra: { actualGasUsed: String(BigInt(r.actualGasUsed)), got: String(got), bundler: "pimlico" } });
  },
  async B_LIE() {
    const honest = await build([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    const lie = await build([transfer(addr("ATTACKER_KEY"), 1_000_000n)], env.BUNDLER_URL, { expiry: honest.expiry, override: { tree: honest.tree, spec: honest.spec } });
    try {
      const h = await sendOp(env.BUNDLER_URL, lie.op);
      record({ id: "B-A1", title: "Swapped recipient under an honest sentence, on Sepolia", expected: "bundler rejects; TreeMismatch", pass: false, outcome: "mined", txHash: h, message: "was admitted" });
    } catch (e) {
      const msg = decodeRevert(JSON.stringify((e as any).data ?? (e as Error).message));
      record({ id: "B-A1", title: "Swapped recipient under an honest sentence, on Sepolia", expected: "bundler rejects; TreeMismatch", pass: /TreeMismatch|669a6fec/.test(msg) || /669a6fec/.test((e as Error).message), outcome: "rejected-at-mempool", message: msg.slice(0, 240) });
    }
  },
  async B13() {
    // Governance drops every attestor from the ENS record while an operation is on its way: validation is unaffected, execution refuses.
    const b = await build([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    const before = await bal(dUSDC, named);
    await tx({ address: anchorResolver(), abi: RESOLVER_ABI, functionName: "setText", args: [anchorDns, "attestors", "0x0000000000000000000000000000000000000001"] }, council());
    try {
      const { r, tx: t } = await submit(env.BUNDLER_URL, b);
      record({ id: "B13", title: "An attestor missing from the ENS anchor", expected: "admitted; the operation reverts at execution", pass: r.success === false && (await bal(dUSDC, named)) === before, outcome: "reverted-in-batch", txHash: t, message: r.reason });
    } finally {
      await tx({ address: anchorResolver(), abi: RESOLVER_ABI, functionName: "setText", args: [anchorDns, "attestors", allAttestors()] }, council());
    }
  },
  async B_ENS_REVOKED() {
    const b = await build([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    const before = await bal(dUSDC, named);
    const leaf = treeOf(snap).leaves.find((l) => l.type === 1 && b.proofs.includes(keccak256(l.vdesc as Hex).slice(2)))!;
    await tx({ address: anchorResolver(), abi: RESOLVER_ABI, functionName: "setText", args: [anchorDns, "revoked", leafHash(leaf)] }, council());
    try {
      const { r, tx: t } = await submit(env.BUNDLER_URL, b);
      record({ id: "B-ens-revoked", title: "A leaf revoked by ENS record while the operation is pending", expected: "admitted; reverts at execution", pass: r.success === false && (await bal(dUSDC, named)) === before, outcome: "reverted-in-batch", txHash: t, message: r.reason });
    } finally {
      await tx({ address: anchorResolver(), abi: RESOLVER_ABI, functionName: "setText", args: [anchorDns, "revoked", ""] }, council());
    }
  },
  async A8() {
    // A lookalike name, registered and pointing at the attacker, without renouncing its root roles.
    const label = "verbatim-dem0";
    const state = readS()[label];
    if (!state?.registered) throw new Error("run: tsx legb-ens.ts verbatim-dem0 --no-lock");
    const name = `${label}.eth`;
    const vdesc = ("0x5644000105" + Buffer.from("Spoof").toString("hex") + "ff000000" + "00") as Hex;
    const a = artifact("EnsTrustChecker.sol", "EnsTrustChecker");
    const check = encodeFunctionData({ abi: a.abi, functionName: "check", args: [packStr(name), keccak256(vdesc)] });
    const revertOf = async (to: Address) => {
      try {
        await pub.call({ to, data: check });
        return "";
      } catch (e) {
        return decodeRevert(String((e as Error).message));
      }
    };
    // (1) Its claim fails the exclusivity proof the anchor applies: another resolver's code.
    const refused = /WrongResolverCode|0x0530a4cb|Execution reverted/i.test(await revertOf(s.checker));
    // (1b) Pin its own code instead, and the proof still refuses: it kept its root roles.
    const { council: c } = { council: privateKeyToAccount(namedKey("ens-council")).address };
    const w = wallet();
    await tx({ address: state.resolver, abi: RESOLVER_ABI, functionName: "setText", args: [dnsName(name), "clear-signing", keccak256(vdesc)] });
    const lookCode = keccak256((await pub.getCode({ address: state.resolver })) as Hex);
    const dh = await w.sendTransaction({ data: encodeDeployData({ abi: a.abi, bytecode: a.creation, args: [ENS.root, ENS.ethRegistry, ENS.universalResolver, lookCode, c, 365n * 24n * 3600n] }), account: w.account!, chain: w.chain, gas: 8_000_000n });
    const dr = await pub.waitForTransactionReceipt({ hash: dh, timeout: 180_000 });
    const direct = await revertOf(dr.contractAddress as Address);
    const exclusive = direct.length > 0;
    // (2) It is not in the snapshot, so a sentence paying its address shows hex.
    const b = await build([transfer(getAddress(state.nameAddress), 1n)], env.BUNDLER_URL);
    const lines = formatForDevice(decodeTree(b.tree)).map((l) => l.text);
    const toLine = lines.find((l) => l.startsWith("To:")) ?? "";
    record({ id: "A8", title: "Lookalike ENS name", expected: "not in the snapshot, so hex is shown; the exclusivity proof refuses it", pass: refused && exclusive && !/\.eth/.test(toLine), outcome: "rejected-at-mempool", message: `${direct.slice(0, 160)} | ${toLine}` });
  },
};

const want = process.argv.slice(2);
for (const [id, run] of Object.entries(steps)) {
  if (want.length && !want.includes(id)) continue;
  console.log("---", id);
  try {
    await run();
  } catch (e) {
    record({ id, title: id, expected: "", pass: false, outcome: "not-run", message: decodeRevert(String((e as Error).message)).slice(0, 300) });
  }
  await sleep(4000);
}

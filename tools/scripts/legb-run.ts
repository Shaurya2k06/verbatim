// Leg B on Sepolia: through two real bundlers, with the official Uniswap contracts and ENSv2 names in the sentence.
import { keccak256 as keccak256Hex, encodeFunctionData, getAddress, hexToBigInt, parseAbi, parseEther, type Address, type Hex } from "viem";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { v4SwapCall } from "@verbatim/urrender";
import { loadEnv } from "./lib/env";
import { record } from "./lib/proofs";
import { ENTRY_POINT, UNI, pub, readS, wallet } from "./lib/sepolia";
import { buildOp, rawRevert, sendOp, waitOp, type Built } from "./lib/userop";
import { decodeRevert } from "./lib/results";

const env = loadEnv();
const s = readS();
const ERC20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)", "function allowance(address, address, address) view returns (uint160, uint48, uint48)"]);
const named = s["verbatim-demo"].nameAddress as Address;
const dUSDC = s.tokenA as Address;
const dWETH = s.tokenB as Address;
const bal = (t: Address, a: Address) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });
const transfer = (to: Address, n: bigint) => ({ target: dUSDC, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, n] }) });
const show = (b: Built) => formatForDevice(decodeTree(b.tree)).forEach((l) => console.log("  ".repeat(l.indent) + l.text));

async function submit(bundler: string, b: Built) {
  const h = await sendOp(bundler, b.op);
  const r = await waitOp(bundler, h);
  return { h, r, tx: r.receipt?.transactionHash as Hex };
}

const vdescHash = (v: Hex): Hex => keccak256Hex(v);

const steps: Record<string, () => Promise<void>> = {
  async B_PIMLICO() {
    const before = await bal(dUSDC, named);
    const b = await buildOp([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    show(b);
    const { r, tx } = await submit(env.BUNDLER_URL, b);
    const got = (await bal(dUSDC, named)) - before;
    record({ id: "B-honest-pimlico", title: "Honest transfer on Sepolia via Pimlico, recipient shown by ENS name", expected: "bundler accepts; lands; delivered", pass: r.success === true && got === 1_000_000n, outcome: "mined", txHash: tx, block: Number(r.receipt.blockNumber), extra: { actualGasUsed: String(BigInt(r.actualGasUsed)), bundler: "pimlico" } });
  },
  async B_ALCHEMY() {
    const before = await bal(dUSDC, named);
    const b = await buildOp([transfer(named, 1_000_000n)], env.BUNDLER_URL_2);
    const { r, tx } = await submit(env.BUNDLER_URL_2, b);
    const got = (await bal(dUSDC, named)) - before;
    record({ id: "B-honest-alchemy", title: "Honest transfer on Sepolia via Alchemy", expected: "bundler accepts; lands; delivered", pass: r.success === true && got === 1_000_000n, outcome: "mined", txHash: tx, block: Number(r.receipt.blockNumber), extra: { actualGasUsed: String(BigInt(r.actualGasUsed)), bundler: "alchemy" } });
  },
  async B_SETUP() {
    const allowed = await pub.readContract({ address: dWETH, abi: ERC20, functionName: "allowance", args: [s.account, UNI.permit2] });
    if (allowed === 0n) {
      const b = await buildOp([{ target: dWETH, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [UNI.permit2, parseEther("1000")] }) }], env.BUNDLER_URL);
      const { r, tx } = await submit(env.BUNDLER_URL, b);
      console.log("approve(Permit2)", tx, r.success);
    }
    const [amt] = await pub.readContract({ address: UNI.permit2, abi: P2, functionName: "allowance", args: [s.account, dWETH, UNI.router] });
    if (amt < parseEther("20")) {
      const b = await buildOp([{ target: UNI.permit2, value: 0n, data: encodeFunctionData({ abi: P2, functionName: "approve", args: [dWETH, UNI.router, parseEther("500"), 2 ** 47] }) }], env.BUNDLER_URL);
      show(b);
      const { r, tx } = await submit(env.BUNDLER_URL, b);
      console.log("permit2.approve(UR)", tx, r.success);
    }
  },
  async B_SWAP() {
    const k = s.pool.key;
    const zeroForOne = k.currency0.toLowerCase() === dWETH.toLowerCase();
    const before = await bal(dUSDC, s.account);
    const min = 2_000_000_000n;
    const c = { target: UNI.router, value: 0n, data: v4SwapCall({ key: k, zeroForOne, amountIn: parseEther("1"), amountOutMinimum: min, legacyParams: true }, BigInt(Math.floor(Date.now() / 1000) + 3600)) };
    const b = await buildOp([c], env.BUNDLER_URL);
    show(b);
    const { r, tx } = await submit(env.BUNDLER_URL, b);
    const got = (await bal(dUSDC, s.account)) - before;
    record({ id: "B-swap", title: "v4 swap through Uniswap's official Sepolia Universal Router and PoolManager", expected: "bundler accepts; lands; min out respected", pass: r.success === true && got >= min, outcome: "mined", txHash: tx, block: Number(r.receipt.blockNumber), extra: { receivedRaw: String(got), actualGasUsed: String(BigInt(r.actualGasUsed)) } });
  },
  async B_LIE() {
    const honest = await buildOp([transfer(named, 1_000_000n)], env.BUNDLER_URL);
    const thief = "0x000000000000000000000000000000000000bad1" as Address;
    const lie = await buildOp([transfer(thief, 1_000_000n)], env.BUNDLER_URL, { validUntil: honest.validUntil, override: { tree: honest.tree, spec: honest.spec } });
    // Bundlers surface this only as an opaque error, so ask the paymaster itself, called as the EntryPoint would.
    const op = lie.op as any;
    const packed = {
      sender: op.sender, nonce: hexToBigInt(op.nonce), initCode: "0x" as Hex, callData: op.callData,
      accountGasLimits: `0x${hexToBigInt(op.verificationGasLimit).toString(16).padStart(32, "0")}${hexToBigInt(op.callGasLimit).toString(16).padStart(32, "0")}` as Hex,
      preVerificationGas: hexToBigInt(op.preVerificationGas),
      gasFees: `0x${hexToBigInt(op.maxPriorityFeePerGas).toString(16).padStart(32, "0")}${hexToBigInt(op.maxFeePerGas).toString(16).padStart(32, "0")}` as Hex,
      paymasterAndData: `${op.paymaster}${hexToBigInt(op.paymasterVerificationGasLimit).toString(16).padStart(32, "0")}${hexToBigInt(op.paymasterPostOpGasLimit).toString(16).padStart(32, "0")}${op.paymasterData.slice(2)}` as Hex,
      signature: op.signature,
    };
    const VALIDATE = parseAbi(["struct Op { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }", "function validatePaymasterUserOp(Op op, bytes32 hash, uint256 maxCost) returns (bytes, uint256)"]);
    const reason = await rawRevert(ENTRY_POINT, s.paymaster, encodeFunctionData({ abi: VALIDATE, functionName: "validatePaymasterUserOp", args: [packed, lie.hash, 0n] }));
    let bundlerMsg = "";
    try {
      const h = await sendOp(env.BUNDLER_URL, lie.op);
      bundlerMsg = `admitted ${h}`;
    } catch (e) {
      bundlerMsg = (e as Error).message;
    }
    const rejected = !bundlerMsg.startsWith("admitted") && /669a6fec|TreeMismatch/.test(reason);
    record({ id: "B-A1", title: "Swapped recipient under an honest sentence, on Sepolia", expected: "bundler rejects; paymaster reverts TreeMismatch", pass: rejected, outcome: "rejected-at-mempool", message: decodeRevert(reason).slice(0, 300), extra: { bundler: bundlerMsg.slice(0, 200) } });
  },
  async A8() {
    // A lookalike name, registered and pointing at the attacker, without renouncing its root roles.
    const label = "verbatim-dem0";
    const state = readS()[label];
    if (!state?.registered) throw new Error("run: tsx legb-ens.ts verbatim-dem0 --no-lock");
    const name = `${label}.eth`;
    // (1) Its descriptor claim fails the exclusivity proof at refresh.
    const { attest, emptyUpdate } = await import("./lib/trust-update");
    const { packStr } = await import("@verbatim/displayvm-ts");
    const { keccak256 } = await import("viem");
    const tokenCode = keccak256((await pub.getCode({ address: dUSDC })) as Hex);
    const u = emptyUpdate(BigInt(Date.now()));
    const selector = "0xdeadbeef" as Hex;
    const vdesc = ("0x5644000105" + Buffer.from("Spoof").toString("hex") + "ff000000" + "00") as Hex;
    u.descriptors = [{ codehash: tokenCode, selector, vdesc, publisher: packStr(name) }];
    let refreshMsg = "";
    await attest(s.paymaster, u, 11155111n, async (data: Hex) => {
      refreshMsg = await rawRevert(wallet().account!.address, s.paymaster, data);
      return null as never;
    });
    refreshMsg = decodeRevert(refreshMsg);
    const refused = /WrongResolverCode/.test(refreshMsg);
    // (1b) Pin its own code instead, and the exclusivity proof itself still refuses: it kept its root roles.
    const { artifact } = await import("./lib/chain");
    const { encodeDeployData } = await import("viem");
    const a = artifact("EnsTrustChecker.sol", "EnsTrustChecker");
    const { ENS } = await import("./lib/sepolia");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { namedKey } = await import("./lib/sepolia");
    const council = privateKeyToAccount(namedKey("ens-council")).address;
    // The attacker publishes a record claiming the descriptor, which it can: it never gave up its roles.
    const { RESOLVER_ABI, dnsName, tx } = await import("./lib/sepolia");
    await tx({ address: state.resolver, abi: RESOLVER_ABI, functionName: "setText", args: [dnsName(name), "clear-signing", vdescHash(vdesc)] });
    const lookCode = keccak256((await pub.getCode({ address: state.resolver })) as Hex);
    const w = wallet();
    const dh = await w.sendTransaction({ data: encodeDeployData({ abi: a.abi, bytecode: a.creation, args: [ENS.root, ENS.ethRegistry, ENS.universalResolver, lookCode, council, 365n * 24n * 3600n] }), account: w.account!, chain: w.chain, gas: 15_000_000n });
    const dr = await pub.waitForTransactionReceipt({ hash: dh, timeout: 180_000 });
    const direct = decodeRevert(await rawRevert(w.account!.address, dr.contractAddress as Address, encodeFunctionData({ abi: a.abi, functionName: "check", args: [packStr(name), vdescHash(vdesc)] })));
    const exclusive = /RootRolesHeld/.test(direct);
    // (2) It is not in the name cache, so a sentence paying its address shows hex.
    const b = await buildOp([transfer(getAddress(state.nameAddress), 1n)], env.BUNDLER_URL);
    const lines = formatForDevice(decodeTree(b.tree)).map((l) => l.text);
    const toLine = lines.find((l) => l.startsWith("To:")) ?? "";
    record({ id: "A8", title: "Lookalike ENS name", expected: "name not in the cache, so hex is shown; the exclusivity check fails at refresh", pass: refused && exclusive && !/\.eth/.test(toLine) && /0x[0-9a-f]{40}/.test(toLine), outcome: "rejected-at-mempool", message: refreshMsg.slice(0, 200), extra: { deviceLine: toLine, lookalike: name, sameCodeChecker: dr.contractAddress, sameCodeResult: direct.slice(-120) } });
  },
};

const want = process.argv.slice(2);
for (const [id, run] of Object.entries(steps)) {
  if (want.length && !want.includes(id)) continue;
  console.log("---", id);
  try {
    await run();
  } catch (e) {
    const err = e as any;
    record({ id, title: id, expected: "", pass: false, outcome: "not-run", message: decodeRevert(`${err.message} ${JSON.stringify(err.data ?? "")}`).slice(0, 900) });
  }
}

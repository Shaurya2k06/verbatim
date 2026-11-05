// G3 on the devnet: Permit2 setup, honest v4 swap through the real Universal Router, and attack A2.
import { encodeFunctionData, parseAbi, parseEther, type Address, type Hex } from "viem";
import { RpcError, simulate, submit, waitReceipt } from "@verbatim/frames-sdk";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { v4SwapCall, executeData, wrapInput, MSG_SENDER, CMD } from "@verbatim/urrender";
import { readState, writeState, addr, key } from "./lib/env";
import { pub, send } from "./lib/chain";
import { ERC20, prepareTx, sign, state } from "./lib/verbatim";
import { record } from "./lib/proofs";
import { batchResult, decodeRevert, frameGas } from "./lib/results";

const s = state();
const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH9: Address = "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6";
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)", "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bal = (t: Address, a: Address) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });

const dWETH = s.tokenB as Address;
const dUSDC = s.tokenA as Address;
const honest = s.poolHonest.key;
const evil = s.poolEvil.key;
const zeroForOne = honest.currency0.toLowerCase() === dWETH.toLowerCase();
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const ONE = parseEther("1");

const swapCall = (key: unknown, amountOutMinimum: bigint) => ({ target: ROUTER, value: 0n, data: v4SwapCall({ key: key as never, zeroForOne, amountIn: ONE, amountOutMinimum }, deadline) });

async function setup() {
  const allowance = await pub.readContract({ address: dWETH, abi: ERC20, functionName: "allowance", args: [s.account, PERMIT2] });
  if (allowance === 0n) {
    const c = { target: dWETH, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, parseEther("1000")] }) };
    const tx = await sign(await prepareTx([c]));
    const h = await submit(tx);
    const r = await waitReceipt(h);
    console.log("token.approve(Permit2)", h, batchResult(r, s.account));
    await sleep(7000);
  }
  const [p2Amt] = await pub.readContract({ address: PERMIT2, abi: P2, functionName: "allowance", args: [s.account, dWETH, ROUTER] });
  if (p2Amt < ONE * 20n) {
    const c = { target: PERMIT2, value: 0n, data: encodeFunctionData({ abi: P2, functionName: "approve", args: [dWETH, ROUTER, parseEther("500"), 2 ** 47] }) };
    const p = await prepareTx([c]);
    const tx = await sign(p);
    const h = await submit(tx);
    const r = await waitReceipt(h);
    console.log("permit2.approve(UR)", h, batchResult(r, s.account), frameGas(r));
    await sleep(7000);
  }
}

async function measure() {
  const p = await prepareTx([swapCall(honest, parseEther("2000") / 10n ** 12n)], { gas: { frame0: 300_000n, frame1: 900_000n, frame2: 2_000_000n, frame2State: 1_500_000n } });
  for (const l of formatForDevice(decodeTree(p.tree))) console.log("  ".repeat(l.indent) + l.text);
  const sim = await simulate(await sign(p));
  console.log("measured swap frames", sim.frames?.map((f: any) => parseInt(f.gasUsed, 16)), "err", sim.executionError, sim.revertData);
  return sim.frames ? parseInt(sim.frames[1].gasUsed, 16) : null;
}

const steps: Record<string, () => Promise<void>> = {
  async SWAP() {
    const before = await bal(dUSDC, s.account);
    const wethBefore = await bal(dWETH, s.account);
    const min = 2_000_000_000n; // 2000 dUSDC, pool price is near 3000
    const p = await prepareTx([swapCall(honest, min)]);
    for (const l of formatForDevice(decodeTree(p.tree))) console.log("  ".repeat(l.indent) + l.text);
    const h = await submit(await sign(p));
    const r = await waitReceipt(h);
    const res = batchResult(r, s.account);
    const got = (await bal(dUSDC, s.account)) - before;
    const paid = wethBefore - (await bal(dWETH, s.account));
    record({ id: "SWAP", title: "Honest v4 swap through the real Universal Router", expected: "admitted, mined, min out respected", pass: res.ok === true && got >= min && paid === ONE, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), message: res.err, extra: { receivedRaw: String(got), paidRaw: String(paid) } });
  },
  async WRAP() {
    const amount = 1_000_000_000_000n;
    if ((await pub.getBalance({ address: s.account })) < amount * 10n) await send(key("DEPLOYER_KEY"), s.account, "0x", parseEther("0.001"), 500_000n);
    const before = await bal(WETH9, s.account);
    const c = { target: ROUTER, value: amount, data: executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, amount)], deadline) };
    const p = await prepareTx([c]);
    for (const l of formatForDevice(decodeTree(p.tree))) console.log("  ".repeat(l.indent) + l.text);
    const h = await submit(await sign(p));
    const r = await waitReceipt(h);
    const res = batchResult(r, s.account);
    record({ id: "WRAP", title: "WRAP_ETH through the real Universal Router", expected: "admitted, mined, exact WETH delta", pass: res.ok === true && (await bal(WETH9, s.account)) - before === amount, outcome: "mined", txHash: h, block: Number(r.blockNumber), frameGas: frameGas(r), message: res.err });
  },
  async EOA_SKIM() {
    const eoaKey = key("ATTACKER_KEY");
    const eoa = addr("ATTACKER_KEY");
    // A separate plain EOA plays the victim on an ordinary wallet; the hook's beneficiary is checked by balance.
    const victimKey = key("OWNER3_KEY");
    const victim = addr("OWNER3_KEY");
    if ((await pub.getBalance({ address: victim })) < parseEther("0.002")) await send(key("DEPLOYER_KEY"), victim, "0x", parseEther("0.01"), 500_000n);
    await send(key("DEPLOYER_KEY"), dWETH, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [victim, ONE] }));
    await send(victimKey, dWETH, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, ONE] }), 0n, 500_000n);
    await send(victimKey, PERMIT2, encodeFunctionData({ abi: P2, functionName: "approve", args: [dWETH, ROUTER, ONE, 2 ** 47] }), 0n, 500_000n);
    const before = await bal(dUSDC, victim);
    const thiefBefore = await bal(dUSDC, eoa);
    const r = await send(victimKey, ROUTER, v4SwapCall({ key: evil, zeroForOne, amountIn: ONE, amountOutMinimum: 0n }, deadline), 0n, 3_000_000n);
    const got = (await bal(dUSDC, victim)) - before;
    const stolen = (await bal(dUSDC, eoa)) - thiefBefore;
    void eoaKey;
    record({ id: "A2-eoa", title: "Same evil route on an ordinary wallet", expected: "the skim works: this is what Verbatim prevents", pass: stolen > got * 50n, outcome: "mined", txHash: r.transactionHash, block: Number(r.blockNumber), extra: { victimReceivedRaw: String(got), hookTookRaw: String(stolen) } });
  },
  async A2() {
    // The frontend shows "at least 2000 dUSDC" on the honest pool and routes minOut = 0 through SkimHook.
    const shown = await prepareTx([swapCall(honest, 2_000_000_000n)]);
    const lie = await prepareTx([swapCall(evil, 0n)], { validUntil: shown.validUntil, overrideSentence: { tree: shown.tree, spec: shown.spec } });
    try {
      const h = await submit(await sign(lie));
      record({ id: "A2", title: "minOut=0 via SkimHook under an honest sentence", expected: "mempool reject (tree mismatch)", pass: false, outcome: "mined", txHash: h });
    } catch (e) {
      const msg = decodeRevert((e as RpcError).message);
      record({ id: "A2", title: "minOut=0 via SkimHook under an honest sentence", expected: "mempool reject (tree mismatch)", pass: /TreeMismatch/.test(msg), outcome: "rejected-at-mempool", message: msg });
    }
    await sleep(2000);
    // The device shows the truth, and the owner signs anyway: policy still refuses.
    const truth = await prepareTx([swapCall(evil, 0n)]);
    const lines = formatForDevice(decodeTree(truth.tree)).filter((l) => l.risk).map((l) => l.text);
    console.log("device shows", lines);
    try {
      const h = await submit(await sign(truth));
      record({ id: "A2b", title: "User signs the true SkimHook sentence", expected: "policy rejects", pass: false, outcome: "mined", txHash: h });
    } catch (e) {
      const msg = decodeRevert((e as RpcError).message);
      record({ id: "A2b", title: "User signs the true SkimHook sentence", expected: "policy rejects", pass: /PolicyRefused/.test(msg), outcome: "rejected-at-mempool", message: msg, extra: { deviceRiskLines: lines } });
    }
  },
};

await setup();
const want = process.argv.slice(2);
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
void simulate; void measure; void readState; void writeState;

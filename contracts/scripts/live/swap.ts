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
// Native-ETH pools: ETH in, no approval to leave behind (D9).
const honest = s.poolEthHonest.key;
const evil = s.poolEthEvil.key;
const zeroForOne = true;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const ONE = parseEther("0.001");
const MIN = 2_000_000n; // 2 dUSDC; the pool price is near 3000

const swapCall = (key: unknown, amountOutMinimum: bigint) => ({ target: ROUTER, value: ONE, data: v4SwapCall({ key: key as never, zeroForOne, amountIn: ONE, amountOutMinimum }, deadline) });

async function setup() {
  if ((await pub.getBalance({ address: s.account })) < parseEther("0.01")) await send(key("DEPLOYER_KEY"), s.account, "0x", parseEther("0.02"), 500_000n);
}

const steps: Record<string, () => Promise<void>> = {
  async SWAP() {
    const before = await bal(dUSDC, s.account);
    const ethBefore = await pub.getBalance({ address: s.account });
    const min = MIN;
    const p = await prepareTx([swapCall(honest, min)]);
    for (const l of formatForDevice(decodeTree(p.tree))) console.log("  ".repeat(l.indent) + l.text);
    const h = await submit(await sign(p));
    const r = await waitReceipt(h);
    const res = batchResult(r, s.account);
    const got = (await bal(dUSDC, s.account)) - before;
    const paid = ethBefore - (await pub.getBalance({ address: s.account }));
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
    if ((await pub.getBalance({ address: victim })) < parseEther("0.003")) await send(key("DEPLOYER_KEY"), victim, "0x", parseEther("0.01"), 500_000n);
    const before = await bal(dUSDC, victim);
    const thiefBefore = await bal(dUSDC, eoa);
    const r = await send(victimKey, ROUTER, v4SwapCall({ key: evil, zeroForOne, amountIn: ONE, amountOutMinimum: 0n }, deadline), ONE, 3_000_000n);
    const got = (await bal(dUSDC, victim)) - before;
    const stolen = (await bal(dUSDC, eoa)) - thiefBefore;
    void eoaKey;
    record({ id: "A2-eoa", title: "Same evil route on an ordinary wallet", expected: "the skim works: this is what Verbatim prevents", pass: stolen > got * 50n, outcome: "mined", txHash: r.transactionHash, block: Number(r.blockNumber), extra: { victimReceivedRaw: String(got), hookTookRaw: String(stolen) } });
  },
  async A2() {
    // The frontend shows "at least 2000 dUSDC" on the honest pool and routes minOut = 0 through SkimHook.
    const shown = await prepareTx([swapCall(honest, MIN)]);
    const lie = await prepareTx([swapCall(evil, 0n)], { expiry: shown.expiry, overrideSentence: { tree: shown.tree, spec: shown.spec } });
    try {
      const h = await submit(await sign(lie));
      record({ id: "A2", title: "minOut=0 via SkimHook under an honest sentence", expected: "mempool reject: the render differs from what was signed", pass: false, outcome: "mined", txHash: h });
    } catch (e) {
      const msg = decodeRevert((e as RpcError).message);
      record({ id: "A2", title: "minOut=0 via SkimHook under an honest sentence", expected: "mempool reject: the render differs from what was signed", pass: /TreeMismatch|SpecHashMismatch/.test(msg), outcome: "rejected-at-mempool", message: msg });
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
void simulate; void readState; void writeState; void P2; void PERMIT2; void dWETH; void encodeFunctionData;

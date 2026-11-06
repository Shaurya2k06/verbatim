// The public demo: a fixed list of cases that really run on Sepolia, one at a time, against the deployed account and Uniswap's
// official contracts. Nothing here simulates a result. Every outcome is what the bundler, the account or a receipt returned, and
// a case that does not behave as expected reports that.
//
// This file signs as the owners, using OWNER1_KEY and OWNER2_KEY, because a visitor has no owner key. So the rule that keeps it
// safe: the server builds every operation from the definitions below. A request only names a case, and nothing a visitor sends
// reaches what gets signed. The account is testnet only.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError, ContractFunctionRevertedError, concat, createPublicClient, createWalletClient, decodeAbiParameters, decodeErrorResult, encodeFunctionData, formatEther, formatUnits, http, keccak256, pad, parseAbi, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ERRORS as KIT_ERRORS, EXPLAIN } from "@verbatim/app-kit/errors";
import { packedUniswap, prepareUserOp, userOpWithSignatures } from "@verbatim/client";
import { decodeTree, specOf } from "@verbatim/displayvm-ts";
import { review, typedData } from "@verbatim/signer";
import { CMD, executeData, v4ExactInSingleInput, v4SwapCall } from "@verbatim/urrender";
import { HttpError, dep, forward, limit, need, snapshot } from "./app.js";

const ACCOUNT_ABI = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../client/src/lib/abi/VerbatimAccount4337.json"), "utf8"));
const ERRORS = [...ACCOUNT_ABI.filter((x) => x.type === "error"), ...KIT_ERRORS.filter((e) => !ACCOUNT_ABI.some((x) => x.type === "error" && x.name === e.name))];
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const PERMIT2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)", "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)"]);
const HOOK = parseAbi(["function ATTACKER() view returns (address)"]);
const EP = parseAbi(["function getNonce(address,uint192) view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const QUOTER = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const VERBATIM_RESULT = keccak256(toHex("VerbatimResult(bool,bytes)"));
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const EXPLORER = "https://sepolia.etherscan.io";

// Small on purpose: the demo wallets are funded by hand, and a swap's size changes nothing about what it proves.
const SWAP_IN = parseEther("0.0001");
const ONE_USDC = 1_000_000n;
const MIN_ACCOUNT_ETH = parseEther("0.005");
const MIN_EOA_ETH = SWAP_IN + parseEther("0.0005");
const RUNS_PER_HOUR = 60;
const MAX_QUEUE = 10;
const KEEP_RUNS = 200;
const SECONDS_PAST_EXPIRY = 15n;

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const transferCall = (token, to, amount) => ({ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] }) });
const swapCall = (d, key, minOut) => ({
  target: d.uniswap.router,
  value: SWAP_IN,
  data: v4SwapCall({ key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: minOut, legacyParams: !!d.uniswap.routerLegacyParams }, BigInt(Math.floor(Date.now() / 1000) + 3600)),
});

const dusdcOf = (who, label) => ({ label, unit: "dUSDC", read: (x) => x.pub.readContract({ address: x.d.tokens.dUSDC, abi: ERC20, functionName: "balanceOf", args: [who(x)] }), format: (n) => formatUnits(n, 6) });
const NONCE = { label: "Account nonce", unit: "", read: (x) => x.pub.readContract({ address: x.d.entryPoint, abi: EP, functionName: "getNonce", args: [x.d.account, 0n] }), format: (n) => n.toString() };
const recipient = dusdcOf((x) => x.d.ens.recipient, "Recipient balance");
const thief = dusdcOf((x) => x.attacker, "Attacker balance");
const treasury = dusdcOf((x) => x.d.account, "Account balance");
const ALLOWANCE = {
  label: "Router allowance through Permit2",
  unit: "dUSDC",
  read: async (x) => (await x.pub.readContract({ address: x.d.uniswap.permit2, abi: PERMIT2, functionName: "allowance", args: [x.d.account, x.d.tokens.dUSDC, x.d.uniswap.router] }))[0],
  format: (n) => formatUnits(n, 6),
};

export const SUITES = [
  {
    id: "honest",
    title: "Honest transactions land",
    summary: "Nothing is being attacked here. The chain renders the same sentence the owners signed, and the transaction goes through.",
    cases: [
      { id: "honest-transfer", proof: "B-honest-pimlico", title: "Send 1 dUSDC", plain: "A transfer to verbatim-demo.eth, with the name shown in the sentence.", expect: { kind: "landed" }, watch: [recipient, NONCE], build: (x) => ({ calls: [transferCall(x.d.tokens.dUSDC, x.d.ens.recipient, ONE_USDC)] }) },
      { id: "honest-swap", proof: "B-swap", title: "Swap 0.0001 ETH on Uniswap v4", plain: "Through Uniswap’s official Sepolia router, at a minimum output 1% under a fresh quote.", expect: { kind: "landed" }, watch: [treasury, NONCE], build: (x) => ({ calls: [swapCall(x.d, x.d.pools.eth.key, x.minOut)] }) },
    ],
  },
  {
    id: "tampered",
    title: "A tampered frontend",
    summary: "The owners sign what the page shows them, and the page sends something else. This is the Bybit class of attack.",
    cases: [
      { id: "tampered-recipient", proof: "B-A1", title: "Swap the recipient", plain: "The owners approve a payment to verbatim-demo.eth. The calldata pays the attacker.", expect: { kind: "rejected", name: "TreeMismatch" }, watch: [thief, NONCE], build: (x) => ({ calls: [transferCall(x.d.tokens.dUSDC, x.attacker, ONE_USDC)], lie: { calls: [transferCall(x.d.tokens.dUSDC, x.d.ens.recipient, ONE_USDC)] } }) },
      { id: "tampered-swap", proof: "A2", title: "Reroute the swap", plain: "The page shows an honest swap. The calldata goes through a hook that takes the output, with a minimum of 0.", expect: { kind: "rejected", name: "TreeMismatch" }, watch: [thief, NONCE], build: (x) => ({ calls: [swapCall(x.d, x.d.pools.ethEvil.key, 0n)], lie: { calls: [swapCall(x.d, x.d.pools.eth.key, x.minOut)] } }) },
      { id: "weaker-spec", proof: "A4", title: "Empty the assertions", plain: "The sentence is honest, but the assertions sent with it have been removed.", expect: { kind: "rejected", name: "SignersNotSortedOrUnknown" }, watch: [recipient, NONCE], build: (x) => ({ calls: [transferCall(x.d.tokens.dUSDC, x.d.ens.recipient, ONE_USDC)], weakenSpec: true }) },
    ],
  },
  {
    id: "skim",
    title: "The same skim, two wallets",
    summary: "One swap through a hook that takes the output. First from an ordinary wallet, which signs calldata. Then from Verbatim, where the device shows the risk and the account refuses.",
    cases: [
      { id: "ordinary-wallet", proof: "B-A2-eoa", title: "Ordinary wallet", plain: "A throwaway wallet sends the route with a minimum output of 0. It has no way to object.", expect: { kind: "skimmed" }, eoa: true },
      { id: "skim-true", proof: "B-A2b", title: "Verbatim, on the true sentence", plain: "The same route, and the owners sign the true sentence with its risk lines.", expect: { kind: "rejected", name: "PolicyRefused" }, watch: [thief, NONCE], build: (x) => ({ calls: [swapCall(x.d, x.d.pools.ethEvil.key, 0n)] }) },
    ],
  },
  {
    id: "refused",
    title: "True sentences the policy refuses",
    summary: "Nobody lies here. The sentence says exactly what the transaction does, and that is why the account says no.",
    cases: [
      { id: "unattested", proof: "A5", title: "Call an unattested contract", plain: "A contract nobody has attested, called with data no descriptor explains.", expect: { kind: "rejected", name: "PolicyRefused" }, watch: [NONCE], build: (x) => ({ calls: [{ target: x.d.skimHook, value: 0n, data: "0xdeadbeef" }] }) },
      { id: "allow-revert", proof: "A16", title: "Allow a router command to fail", plain: "A swap flagged so it may fail silently while the rest of the batch runs.", expect: { kind: "rejected", name: "PolicyRefused" }, watch: [NONCE], build: (x) => ({ calls: [{ target: x.d.uniswap.router, value: SWAP_IN, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [v4ExactInSingleInput({ key: x.d.pools.eth.key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: x.minOut, legacyParams: true })], deadline()) }] }) },
      { id: "unknown-command", proof: "A17", title: "Use an unknown router command", plain: "A router command no descriptor explains, here a gasless permit.", expect: { kind: "rejected", name: "PolicyRefused" }, watch: [NONCE], build: (x) => ({ calls: [{ target: x.d.uniswap.router, value: 0n, data: executeData([0x0a], ["0x1234"], deadline()) }] }) },
    ],
  },
  {
    id: "stale",
    title: "Signatures that overstay",
    summary: "A signature is only good for a short window, so one held back or dated far ahead does not work later.",
    cases: [
      { id: "stale-signature", proof: "A7", title: "Send after the expiry", plain: "The host holds a signed operation until it has expired, then sends it. This one takes about 30 seconds.", expect: { kind: "rejected" }, watch: [recipient, NONCE], validity: 20, holdUntilExpired: true, build: (x) => ({ calls: [transferCall(x.d.tokens.dUSDC, x.d.ens.recipient, ONE_USDC)] }) },
      { id: "future-expiry", proof: "A13", title: "Date the expiry far ahead", plain: "A signature that stays valid for hours. The device refuses to sign it, so the owners here sign anyway, the way a compromised device would.", expect: { kind: "reverted", name: "TtlTooLong" }, watch: [recipient, NONCE], validity: 6 * 3600, signAnyway: true, build: (x) => ({ calls: [transferCall(x.d.tokens.dUSDC, x.d.ens.recipient, ONE_USDC)] }) },
    ],
  },
  {
    id: "promises",
    title: "Promises checked after the calls",
    summary: "The operation is admitted and mined. Then the account checks what the sentence guaranteed, and undoes everything if it does not hold.",
    cases: [
      { id: "standing-approval", proof: "B14", title: "Leave an approval standing", plain: "A Permit2 approval that would outlive the transaction, against the guarantee that none does.", expect: { kind: "reverted", name: "AssertionFailed" }, watch: [ALLOWANCE, NONCE], build: (x) => ({ calls: [{ target: x.d.uniswap.permit2, value: 0n, data: encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [x.d.tokens.dUSDC, x.d.uniswap.router, ONE_USDC, Math.floor(Date.now() / 1000) + 3600] }) }] }) },
    ],
  },
];

const CASES = new Map(SUITES.flatMap((s) => s.cases.map((c) => [c.id, { ...c, suite: s.id }])));
const publicCase = ({ id, proof, title, plain, expect }) => ({ id, proof, title, plain, expect });
const publicSuite = ({ id, title, summary, cases }) => ({ id, title, summary, cases: cases.map(publicCase) });

// Upstream errors can quote keyed endpoint URLs. Nothing leaves this file with a URL or a configured secret in it.
function clean(env, text) {
  let out = String(text ?? "");
  for (const k of ["SEPOLIA_RPC_URL", "SEPOLIA_LOGS_RPC_URL", "BUNDLER_URL", "BUNDLER_URL_2"]) if (env[k]) out = out.split(env[k]).join("[endpoint]");
  return out.replace(/https?:\/\/[^\s"')]+/g, "[endpoint]").slice(0, 600);
}

function decodeError(data) {
  if (!data || data === "0x") return null;
  try {
    const e = decodeErrorResult({ abi: ERRORS, data });
    const args = (e.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a)));
    return { name: e.errorName, raw: `${e.errorName}(${args.join(", ")})`, human: EXPLAIN[e.errorName] ?? null };
  } catch {
    return { name: null, raw: data, human: null };
  }
}

async function bundle(env, method, params) {
  const r = await forward(need(env, "BUNDLER_URL"), { jsonrpc: "2.0", id: 1, method, params });
  if (r.error) throw new Error(r.error.message ?? JSON.stringify(r.error));
  return r.result;
}

async function fees(env, pub) {
  try {
    const r = await bundle(env, "pimlico_getUserOperationGasPrice", []);
    return { maxFeePerGas: BigInt(r.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(r.fast.maxPriorityFeePerGas) };
  } catch {
    return pub.estimateFeesPerGas();
  }
}

/** The account's own verdict, from the call the EntryPoint makes. Null when validation passes. */
async function validationVerdict(x, p, op) {
  const two = (hi, lo) => concat([pad(hi, { size: 16 }), pad(lo, { size: 16 })]);
  const packed = { sender: op.sender, nonce: BigInt(op.nonce), initCode: "0x", callData: op.callData, accountGasLimits: two(op.verificationGasLimit, op.callGasLimit), preVerificationGas: BigInt(op.preVerificationGas), gasFees: two(op.maxPriorityFeePerGas, op.maxFeePerGas), paymasterAndData: "0x", signature: op.signature };
  try {
    await x.pub.simulateContract({ account: x.d.entryPoint, address: op.sender, abi: ACCOUNT_ABI, functionName: "validateUserOp", args: [packed, p.hash, 0n] });
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((w) => w instanceof ContractFunctionRevertedError) : null;
    if (r?.data?.errorName) {
      const args = (r.data.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a)));
      return { name: r.data.errorName, raw: `${r.data.errorName}(${args.join(", ")})`, human: EXPLAIN[r.data.errorName] ?? null };
    }
    const data = e?.cause?.data ?? e?.data;
    return decodeError(typeof data === "string" ? data : null) ?? { name: null, raw: clean(x.env, e.shortMessage ?? e.message), human: null };
  }
}

async function waitForOp(x, userOpHash, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await bundle(x.env, "eth_getUserOperationReceipt", [userOpHash]).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("not mined within 3 minutes");
}

/** A refused batch still lands, so the bundler's `success` says too little. This reads the account's own result from the logs. */
function resultOf(x, r) {
  const logs = r.logs ?? r.receipt?.logs ?? [];
  const l = logs.find((e) => e.address?.toLowerCase() === x.d.account.toLowerCase() && e.topics?.[0] === VERBATIM_RESULT);
  if (!l) return null;
  const [err] = decodeAbiParameters([{ type: "bytes" }], l.data);
  return { ok: BigInt(l.topics[1]) === 1n, error: decodeError(err) };
}

function received(logs, token, to) {
  let sum = 0n;
  for (const l of logs ?? []) {
    if (l.address?.toLowerCase() !== token.toLowerCase() || l.topics?.[0] !== TRANSFER) continue;
    if (`0x${l.topics[2].slice(26)}`.toLowerCase() === to.toLowerCase()) sum += BigInt(l.data);
  }
  return sum;
}

function ownerKeys(env) {
  return [need(env, "OWNER1_KEY"), need(env, "OWNER2_KEY")].map((k) => privateKeyToAccount(k));
}

const client = (env) => createPublicClient({ chain: sepolia, transport: http(need(env, "SEPOLIA_RPC_URL")) });

/** Everything a case reads from the chain, once, so that one run's operations share one expiry. */
async function contextFor(env, c) {
  const d = dep();
  const pub = client(env);
  const [snap, block, f, attacker, quoted] = await Promise.all([
    snapshot(env),
    pub.getBlock(),
    fees(env, pub),
    pub.readContract({ address: d.skimHook, abi: HOOK, functionName: "ATTACKER" }),
    pub.simulateContract({ address: d.uniswap.quoter, abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ poolKey: d.pools.eth.key, zeroForOne: true, exactAmount: SWAP_IN, hookData: "0x" }] }),
  ]);
  if (snap.stale) throw new Error("the attested snapshot has expired and the server has no attestor keys to refresh it");
  const minOut = (quoted.result[0] * 99n) / 100n;
  let expiry = block.timestamp + BigInt(c.validity ?? 240);
  const cap = BigInt(snap.expiry) - 30n;
  if (expiry > cap) expiry = cap;
  const prepare = (calls, override) => prepareUserOp({ client: pub, account: d.account, calls, snapshot: snap, router: { permit2: d.uniswap.permit2, weth: d.uniswap.weth9, publisher: packedUniswap }, fees: f, expiry, override });
  return { env, d, pub, block, attacker, minOut, expiry, prepare };
}

const step = (run, text, tone) => run.steps.push({ text, tone: tone ?? null, at: Date.now() });

async function readWatches(x, watch) {
  return Promise.all((watch ?? []).map(async (w) => ({ label: w.label, unit: w.unit, raw: await w.read(x), format: w.format })));
}

function setDeltas(run, before, after) {
  run.deltas = before.map((b, i) => ({ label: b.label, unit: b.unit, before: b.format(b.raw), after: b.format(after[i].raw), changed: b.raw !== after[i].raw }));
}

/** Signs as the device would. The device's own check runs first, and its refusal is reported as it stands. */
async function ownersSign(run, env, tree, txCommit, signAnyway) {
  const request = { tree, txCommit };
  try {
    const r = review(request);
    step(run, `Device decoded the sentence itself: ${r.lines.length} lines, and it is willing to sign.`);
  } catch (e) {
    step(run, `Device refuses: ${e.message}.`, "bad");
    run.deviceRefused = e.message;
    if (!signAnyway) return null;
    step(run, "The owners sign anyway, bypassing the device, to see what the chain does.", "warn");
  }
  const decoded = decodeTree(tree);
  const td = typedData(decoded, request, keccak256(tree), keccak256(specOf(decoded)));
  const sigs = await Promise.all(ownerKeys(env).map(async (a) => ({ signer: a.address, sig: await a.signTypedData(td) })));
  run.signers = sigs.map((s) => s.signer);
  step(run, `Signed by ${sigs.length} owners with the demo server’s keys.`);
  return sigs;
}

async function runOperation(run, c, x) {
  const spec = c.build(x);
  step(run, `Read block ${x.block.number}. Signature valid until timestamp ${x.expiry}.`);
  const truth = await x.prepare(spec.calls);
  let p = truth;
  if (spec.weakenSpec) {
    // The honest sentence, with its assertions swapped for an empty set (VSPEC v2, no items).
    p = await x.prepare(spec.calls, { tree: truth.tree, spec: "0x565300020000" });
    run.claimed = truth.tree;
    step(run, "Rendered the sentence from the calldata, then removed the assertions sent with it.", "warn");
  } else if (spec.lie) {
    const shown = await x.prepare(spec.lie.calls);
    p = await x.prepare(spec.calls, { tree: shown.tree, spec: shown.spec });
    run.claimed = shown.tree;
    run.actual = truth.tree;
    step(run, "Rendered both sentences: the one the page shows, and the one the calldata really produces.", "warn");
  } else {
    run.claimed = truth.tree;
    step(run, "Rendered the sentence from the calldata.");
  }
  run.nonce = BigInt(p.op.nonce).toString();

  const before = await readWatches(x, c.watch);
  const sigs = await ownersSign(run, x.env, p.tree, p.hash, c.signAnyway);
  if (!sigs) {
    run.outcome = { kind: "device-refused", raw: run.deviceRefused };
    return;
  }
  if (c.holdUntilExpired) {
    step(run, "The host holds the signed operation until it has expired.", "warn");
    for (;;) {
      const now = (await x.pub.getBlock()).timestamp;
      if (now > x.expiry + SECONDS_PAST_EXPIRY) break;
      await new Promise((res) => setTimeout(res, 4000));
    }
    step(run, "It has expired. Sending it now.", "warn");
  }

  const op = userOpWithSignatures(p, sigs);
  step(run, "Sent to the bundler.");
  let userOpHash;
  try {
    userOpHash = await bundle(x.env, "eth_sendUserOperation", [op, x.d.entryPoint]);
  } catch (e) {
    const bundler = clean(x.env, e.message);
    const reason = await validationVerdict(x, p, op);
    step(run, "The bundler refused it, so it never reached the mempool.", "bad");
    if (reason?.name) step(run, `Asked directly, the account answers ${reason.name}.`, "bad");
    setDeltas(run, before, await readWatches(x, c.watch));
    run.outcome = { kind: "rejected", name: reason?.name ?? null, raw: reason?.raw ?? null, human: reason?.human ?? null, bundler };
    return;
  }
  run.userOpHash = userOpHash;
  step(run, "The bundler admitted it. Waiting for a block.");
  const r = await waitForOp(x, userOpHash);
  run.txHash = r.receipt?.transactionHash ?? null;
  run.block = r.receipt?.blockNumber ? BigInt(r.receipt.blockNumber).toString() : null;
  run.gasUsed = r.actualGasUsed ? BigInt(r.actualGasUsed).toString() : null;
  const result = resultOf(x, r);
  setDeltas(run, before, await readWatches(x, c.watch));
  if (result?.ok) {
    step(run, `Mined in block ${run.block}. The account reports every guarantee held.`, "ok");
    run.outcome = { kind: "landed" };
  } else {
    step(run, `Mined in block ${run.block}, and the batch reverted${result?.error?.name ? ` with ${result.error.name}` : ""}.`, "bad");
    run.outcome = { kind: "reverted", name: result?.error?.name ?? null, raw: result?.error?.raw ?? null, human: result?.error?.human ?? null };
  }
}

/** The ordinary wallet: the same evil route from a throwaway EOA, with nothing on chain to object. */
async function runOrdinaryWallet(run, x) {
  const account = privateKeyToAccount(need(x.env, "DEMO_EOA_KEY"));
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(need(x.env, "SEPOLIA_RPC_URL")) });
  const balance = await x.pub.getBalance({ address: account.address });
  if (balance < MIN_EOA_ETH) throw new Error(`the demo wallet ${account.address} is out of Sepolia ETH`);
  run.from = account.address;
  const call = swapCall(x.d, x.d.pools.ethEvil.key, 0n);
  step(run, `Read block ${x.block.number}. Wallet ${account.address} signs raw calldata, with minimum output 0.`);
  const hash = await wallet.sendTransaction({ to: call.target, data: call.data, value: call.value, gas: 2_000_000n });
  run.txHash = hash;
  step(run, "Sent. Nothing checked what it does. Waiting for a block.");
  const rc = await x.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  run.block = rc.blockNumber.toString();
  run.gasUsed = rc.gasUsed.toString();
  const got = received(rc.logs, x.d.tokens.dUSDC, account.address);
  const took = received(rc.logs, x.d.tokens.dUSDC, x.attacker);
  run.skim = { received: formatUnits(got, 6), took: formatUnits(took, 6), share: got + took > 0n ? Math.round((Number(took) / Number(got + took)) * 100) : null };
  if (rc.status !== "success") {
    step(run, `Mined in block ${run.block}, and it reverted.`, "bad");
    run.outcome = { kind: "reverted", raw: "the swap reverted" };
    return;
  }
  step(run, `Mined in block ${run.block}. The wallet got ${run.skim.received} dUSDC and the hook took ${run.skim.took}.`, "bad");
  run.outcome = took > got ? { kind: "skimmed" } : { kind: "landed" };
}

const asExpected = (c, o) => o.kind === c.expect.kind && (!c.expect.name || o.name === c.expect.name);

async function execute(run, env) {
  const c = CASES.get(run.case);
  run.status = "running";
  run.startedAt = Date.now();
  try {
    const x = await contextFor(env, c);
    if (c.eoa) await runOrdinaryWallet(run, x);
    else await runOperation(run, c, x);
    run.asExpected = asExpected(c, run.outcome);
  } catch (e) {
    run.outcome = { kind: "error", raw: clean(env, e.shortMessage ?? e.message) };
    run.asExpected = false;
    step(run, `The run failed before a result: ${run.outcome.raw}`, "bad");
  }
  run.txUrl = run.txHash ? `${EXPLORER}/tx/${run.txHash}` : null;
  run.status = "done";
  run.finishedAt = Date.now();
}

// One account means one nonce, so runs take turns. In memory: one server instance, like /attack's sessions.
const runs = new Map();
const queue = [];
let working = false;
let hour = { at: 0, n: 0 };

async function pump(env) {
  if (working) return;
  working = true;
  while (queue.length) {
    const run = queue.shift();
    await execute(run, env);
    while (runs.size > KEEP_RUNS) runs.delete(runs.keys().next().value);
  }
  working = false;
}

const view = (run) => (run.status === "queued" ? { ...run, position: queue.indexOf(run) + 1 } : run);

function ready(env) {
  const missing = ["OWNER1_KEY", "OWNER2_KEY", "SEPOLIA_RPC_URL", "BUNDLER_URL"].filter((k) => !env[k]);
  return missing.length ? `the demo server is missing ${missing.join(", ")}` : null;
}

let fundsCache = { at: 0, value: null };
async function funds(env) {
  if (Date.now() - fundsCache.at < 30_000) return fundsCache.value;
  const d = dep();
  const pub = client(env);
  const [eth, deposit, eoa] = await Promise.all([
    pub.getBalance({ address: d.account }),
    pub.readContract({ address: d.entryPoint, abi: EP, functionName: "balanceOf", args: [d.account] }),
    env.DEMO_EOA_KEY ? pub.getBalance({ address: privateKeyToAccount(env.DEMO_EOA_KEY).address }) : null,
  ]);
  fundsCache = { at: Date.now(), value: { raw: eth + deposit, accountEth: formatEther(eth + deposit), eoaEth: eoa === null ? null : formatEther(eoa), eoaRaw: eoa } };
  return fundsCache.value;
}

/** GET /api/suites */
export async function list(env) {
  const why = ready(env);
  const d = dep();
  const f = why ? null : await funds(env).catch(() => null);
  return {
    ready: !why,
    why,
    network: "Sepolia",
    explorer: EXPLORER,
    account: d.account,
    signers: why ? [] : ownerKeys(env).map((a) => a.address),
    funds: f ? { accountEth: f.accountEth, eoaEth: f.eoaEth } : null,
    queued: queue.length + (working ? 1 : 0),
    suites: SUITES.map(publicSuite),
    recent: [...runs.values()].filter((r) => r.status === "done").slice(-12).reverse().map(({ id, case: caseId, title, outcome, asExpected: met, txUrl, finishedAt }) => ({ id, case: caseId, title, kind: outcome?.kind, name: outcome?.name ?? null, asExpected: met, txUrl, finishedAt })),
  };
}

/** POST /api/suites/run { case }. The case's id is the only thing a visitor chooses. */
export async function start(env, body, ip) {
  const c = CASES.get(String(body?.case ?? ""));
  if (!c) throw new HttpError(404, "no such case");
  const why = ready(env);
  if (why) throw new HttpError(503, why);
  limit(`suites:${ip}`, 12);
  if (Date.now() - hour.at > 3600_000) hour = { at: Date.now(), n: 0 };
  if (hour.n >= RUNS_PER_HOUR) throw new HttpError(429, "the demo has used this hour’s runs, so that the testnet funds last. Try again later");
  if (queue.length >= MAX_QUEUE) throw new HttpError(429, "the queue is full. Try again in a minute");
  const f = await funds(env);
  if (f.raw < MIN_ACCOUNT_ETH) throw new HttpError(503, `the demo account ${dep().account} is low on Sepolia ETH`);
  if (c.eoa && (f.eoaRaw === null || f.eoaRaw < MIN_EOA_ETH)) throw new HttpError(503, "the ordinary wallet is low on Sepolia ETH");
  hour.n++;
  const run = { id: crypto.randomUUID(), case: c.id, suite: c.suite, title: c.title, proof: c.proof, expect: c.expect, status: "queued", createdAt: Date.now(), steps: [], claimed: null, actual: null, signers: [], deltas: [], outcome: null, asExpected: null, txHash: null, txUrl: null, userOpHash: null, block: null, gasUsed: null };
  runs.set(run.id, run);
  queue.push(run);
  pump(env);
  return view(run);
}

/** GET /api/suites/run/:id */
export function get(id) {
  const run = runs.get(String(id));
  if (!run) throw new HttpError(404, "no such run; the server may have restarted");
  return view(run);
}

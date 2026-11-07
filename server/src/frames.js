// One touch, both frame paths: POST /api/frames/run sends the same honest 1 dUSDC transfer as an EIP-8141 frame transaction twice
// on the EF frames devnet, once down the stateless path and once down the paymaster path, through the real alt-mempool. Nothing is
// simulated: each transaction is admitted by the mempool, mined, and its frame receipts are read back from the node.
//
// Keys: OWNER1_KEY and OWNER2_KEY are also two of the devnet account's three owners, and ATTESTOR1..3_KEY are the devnet snapshot's
// attestors. The same exception as suites.js applies: the server signs only the fixed transfer built here, on a testnet account.
// The owner-1 address doubles as the devnet fee payer for trust renewals and fee tickets, topped up from the devnet's own faucet.
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChainTrust, PAYMASTER_ABI, PUBLIC_GATEWAY_GAS, packedUniswap, prepare, prepareStateless, withSignatures, withStatelessSignatures } from "@verbatim/client";
import { DEVNET, GATEWAY, RpcError, rpc, submit, waitReceipt } from "@verbatim/frames-sdk";
import { emptyUpdate, encodeRefresh, updateHash } from "@verbatim/attestor-cli";
import { snapshotTypedData } from "@verbatim/snapshot-cli";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { HttpError, limit, need, readData } from "./app.js";

const chain = { id: 1337, name: "frames-devnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [DEVNET.node] } } };
export const pub = createPublicClient({ chain, transport: http(DEVNET.node) });
export const ERC20 = parseAbi(["function transfer(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const STORE = parseAbi(["function trustEpoch() view returns (uint64)", "function snapshot() view returns (bytes32 root, uint64 issuedAt, uint64 expiry)"]);
export const ROUTER = { permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", weth: "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6", publisher: packedUniswap };
export const RESULT = keccak256(toHex("VerbatimResult(bool,bytes)"));
const GAS_PRICE = 2_000_000n; // legacy transactions; the devnet base fee is 7 wei
export const TICKET = 1_000_000_000_000n;
const ONE_DUSDC = 1_000_000n;
const RENEW_BEFORE = 30n * 60n;
const MIN_PAYER = parseEther("0.1");
const RUNS_PER_HOUR = 30;

export const FRAMES = {
  stateless: [
    { mode: "VERIFY", target: "expiry verifier" },
    { mode: "VERIFY", target: "account: renders from proofs" },
    { mode: "SENDER", target: "account: executeVerified" },
  ],
  paymaster: [
    { mode: "VERIFY", target: "expiry verifier" },
    { mode: "VERIFY", target: "account" },
    { mode: "VERIFY", target: "paymaster: renders from cache" },
    { mode: "SENDER", target: "account: executeVerified" },
  ],
};

let dev;
export const d = () => (dev ??= readData("devnet.json"));
export const explorerTx = (h) => `${d().explorer}tx/${h}?node=${encodeURIComponent(d().mempool)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const owners = (env) => [need(env, "OWNER1_KEY"), need(env, "OWNER2_KEY")].map((k) => privateKeyToAccount(k));
export function attestors(env, listed) {
  const set = new Set(listed.map((a) => a.toLowerCase()));
  const a = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => env[k]).filter(Boolean).map((k) => privateKeyToAccount(k)).filter((x) => set.has(x.address.toLowerCase()));
  if (a.length < 2) throw new HttpError(503, "the server's attestor keys are not the devnet snapshot's attestors");
  return a.sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1)).slice(0, 2);
}

export async function sendLegacy(account, to, data, value = 0n, gas = 3_000_000n) {
  const w = createWalletClient({ account, chain, transport: http(DEVNET.node) });
  const hash = await w.sendTransaction({ to, data, value, gas, gasPrice: GAS_PRICE, type: "legacy" });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`devnet transaction reverted: ${hash}`);
  return r;
}

/** Keeps the fee payer funded from the devnet's faucet, which only the gateway runs. */
export async function ensurePayer(payer, log) {
  if ((await pub.getBalance({ address: payer.address })) >= MIN_PAYER) return;
  log("Topping up the fee payer from the devnet faucet");
  await rpc(GATEWAY, "skandha_explorer_faucet", [payer.address]);
  for (let i = 0; i < 45; i++) {
    if ((await pub.getBalance({ address: payer.address })) >= MIN_PAYER) return;
    await sleep(2000);
  }
  throw new Error("the devnet faucet did not pay out");
}

/**
 * The paymaster caches a snapshot that lasts six hours. If it is close to expiring, the attestors renew it on chain: the same root,
 * no new descriptors, the next epoch. The stateless path carries its snapshot in the transaction, so it gets the published leaves
 * and root, signed by the same attestors over the same timestamps.
 */
let carried = null;
export async function trust(env, payer, log) {
  const s = d();
  const published = readData("snapshot-devnet.json");
  const [epoch, [root, issuedAt, expiry]] = await Promise.all([
    pub.readContract({ address: s.paymaster, abi: STORE, functionName: "trustEpoch" }),
    pub.readContract({ address: s.paymaster, abi: STORE, functionName: "snapshot" }),
  ]);
  if (root.toLowerCase() !== published.root.toLowerCase()) throw new HttpError(503, "the devnet's trust snapshot is not the published one; the deployment needs a redeploy");
  const block = await pub.getBlock();
  const signers = attestors(env, published.attestors);
  let at = { issuedAt, expiry };
  if (expiry - block.timestamp < RENEW_BEFORE) {
    log(expiry <= block.timestamp ? "The trust snapshot has expired: the attestors renew it on chain" : "The trust snapshot is near expiry: the attestors renew it on chain");
    const u = emptyUpdate(epoch + 1n, root, block.timestamp - 60n);
    const h = updateHash(1337n, s.paymaster, u);
    const sigs = await Promise.all(signers.map((a) => a.sign({ hash: h })));
    await sendLegacy(payer, s.paymaster, encodeRefresh(u, sigs), 0n, 25_000_000n);
    at = { issuedAt: u.issuedAt, expiry: u.expiry };
  }
  if (carried?.issuedAt === at.issuedAt.toString() && carried.root === published.root) return carried;
  const typed = snapshotTypedData(BigInt(published.chainId), published.root, at.issuedAt, at.expiry, published.schema);
  const signatures = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(typed) })));
  carried = { ...published, issuedAt: at.issuedAt.toString(), expiry: at.expiry.toString(), signatures };
  return carried;
}

/** Fee tickets are per nonce and anyone may pay them. Keeps the next few funded. */
export async function ensureTickets(payer, log) {
  const s = d();
  const nonce = BigInt(await pub.getTransactionCount({ address: s.account }));
  const [amount] = await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "feeTicket", args: [s.account, nonce] });
  if (amount >= TICKET) return;
  log("Prepaying the paymaster's fee tickets for the next nonces");
  await sendLegacy(payer, s.paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [s.account, nonce, 10n] }), TICKET * 10n, 15_000_000n);
}

export const signAll = (keys, typed) => Promise.all(keys.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(typed) })));

export function batchResult(r, account = d().account) {
  for (const f of r.frameReceipts ?? [])
    for (const l of f.logs ?? []) if (l.topics?.[0] === RESULT && l.address?.toLowerCase() === account.toLowerCase()) return BigInt(l.topics[1]) === 1n;
  return null;
}

const MINE_WAIT_MS = 75_000;
const TRIES = 3;
/** The client's default fee cap, in wei per gas; the devnet's base fee is 7. Each retry raises it 4x, so it can replace a stuck one. */
const BASE_FEE_CAP = 10_000n;
const feeFor = (attempt) => {
  const max = BASE_FEE_CAP * 4n ** BigInt(attempt - 1);
  return { maxFeePerGas: max, maxPriorityFeePerGas: max / 2n };
};

/**
 * Submits through the alt-mempool, waits for the block, and reads each frame's status and gas from the receipt. The devnet's
 * mempool sometimes admits a transaction and then drops it. If none is mined in time and the account's nonce has not moved, the
 * transaction is built and signed again from scratch and resent, at a higher fee. A transaction stuck from an earlier run, at the
 * same nonce, is replaced the same way.
 */
async function land(path, build, log) {
  const Name = path === "stateless" ? "Stateless" : "Paymaster";
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const { tx, p } = await build(feeFor(attempt));
    let hash;
    log(`${Name} path: submitting to the alt-mempool${attempt > 1 ? ` (try ${attempt} of ${TRIES})` : ""}`);
    try {
      hash = await submit(tx);
    } catch (e) {
      const msg = (e instanceof RpcError ? e.message : String(e)).slice(0, 200);
      if (/cannot be replaced|fee too low|underpriced/i.test(msg) && attempt < TRIES) {
        log(`${Name} path: an older transaction is pending at this nonce, so this one is sent again at a higher fee`);
        continue;
      }
      throw new Error(`the mempool refused the ${path} transaction: ${msg}`);
    }
    log(`${Name} path: admitted, waiting for the block`);
    let r = await waitReceipt(hash, DEVNET, MINE_WAIT_MS).catch(() => null);
    if (!r) {
      const nonce = BigInt(await pub.getTransactionCount({ address: d().account }));
      if (nonce > tx.nonceSeq) r = await waitReceipt(hash, DEVNET, 30_000).catch(() => null); // it did land, the node is just slow to say so
      if (!r && nonce > tx.nonceSeq) throw new Error(`the ${path} transaction's nonce was used, but its receipt never arrived`);
    }
    if (!r) {
      if (attempt >= TRIES) throw new Error(`the devnet mempool admitted the ${path} transaction ${TRIES} times and never mined it`);
      log(`${Name} path: the mempool dropped it, so it is built and signed again`);
      continue;
    }
    const sentence = formatForDevice(decodeTree(p.tree)).map((l) => l.text ?? String(l));
    const frames = FRAMES[path].map((f, i) => {
      const fr = r.frameReceipts?.[i];
      const g = fr?.gasUsed;
      return { ...f, status: fr ? Number(BigInt(fr.status)) : null, gas: g == null ? null : Number(typeof g === "object" ? (g.execution ?? 0) : BigInt(g)) };
    });
    const validation = frames.filter((f) => f.mode === "VERIFY").reduce((n, f) => n + (f.gas ?? 0), 0);
    return { path, txHash: hash, txUrl: explorerTx(hash), block: Number(BigInt(r.blockNumber)), ok: batchResult(r) === true, frames, validationGas: validation, signatures: tx.signatures?.length ?? 0, sentence, tries: attempt, ms: Date.now() - started };
  }
}

function runStateless(env, snap, log) {
  const s = d();
  const [o1, o2] = owners(env);
  log("Stateless path: rendering the sentence and building the proofs it carries");
  return land("stateless", async (fee) => {
    const p = await prepareStateless({ client: pub, account: s.account, calls: [transfer(o1.address)], snapshot: snap, router: ROUTER, ...fee });
    return { p, tx: withStatelessSignatures(p, await signAll([o1, o2], p.digestTypedData)) };
  }, log);
}

function runPaymaster(env, payer, log) {
  const s = d();
  const [o1, o2] = owners(env);
  log("Paymaster path: rendering the sentence against the paymaster's cache");
  return land("paymaster", async (fee) => {
    // Tickets are per nonce: the stateless transaction used one, so this checks the nonce the paymaster path gets now.
    await ensureTickets(payer, log);
    const p = await prepare({ client: pub, trust: new ChainTrust(pub, s.paymaster), account: s.account, paymaster: s.paymaster, calls: [transfer(o1.address)], gas: PUBLIC_GATEWAY_GAS, ...fee });
    return { p, tx: withSignatures(p.tx, p.digest, await signAll([o1, o2], p.digestTypedData)) };
  }, log);
}

const transfer = (to) => ({ target: d().tokens.dUSDC, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, ONE_DUSDC] }) });

// ---------------------------------------------------------------------------------------------------------------------------
// Runs, one at a time: both paths spend the same account's nonces.
const runs = new Map();
let busy = null;
let hour = { at: 0, n: 0 };

const view = (run) => ({ id: run.id, status: run.status, steps: run.steps, stateless: run.stateless, paymaster: run.paymaster, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt });

async function work(env, run) {
  const log = (text) => run.steps.push({ at: Date.now(), text });
  try {
    run.status = "running";
    const [payer] = owners(env);
    const block = await pub.getBlock().catch(() => null);
    if (!block || Date.now() / 1000 - Number(block.timestamp) > 120) throw new Error("the frames devnet is not producing blocks right now");
    await ensurePayer(payer, log);
    const snap = await trust(env, payer, log);
    const bal = await pub.readContract({ address: d().tokens.dUSDC, abi: ERC20, functionName: "balanceOf", args: [d().account] });
    if (bal < 2n * ONE_DUSDC) throw new Error("the devnet account is out of dUSDC");
    run.stateless = await runStateless(env, snap, log);
    run.paymaster = await runPaymaster(env, payer, log);
    log("Both landed");
    run.status = "done";
  } catch (e) {
    run.status = "failed";
    run.error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
  }
  run.finishedAt = Date.now();
}

/** POST /api/frames/run */
export function start(env, ip) {
  owners(env);
  if (busy && runs.get(busy)?.status !== "done" && runs.get(busy)?.status !== "failed") return view(runs.get(busy));
  limit(`frames:${ip}`, 3);
  if (Date.now() - hour.at > 3600_000) hour = { at: Date.now(), n: 0 };
  if (hour.n >= RUNS_PER_HOUR) throw new HttpError(429, "the demo has used this hour’s frame runs. Try again later");
  hour.n++;
  const run = { id: crypto.randomUUID(), status: "queued", steps: [], stateless: null, paymaster: null, error: null, startedAt: Date.now(), finishedAt: null };
  runs.set(run.id, run);
  if (runs.size > 50) runs.delete(runs.keys().next().value);
  busy = run.id;
  work(env, run);
  return view(run);
}

/** GET /api/frames/run/:id */
export function get(id) {
  const run = runs.get(String(id));
  if (!run) throw new HttpError(404, "no such run; the server may have restarted");
  return view(run);
}

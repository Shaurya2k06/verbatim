// Every proof-ledger case that is safe to run from a public button, on the EF frames devnet, as EIP-8141 frame transactions through
// the real alt-mempool. Ported from contracts/scripts/live (attacks.ts, swap.ts, stateless.ts): the same transactions, built and
// signed here. POST /api/frames/case { id } starts one, GET /api/frames/case/:run follows it.
//
// Left out on purpose, because one visitor's run would change trust state everyone else depends on: A15 and B10 (revoking a
// descriptor), BENCH-N50 (rotating the snapshot), the G0 probes and CANONICAL-UNSTAKED (their own probe deployments). They stay
// recorded evidence. The same key exception as suites.js applies: the server signs only the fixed transactions built here.
import { concat, createWalletClient, encodeAbiParameters, encodeFunctionData, encodePacked, http, keccak256, parseAbi, parseEther, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ACCOUNT_ABI, ChainTrust, PAYMASTER_ABI, PUBLIC_GATEWAY_GAS, executeFrameData, prepare, prepareStateless, txCommit, typedData, withSignatures, withStatelessSignatures } from "@verbatim/client";
import { DEVNET, Mode, RpcError, Scope, frame, newTx, submit, waitReceipt } from "@verbatim/frames-sdk";
import { emptyUpdate, encodeRefresh, updateHash } from "@verbatim/attestor-cli";
import { encodeProofs, treeOf, snapshotTypedData } from "@verbatim/snapshot-cli";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { review } from "@verbatim/signer";
import { CMD, MSG_SENDER, executeData, v4ExactInSingleInput, v4SwapCall, wrapInput } from "@verbatim/urrender";
import { explainRevert } from "@verbatim/app-kit/errors";
import { HttpError, limit, readData } from "./app.js";
import { ROUTER as STATELESS_ROUTER, TICKET, attestors, batchResult, d, ensurePayer, explorerTx, owners, pub, sendLegacy, signAll, trust } from "./frames.js";

const ERC20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const STORE = parseAbi(["function trustEpoch() view returns (uint64)", "function snapshot() view returns (bytes32 root, uint64 issuedAt, uint64 expiry)"]);
const THIEF = "0x000000000000000000000000000000000000dEaD";
const ONE_DUSDC = 1_000_000n;
const SWAP_IN = parseEther("0.001");
const MIN_OUT = 2_000_000n; // 2 dUSDC: the devnet pool prices ETH near 3000
const RUNS_PER_HOUR = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = async () => (await pub.getBlock()).timestamp;
const bal = (t, a) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });
const transfer = (to, amount = ONE_DUSDC) => ({ target: d().tokens.dUSDC, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] }) });
const victim = () => d().owners[2];
const router = () => d().uniswap.router;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);
const swap = (key, min) => ({ target: router(), value: SWAP_IN, data: v4SwapCall({ key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: min }, deadline()) });
const decode = (msg) => {
  const x = explainRevert(String(msg ?? ""));
  return { name: x.name ?? null, raw: x.name ? x.raw : String(msg ?? "").slice(0, 400), human: x.name ? x.human : null };
};

// ---------------------------------------------------------------------------------------------------------------------------
// What a case can do: build on either path, sign as the demo's two owners, and send.
function kit(env, run, bump = 1n) {
  const log = (text) => run.steps.push({ at: Date.now(), text });
  const [o1, o2] = owners(env);
  const payer = o1;
  let snap;
  const k = {
    log,
    payer,
    /** Tickets are per nonce and anyone may pay them. */
    async tickets(account = d().account, paymaster = d().paymaster, count = 10n) {
      const nonce = BigInt(await pub.getTransactionCount({ address: account }));
      const [amount] = await pub.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "feeTicket", args: [account, nonce] });
      if (amount >= TICKET) return;
      log("Prepaying the paymaster's fee tickets for the next nonces");
      await sendLegacy(payer, paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [account, nonce, count] }), TICKET * count, 15_000_000n);
    },
    async ethFor(address, min = parseEther("0.02")) {
      if ((await pub.getBalance({ address })) >= min) return;
      log("Topping up the account's ETH for the stateless path's own fee");
      await sendLegacy(payer, address, "0x", min * 2n, 100_000n);
    },
    /** The paymaster path: [expiry, VERIFY account, VERIFY paymaster, SENDER]. */
    async pm(calls, opts = {}) {
      const account = opts.account ?? d().account;
      const paymaster = opts.paymaster ?? d().paymaster;
      if (!opts.skipTickets) await k.tickets(account, paymaster);
      log("Paymaster path: rendering the sentence against the paymaster's cache");
      return prepare({ client: pub, trust: new ChainTrust(pub, paymaster), account, paymaster, calls, gas: PUBLIC_GATEWAY_GAS, ...fees(bump), ...opts });
    },
    /** The stateless path: [expiry, VERIFY account with proofs, SENDER]. */
    async sl(calls, opts = {}) {
      await k.ethFor(d().account);
      log("Stateless path: rendering the sentence and building the proofs it carries");
      return prepareStateless({ client: pub, account: d().account, calls, snapshot: snap, router: STATELESS_ROUTER, ...fees(bump), ...opts });
    },
    bump,
    sign: async (p) => withSignatures(p.tx, p.digest, await signAll([o1, o2], p.digestTypedData)),
    signSl: async (p, snapshot = p.snapshot) => withStatelessSignatures({ ...p, snapshot }, await signAll([o1, o2], p.digestTypedData)),
    /** Re-signs a transaction a frontend mutated, as owners who sign whatever digest they are handed. */
    async resign(p, tx) {
      const typed = typedData(p.chainId, p.account, p.treeHash, p.specHash, p.expiry, p.snapshotRoot, 2, txCommit(tx, 2));
      const sigs = await signAll([o1, o2], typed);
      const { hashTypedData } = await import("viem");
      return withSignatures(tx, hashTypedData(typed), sigs);
    },
    sentence: (p) => formatForDevice(decodeTree(p.tree)).map((l) => (typeof l === "string" ? l : `${"  ".repeat(l.indent ?? 0)}${l.text}`)),
    async snapshot() {
      snap ??= await trust(env, payer, log);
      return snap;
    },
    env,
  };
  return k;
}

/** The client's default fees, raised when an earlier transaction sits in the pool on the same nonce and has to be replaced. */
const fees = (bump) => (bump > 1n ? { maxFeePerGas: 10_000n * bump, maxPriorityFeePerGas: 100n * bump } : {});
class Replace extends Error {}
const REPLACE = /cannot be replaced|replacement transaction underpriced/i;

/** Sends a transaction that must not get in. The answer is the mempool's. */
async function refused(k, tx, check) {
  k.log("Submitting to the alt-mempool");
  try {
    const h = await submit(tx);
    k.log("The mempool admitted it. Waiting for the block");
    const r = await waitReceipt(h);
    return { kind: "landed", txHash: h, txUrl: explorerTx(h), block: Number(BigInt(r.blockNumber)), frames: framesOf(r), asExpected: false, note: "It was admitted, and it should not have been." };
  } catch (e) {
    const msg = e instanceof RpcError ? e.message : String(e?.message ?? e);
    if (REPLACE.test(msg)) throw new Replace(msg);
    const x = decode(msg);
    k.log(`Refused: ${x.name ?? msg.slice(0, 120)}`);
    return { kind: "rejected", ...x, message: msg.slice(0, 600), asExpected: check(msg, x) };
  }
}

const framesOf = (r) => (r.frameReceipts ?? []).map((f) => ({ status: Number(BigInt(f.status)), gas: f.gasUsed == null ? null : Number(typeof f.gasUsed === "object" ? (f.gasUsed.execution ?? 0) : BigInt(f.gasUsed)) }));

/** The account's own verdict on its batch, decoded. */
function verdictOf(r, account = d().account) {
  for (const f of r.frameReceipts ?? [])
    for (const l of f.logs ?? [])
      if (l.topics?.[0] && l.address?.toLowerCase() === account.toLowerCase() && BigInt(l.topics[1] ?? 0) <= 1n && l.data?.length >= 130) {
        const ok = BigInt(l.topics[1]) === 1n;
        const len = parseInt(l.data.slice(66, 130), 16);
        const err = len ? `0x${l.data.slice(130, 130 + len * 2)}` : "";
        return { ok, ...(ok ? { name: null, raw: "", human: null } : decode(err)) };
      }
  const ok = batchResult(r, account);
  return { ok, name: null, raw: "", human: null };
}

/** Sends a transaction that gets in, waits for the block, and reads what the account says about its batch. */
async function lands(k, tx, account = d().account) {
  k.log("Submitting to the alt-mempool");
  let h;
  try {
    h = await submit(tx);
  } catch (e) {
    const msg = e instanceof RpcError ? e.message : String(e?.message ?? e);
    if (REPLACE.test(msg)) throw new Replace(msg);
    throw e;
  }
  k.log("Admitted. Waiting for the block");
  const r = await waitReceipt(h);
  const v = verdictOf(r, account);
  k.log(v.ok ? "Mined. The account reports every guarantee held" : v.ok === false ? `Mined, and the batch reverted: ${v.name ?? "see the receipt"}` : "Mined");
  return { r, out: { kind: v.ok === false ? "reverted" : "landed", txHash: h, txUrl: explorerTx(h), block: Number(BigInt(r.blockNumber)), frames: framesOf(r), name: v.name, raw: v.raw, human: v.human } };
}

const is = (re) => (msg, x) => re.test(`${msg} ${x.raw ?? ""}`);

/** A side deployment's snapshot lasts six hours like any other: renew it, root unchanged, when it is about to lapse. */
async function renew(k, pm) {
  const [epoch, [root, , exp]] = await Promise.all([pub.readContract({ address: pm, abi: STORE, functionName: "trustEpoch" }), pub.readContract({ address: pm, abi: STORE, functionName: "snapshot" })]);
  const t = await now();
  if (exp - t >= 1800n) return;
  k.log("Renewing the side deployment's snapshot: the same root, the next epoch");
  const u = emptyUpdate(epoch + 1n, root, t - 60n);
  const signers = attestors(k.env, readSnapAttestors());
  const sigs = await Promise.all(signers.map((a) => a.sign({ hash: updateHash(1337n, pm, u) })));
  await sendLegacy(k.payer, pm, encodeRefresh(u, sigs), 0n, 25_000_000n);
}

// ---- G0: the probes. A small account that checks what EIP-8141 and the alt-mempool actually do, apart from Verbatim ----
const PROBE = parseAbi(["function verifyFrame(bytes32 msgA, bytes32 msgB, uint256 nA, uint256 total, address other, bytes32 otherHash, uint256 scope)", "function ping()"]);
const PROBE_PM = parseAbi(["function pay(uint256 rounds)"]);
const EXPIRY_VERIFIER = "0x0000000000000000000000000000000000008141";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PROBE_EXPIRY_GAS = 5_000n;
const MSG_A = keccak256(encodePacked(["string"], ["owner digest"]));
const MSG_B = keccak256(encodePacked(["string"], ["attestor snapshot digest"]));

/** Four SECP256K1 entries with explicit msgs: two over one test message, two over another. Neither is a real digest. */
async function probeEntries(k) {
  const [o1, o2] = owners(k.env);
  const keys = [o1, o2, ...attestors(k.env, readSnapAttestors())];
  return Promise.all(
    keys.map(async (a, i) => {
      const hash = i < 2 ? MSG_A : MSG_B;
      const sig = await a.sign({ hash });
      const v = parseInt(sig.slice(130, 132), 16);
      return { scheme: 1, signer: a.address, msg: hash, signature: concat([toHex(v >= 27 ? v - 27 : v, { size: 1 }), `0x${sig.slice(2, 130)}`]) };
    }),
  );
}

async function probeTx(k, shape, opts = {}) {
  const account = d().probeG0;
  await k.ethFor(account, parseEther("0.01"));
  const nonce = BigInt(await pub.getTransactionCount({ address: account }));
  const scope = shape === "self" ? 3n : 2n;
  const otherHash = keccak256(await pub.getCode({ address: PERMIT2 }));
  const verify = frame({ mode: Mode.VERIFY, flags: shape === "self" ? Scope.EXECUTION_AND_PAYMENT : Scope.EXECUTION, target: account, execution: opts.accountGas ?? 60_000n, data: encodeFunctionData({ abi: PROBE, functionName: "verifyFrame", args: [MSG_A, MSG_B, 2n, 4n, PERMIT2, otherHash, scope] }) });
  const frames = [frame({ mode: Mode.VERIFY, flags: 0, target: EXPIRY_VERIFIER, execution: PROBE_EXPIRY_GAS, state: 0n, data: toHex(opts.expiry ?? (await now()) + 240n, { size: 8 }) }), verify];
  if (shape === "pay") frames.push(frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: d().probePaymaster, execution: 20_000n, data: encodeFunctionData({ abi: PROBE_PM, functionName: "pay", args: [1n] }) }));
  frames.push(frame({ mode: Mode.SENDER, target: account, execution: 100_000n, state: 200_000n, data: encodeFunctionData({ abi: PROBE, functionName: "ping" }) }));
  return newTx({ chainId: 1337, sender: account, nonce, maxFeePerGas: 2_000_000_000n * (k.bump ?? 1n), signatures: await probeEntries(k), frames });
}

/** A probe lands when it is mined and every frame succeeds. */
async function probeLands(k, tx) {
  const { out } = await lands(k, tx, d().probeG0);
  const ok = out.frames.length > 0 && out.frames.every((f) => f.status === 1);
  return { ...out, kind: "landed", asExpected: ok, note: ok ? `All ${out.frames.length} frames succeeded.` : `Frame statuses: ${out.frames.map((f) => f.status).join(", ")}.` };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The cases, by proof-ledger id. `path` says which frame layout the transaction uses.
const CASES = {
  HONEST: {
    path: "paymaster",
    title: "Honest 4-frame transfer",
    async run(k) {
      const before = await bal(d().tokens.dUSDC, victim());
      const { out } = await lands(k, await k.sign(await k.pm([transfer(victim())])));
      const got = (await bal(d().tokens.dUSDC, victim())) - before;
      return { ...out, asExpected: out.kind === "landed" && got === ONE_DUSDC, note: `The recipient received ${Number(got) / 1e6} dUSDC.` };
    },
  },
  A1: {
    path: "paymaster",
    title: "Swap the recipient",
    async run(k) {
      const honest = await k.pm([transfer(victim())]);
      const lie = await k.pm([transfer(THIEF)], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: honest.spec }, skipTickets: true });
      return refused(k, await k.sign(lie), is(/TreeMismatch|SpecHashMismatch/));
    },
  },
  A2: {
    path: "paymaster",
    title: "minOut=0 through SkimHook under an honest sentence",
    async run(k) {
      const shown = await k.pm([swap(d().pools.honest.key, MIN_OUT)]);
      const lie = await k.pm([swap(d().pools.evil.key, 0n)], { expiry: shown.expiry, overrideSentence: { tree: shown.tree, spec: shown.spec }, skipTickets: true });
      return refused(k, await k.sign(lie), is(/TreeMismatch|SpecHashMismatch/));
    },
  },
  A2b: {
    path: "paymaster",
    title: "The owners sign the true SkimHook sentence",
    async run(k) {
      const p = await k.pm([swap(d().pools.evil.key, 0n)]);
      k.log(`The device shows: ${formatForDevice(decodeTree(p.tree)).filter((l) => l.risk).map((l) => l.text).join(" · ")}`);
      return refused(k, await k.sign(p), is(/PolicyRefused/));
    },
  },
  "A2-eoa": {
    path: "ordinary wallet",
    title: "The same evil route on an ordinary wallet",
    async run(k) {
      k.log("An ordinary wallet (the demo's fee payer) sends the route with a minimum output of 0, straight to the router");
      const token = d().tokens.dUSDC;
      const before = await bal(token, k.payer.address);
      const r = await sendLegacy(k.payer, router(), v4SwapCall({ key: d().pools.evil.key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: 0n }, deadline()), SWAP_IN, 3_000_000n);
      const got = (await bal(token, k.payer.address)) - before;
      k.log(`It landed. The wallet received ${Number(got) / 1e6} dUSDC for 0.001 ETH; the honest pool pays at least 2`);
      return { kind: "skimmed", txHash: r.transactionHash, txUrl: explorerTx(r.transactionHash), block: Number(r.blockNumber), asExpected: got * 10n < MIN_OUT, note: `Received ${Number(got) / 1e6} dUSDC. Nothing checked what the route did.` };
    },
  },
  A3: {
    path: "paymaster",
    title: "Drop the renderer frame (self-pay layout)",
    async run(k) {
      const honest = await k.pm([transfer(victim())]);
      const f = honest.tx.frames;
      const selfPay = newTx({ chainId: 1337, sender: d().account, nonce: honest.tx.nonceSeq, maxFeePerGas: honest.tx.fees.maxFeePerGas, maxPriorityFeePerGas: honest.tx.fees.maxPriorityFeePerGas, frames: [f[0], { ...f[1], flags: Scope.EXECUTION_AND_PAYMENT }, f[3]] });
      return refused(k, { ...selfPay, signatures: (await k.sign(honest)).signatures }, is(/BadLayout/));
    },
  },
  A3b: {
    path: "paymaster",
    title: "Swap in a permissive paymaster",
    async run(k) {
      const honest = await k.pm([transfer(victim())]);
      const f = honest.tx.frames;
      const swapped = { ...honest.tx, frames: [f[0], f[1], { ...f[2], target: d().probePaymaster, data: "0x" }, f[3]] };
      return refused(k, { ...swapped, signatures: (await k.sign(honest)).signatures }, is(/BadLayout/));
    },
  },
  A4: {
    path: "paymaster",
    title: "Signed weaker spec hash",
    async run(k) {
      const honest = await k.pm([transfer(victim())]);
      const claimed = await k.pm([transfer(victim())], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: "0x565300020000" }, skipTickets: true });
      return refused(k, await k.sign(claimed), is(/SpecHashMismatch/));
    },
  },
  A4b: {
    path: "paymaster",
    title: "Weak spec bytes under the honest hash",
    async run(k) {
      const honest = await k.pm([transfer(victim())]);
      const f = honest.tx.frames;
      const t = { ...honest.tx, frames: [f[0], f[1], f[2], { ...f[3], data: executeFrameData(honest.calls, "0x565300020000") }] };
      return refused(k, await k.resign(honest, t), is(/SpecHashMismatch/));
    },
  },
  A5: {
    path: "paymaster",
    title: "Poisoned descriptor (unattested code)",
    async run(k) {
      return refused(k, await k.sign(await k.pm([{ target: d().probeAccount, value: 0n, data: "0xdeadbeef" }])), is(/PolicyRefused/));
    },
  },
  A6: {
    path: "paymaster",
    title: "EvilVault keeps the ETH and credits no shares",
    async run(k) {
      const value = 1_000_000_000_000n;
      await k.ethFor(d().account, value * 20n);
      const ethBefore = await pub.getBalance({ address: d().account });
      const call = { target: d().evilVault, value, data: encodeFunctionData({ abi: parseAbi(["function depositEth(uint256)"]), functionName: "depositEth", args: [value] }) };
      const { out } = await lands(k, await k.sign(await k.pm([call])));
      const kept = (await pub.getBalance({ address: d().account })) === ethBefore;
      return { ...out, asExpected: out.kind === "reverted" && out.name === "AssertionFailed" && kept, note: kept ? "The account's ETH is back where it was." : "The account's ETH changed." };
    },
  },
  A7: {
    path: "paymaster",
    title: "Stale pre-signed transaction past its expiry",
    async run(k) {
      const t = await now();
      const signed = await k.sign(await k.pm([transfer(victim())], { expiry: t + 10n }));
      k.log("Signed with a 10-second expiry. The host holds it until that passes");
      while ((await now()) <= t + 12n) await sleep(2500);
      return refused(k, signed, is(/frame 0/));
    },
  },
  A7b: {
    path: "paymaster",
    title: "Expiry frame starved of gas",
    async run(k) {
      const p = await k.pm([transfer(victim())], { gas: { ...PUBLIC_GATEWAY_GAS, expiry: 2_000n } });
      return refused(k, await k.sign(p), is(/BadLayout|frame 0: ran out of gas/));
    },
  },
  A9: {
    path: "paymaster",
    title: "No fee ticket for this nonce",
    async run(k) {
      const p = await k.pm([transfer(victim(), 1n)], { account: d().emptyDepositAccount, skipTickets: true });
      return refused(k, await k.sign(p), is(/NoTicket/));
    },
  },
  A10: {
    path: "paymaster",
    title: "7702-delegated sender",
    async run(k) {
      const eoa = privateKeyToAccount(generatePrivateKey());
      k.log("Funding a fresh address and delegating it to the account's code with EIP-7702");
      await sendLegacy(k.payer, eoa.address, "0x", parseEther("0.005"), 500_000n);
      const chain = { id: 1337, name: "frames-devnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [DEVNET.node] } } };
      const w = createWalletClient({ account: eoa, chain, transport: http(DEVNET.node) });
      const auth = await eoa.signAuthorization({ chainId: 1337, contractAddress: d().account, nonce: 1 });
      const hash = await w.sendTransaction({ to: eoa.address, authorizationList: [auth], gas: 300_000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1000n, type: "eip7702" });
      await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      const p = await k.pm([transfer(victim(), 1n)], { account: eoa.address, skipTickets: true });
      return refused(k, withSignatures(p.tx, p.digest, []), () => true);
    },
  },
  A11: {
    path: "paymaster",
    title: "Reentrancy into executeVerified",
    async run(k) {
      const inner = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeVerified", args: [[transfer(THIEF)], "0x"] });
      const call = { target: d().reenterer, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function attack(address,bytes)"]), functionName: "attack", args: [d().account, inner] }) };
      const before = await bal(d().tokens.dUSDC, d().account);
      const { out } = await lands(k, await k.sign(await k.pm([call])));
      return { ...out, asExpected: out.kind === "reverted" && out.name === "CallFailed" && (await bal(d().tokens.dUSDC, d().account)) === before };
    },
  },
  A12: {
    path: "paymaster",
    title: "Gas griefing: a call burns all its gas",
    async run(k) {
      const call = { target: d().gasBurner, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function burn()"]), functionName: "burn", args: [] }) };
      const { out } = await lands(k, await k.sign(await k.pm([call])));
      return { ...out, asExpected: out.kind === "reverted" && out.frames.at(-1)?.status === 1, note: "The execute frame itself succeeded: the reserve kept enough gas to undo the batch and keep the fee." };
    },
  },
  A13: {
    path: "paymaster",
    title: "Future-dated expiry",
    async run(k) {
      const p = await k.pm([transfer(victim())], { expiry: (await now()) + 3600n });
      let device = "accepted";
      try {
        review({ tree: p.tree, txCommit: p.txCommit });
      } catch (e) {
        device = e.message;
      }
      k.log(`The device: ${device}. Signed anyway, the way a compromised device would`);
      const before = await bal(d().tokens.dUSDC, victim());
      const { out } = await lands(k, await k.sign(p));
      return { ...out, asExpected: /stay valid/.test(device) && out.kind === "reverted" && out.name === "TtlTooLong" && (await bal(d().tokens.dUSDC, victim())) === before };
    },
  },
  A14: {
    path: "paymaster",
    title: "Two transactions, one fee ticket",
    async run(k) {
      const acct = d().emptyDepositAccount;
      const nonce = BigInt(await pub.getTransactionCount({ address: acct }));
      k.log("Prepaying exactly one fee ticket, for this nonce");
      await sendLegacy(k.payer, d().paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [acct, nonce, 1n] }), TICKET, 2_000_000n);
      const { out: first } = await lands(k, await k.sign(await k.pm([transfer(victim(), 0n)], { account: acct, skipTickets: true })), acct);
      await sleep(6000);
      k.log("The second transaction, on the next nonce, with no ticket of its own");
      const res = await refused(k, await k.sign(await k.pm([transfer(victim(), 0n)], { account: acct, skipTickets: true })), is(/NoTicket/));
      return { ...res, asExpected: res.asExpected && first.frames.at(-1)?.status === 1, note: `The first drew the ticket: ${first.txHash}.` };
    },
  },
  A16: {
    path: "paymaster",
    title: "Router command with the allow-revert flag",
    async run(k) {
      const input = v4ExactInSingleInput({ key: d().pools.honest.key, zeroForOne: true, amountIn: 1n, amountOutMinimum: 1n });
      const p = await k.pm([{ target: router(), value: 1n, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [input], deadline()) }]);
      const shown = formatForDevice(decodeTree(p.tree)).some((l) => /MAY PARTIALLY FAIL/.test(l.text));
      return refused(k, await k.sign(p), (m, x) => shown && /PolicyRefused/.test(`${m} ${x.raw}`));
    },
  },
  A17: {
    path: "paymaster",
    title: "Unknown router command (PERMIT2_PERMIT)",
    async run(k) {
      return refused(k, await k.sign(await k.pm([{ target: router(), value: 0n, data: executeData([0x0a], ["0x1234"], deadline()) }])), is(/PolicyRefused/));
    },
  },
  A17b: {
    path: "paymaster",
    title: "Unknown v4 action (SWAP_EXACT_OUT)",
    async run(k) {
      const params = [1n, 2n, 3n].map((x) => encodeAbiParameters([{ type: "uint256" }], [x]));
      const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x090c0f", params]);
      return refused(k, await k.sign(await k.pm([{ target: router(), value: 0n, data: executeData([CMD.V4_SWAP], [input], deadline()) }])), is(/PolicyRefused/));
    },
  },
  B14: {
    path: "paymaster",
    title: "An approval left standing after the batch",
    async run(k) {
      const token = d().tokens.dUSDC;
      const before = await pub.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [d().account, d().evilVault] });
      const { out } = await lands(k, await k.sign(await k.pm([{ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [d().evilVault, 5n] }) }])));
      const after = await pub.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [d().account, d().evilVault] });
      return { ...out, asExpected: out.kind === "reverted" && out.name === "AssertionFailed" && after === before, note: `The vault's allowance is ${after}, as before.` };
    },
  },
  A18: {
    path: "paymaster",
    title: "Return bomb: a call reverts with 500 KB",
    async run(k) {
      const call = { target: d().returnBomb, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function detonate(uint256)"]), functionName: "detonate", args: [500_000n] }) };
      const { out } = await lands(k, await k.sign(await k.pm([call])));
      return { ...out, raw: (out.raw ?? "").slice(0, 200), asExpected: out.kind === "reverted" && out.frames.at(-1)?.status === 1 };
    },
  },
  F7: {
    path: "paymaster",
    title: "Fee failure runs nothing",
    async run(k) {
      const pm = d().feeFailPaymaster;
      const acct = d().feeFailAccount;
      await renew(k, pm);
      const token = d().tokens.dUSDC;
      const before = await bal(token, acct);
      const p = await k.pm([{ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [victim(), 1n] }) }], { account: acct, paymaster: pm });
      const { out } = await lands(k, await k.sign(p), acct);
      const statuses = out.frames.map((f) => f.status);
      return { ...out, kind: statuses[3] === 0 ? "fee-failed" : out.kind, asExpected: statuses[3] === 0 && (await bal(token, acct)) === before, note: `Frame statuses: ${statuses.join(", ")}. The execute frame failed on the fee, so nothing ran.` };
    },
  },
  SWAP: {
    path: "paymaster",
    title: "Honest v4 swap through the real Universal Router",
    async run(k) {
      await k.ethFor(d().account, SWAP_IN * 5n);
      const before = await bal(d().tokens.dUSDC, d().account);
      const { out } = await lands(k, await k.sign(await k.pm([swap(d().pools.honest.key, MIN_OUT)])));
      const got = (await bal(d().tokens.dUSDC, d().account)) - before;
      return { ...out, asExpected: out.kind === "landed" && got >= MIN_OUT, note: `Received ${Number(got) / 1e6} dUSDC, at least the signed minimum of 2.` };
    },
  },
  WRAP: {
    path: "paymaster",
    title: "WRAP_ETH through the real Universal Router",
    async run(k) {
      const amount = 1_000_000_000_000n;
      await k.ethFor(d().account, amount * 20n);
      const { out } = await lands(k, await k.sign(await k.pm([{ target: router(), value: amount, data: executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, amount)], deadline()) }])));
      return { ...out, asExpected: out.kind === "landed" };
    },
  },

  // ---- the stateless path: no paymaster, no stake; the account renders from proofs it carries ----
  "S-HONEST": {
    path: "stateless",
    title: "Stateless path: honest transfer, no paymaster, no stake",
    async run(k) {
      await k.snapshot();
      const before = await bal(d().tokens.dUSDC, victim());
      const { out } = await lands(k, await k.signSl(await k.sl([transfer(victim())])));
      return { ...out, asExpected: out.kind === "landed" && (await bal(d().tokens.dUSDC, victim())) - before === ONE_DUSDC };
    },
  },
  "S-SWAP": {
    path: "stateless",
    title: "Stateless path: v4 swap through the real Universal Router",
    async run(k) {
      await k.snapshot();
      await k.ethFor(d().account, SWAP_IN * 5n);
      const before = await bal(d().tokens.dUSDC, d().account);
      const { out } = await lands(k, await k.signSl(await k.sl([swap(d().pools.honest.key, MIN_OUT)])));
      return { ...out, asExpected: out.kind === "landed" && (await bal(d().tokens.dUSDC, d().account)) - before >= MIN_OUT };
    },
  },
  "S-WRAP": {
    path: "stateless",
    title: "Stateless path: WRAP_ETH through the real Universal Router",
    async run(k) {
      await k.snapshot();
      const amount = 1_000_000_000_000n;
      const { out } = await lands(k, await k.signSl(await k.sl([{ target: router(), value: amount, data: executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, amount)], deadline()) }])));
      return { ...out, asExpected: out.kind === "landed" };
    },
  },
  "S-A1": {
    path: "stateless",
    title: "Stateless: recipient swapped under an honest sentence",
    async run(k) {
      await k.snapshot();
      const honest = await k.sl([transfer(victim())]);
      const lie = await k.sl([transfer(THIEF)], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: honest.spec } });
      return refused(k, await k.signSl(lie), is(/TreeMismatch/));
    },
  },
  "S-A2": {
    path: "stateless",
    title: "Stateless: minOut=0 through SkimHook under an honest sentence",
    async run(k) {
      await k.snapshot();
      const honest = await k.sl([swap(d().pools.honest.key, MIN_OUT)]);
      const lie = await k.sl([swap(d().pools.evil.key, 0n)], { expiry: honest.expiry, overrideSentence: { tree: honest.tree, spec: honest.spec } });
      return refused(k, await k.signSl(lie), is(/TreeMismatch|frame 1: reverted|ran out of gas/));
    },
  },
  "S-A2b": {
    path: "stateless",
    title: "Stateless: the true SkimHook sentence",
    async run(k) {
      await k.snapshot();
      return refused(k, await k.signSl(await k.sl([swap(d().pools.evil.key, 0n)])), is(/PolicyRefused|frame 1: reverted|ran out of gas/));
    },
  },
  B1: {
    path: "stateless",
    title: "NFT drainer through an unattested collection",
    async run(k) {
      await k.snapshot();
      const data = encodeFunctionData({ abi: parseAbi(["function setApprovalForAll(address,bool)"]), functionName: "setApprovalForAll", args: [THIEF, true] });
      return refused(k, await k.signSl(await k.sl([{ target: d().reenterer, value: 0n, data }])), is(/PolicyRefused/));
    },
  },
  B3: {
    path: "stateless",
    title: "Attestors signed this snapshot for another chain",
    async run(k) {
      const snap = await k.snapshot();
      const signers = attestors(k.env, snap.attestors);
      const other = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(snapshotTypedData(1n, snap.root, BigInt(snap.issuedAt), BigInt(snap.expiry))) })));
      const p = await k.sl([transfer(victim(), 1n)]);
      return refused(k, await k.signSl(p, { ...snap, signatures: other }), is(/BadSignatureEntry|Invalid frame transaction signature|signature/i));
    },
  },
  B5: {
    path: "stateless",
    title: "A TOKEN leaf presented as a DESC",
    async run(k) {
      const snap = await k.snapshot();
      const t = treeOf(snap);
      const token = t.leaves.find((l) => l.type === 2);
      const forged = encodeProofs(t, [token]).replace(/^0x(..)02/, "0x$101");
      return refused(k, await k.signSl(await k.sl([transfer(victim(), 1n)], { proofsOverride: forged })), is(/PolicyRefused|BadProof|TreeMismatch/));
    },
  },
  B6: {
    path: "stateless",
    title: "Padding the signature list",
    async run(k) {
      await k.snapshot();
      const tx = await k.signSl(await k.sl([transfer(victim(), 1n)]));
      return refused(k, { ...tx, signatures: [...tx.signatures, tx.signatures.at(-1)] }, is(/BadSignatureEntry|exceeds MAX_VERIFY_GAS|gas/));
    },
  },
  B7: {
    path: "stateless",
    title: "Leaving the TOKEN proof out",
    async run(k) {
      const snap = await k.snapshot();
      const t = treeOf(snap);
      const honest = await k.sl([transfer(victim(), 1n)]);
      const desc = t.leaves.filter((l) => l.type === 1 && honest.proofs.includes(keccak256(l.vdesc).slice(2)));
      return refused(k, await k.signSl(await k.sl([transfer(victim(), 1n)], { proofsOverride: encodeProofs(t, desc) })), is(/PolicyRefused|TreeMismatch/));
    },
  },
  B9: {
    path: "stateless",
    title: "A far-future snapshot expiry",
    async run(k) {
      await k.snapshot();
      return refused(k, await k.signSl(await k.sl([transfer(victim(), 1n)], { extraOverride: (x) => ({ ...x, snapExpiry: x.issuedAt + 7n * 3600n }) })), is(/SnapshotTtlTooLong/));
    },
  },
  "B11-A3": {
    path: "stateless",
    title: "Stateless: signing for one layout, sending another",
    async run(k) {
      await k.snapshot();
      const tx = await k.signSl(await k.sl([transfer(victim(), 1n)]));
      const f = tx.frames;
      return refused(k, { ...tx, frames: [f[0], { ...f[1], flags: 2 }, f[2]] }, is(/BadLayout|validation prefix not recognized/));
    },
  },
  "B11-A7": {
    path: "stateless",
    title: "Stateless: stale signature",
    async run(k) {
      await k.snapshot();
      const t = await now();
      const stale = await k.signSl(await k.sl([transfer(victim(), 1n)], { expiry: t + 8n }));
      k.log("Signed with an 8-second expiry. The host holds it until that passes");
      while ((await now()) <= t + 10n) await sleep(2000);
      return refused(k, stale, is(/frame 0/));
    },
  },
  "B11-A7b": {
    path: "stateless",
    title: "Stateless: expiry frame starved of gas",
    async run(k) {
      await k.snapshot();
      const starved = await k.signSl(await k.sl([transfer(victim(), 1n)], { gas: { expiry: 2_000n, account: 85_300n, execute: 1_200_000n, executeState: 1_500_000n } }));
      return refused(k, starved, is(/BadLayout|frame 0: ran out of gas/));
    },
  },
  I13: {
    path: "stateless",
    title: "One digest executes at most once",
    async run(k) {
      await k.snapshot();
      const p = await k.sl([transfer(victim(), 1n)]);
      const tx = await k.signSl(p);
      const { out } = await lands(k, tx);
      await sleep(6000);
      const consumed = await pub.readContract({ address: d().account, abi: ACCOUNT_ABI, functionName: "consumed", args: [p.digest] });
      k.log(`consumed[D_owner] is ${consumed}`);
      return { ...out, asExpected: consumed === true, note: `After landing, consumed[D_owner] = ${consumed}.` };
    },
  },
  B12: {
    path: "stateless",
    title: "Same signed content under a different nonce key",
    async run(k) {
      await k.snapshot();
      const p = await k.sl([transfer(victim(), 1n)]);
      const tx = await k.signSl(p);
      const { out } = await lands(k, tx);
      k.log(`The original landed: ${out.txHash}. Now the same signed content under a nonce key`);
      await sleep(6000);
      const keyA = BigInt(Math.floor(Date.now() / 1000)) << 8n;
      return refused(k, { ...tx, nonceKeys: [keyA] }, is(/Nonce mismatch|ran out of gas|Replayed|nonce/i));
    },
  },

  // ---- G0: what the protocol and the alt-mempool do, measured with a probe account ----
  G0a: {
    path: "probe",
    title: "Expiry verifier deployed",
    async run(k) {
      const code = await pub.getCode({ address: EXPIRY_VERIFIER });
      const spec = await pub.getCode({ address: "0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf" });
      k.log(`Code at ${EXPIRY_VERIFIER}: ${code ? `${(code.length - 2) / 2} bytes` : "none"}. At the spec's address: ${spec ? `${(spec.length - 2) / 2} bytes` : "none"}`);
      return { kind: "checked", asExpected: !!code && code !== "0x", note: `The canonical expiry verifier has code at ${EXPIRY_VERIFIER}${spec ? "" : ", not at the address the spec names: a finding"}.` };
    },
  },
  G0b: {
    path: "probe",
    title: "Two explicit msgs in four SECP256K1 entries, read in a SIGPARAM loop",
    async run(k) {
      return probeLands(k, await probeTx(k, "self"));
    },
  },
  G0d: {
    path: "probe",
    title: "EXTCODEHASH of a contract that is no entity, in an unstaked sender's VERIFY",
    async run(k) {
      return probeLands(k, await probeTx(k, "self"));
    },
  },
  G0e1: {
    path: "probe",
    title: "[expiry_verify, self_verify] prefix",
    async run(k) {
      return probeLands(k, await probeTx(k, "self"));
    },
  },
  G0e2: {
    path: "probe",
    title: "[expiry_verify, only_verify, pay] prefix with a staked paymaster",
    async run(k) {
      return probeLands(k, await probeTx(k, "pay"));
    },
  },
  G0c: {
    path: "probe",
    title: "Signature gas counts toward the 100k cap",
    async run(k) {
      k.log("Declared limits plus four signatures at 2,800 each: exactly 100,000 first");
      const at = await probeLands(k, await probeTx(k, "self", { accountGas: 100_000n - 11_200n - PROBE_EXPIRY_GAS }));
      await sleep(4000);
      k.log("Then one gas more: 100,001");
      const over = await refused(k, await probeTx(k, "self", { accountGas: 100_000n - 11_200n - PROBE_EXPIRY_GAS + 1n }), is(/MAX_VERIFY_GAS|exceeds/i));
      const overText = over.kind === "rejected" ? "the mempool refused it" : `it was admitted too (${over.txHash}): the deployed sidecar no longer enforces a flat 100,000 cap`;
      return { ...over, asExpected: at.asExpected && over.kind === "rejected" && over.asExpected, note: `At exactly 100,000 it was admitted and mined (${at.txHash}). At 100,001 ${overText}.` };
    },
  },
  G0f: {
    path: "probe",
    title: "A transaction past its expiry",
    async run(k) {
      return refused(k, await probeTx(k, "self", { expiry: (await now()) - 60n }), () => true);
    },
  },
  "S-B12": {
    path: "stateless",
    title: "Stateless: the same signed content again",
    async run(k) {
      await k.snapshot();
      const tx = await k.signSl(await k.sl([transfer(victim(), 1n)]));
      const { out } = await lands(k, tx);
      k.log(`The original landed: ${out.txHash}. Now the identical transaction again`);
      await sleep(6000);
      return refused(k, tx, () => true);
    },
  },
  "CANONICAL-UNSTAKED": {
    path: "paymaster",
    title: "Unstaked renderer: the public sidecar refuses it",
    async run(k) {
      const u = d().unstaked;
      await renew(k, u.paymaster);
      const call = { target: u.dUSDC, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [victim(), 1n] }) };
      k.log("The same paymaster code, deployed without a stake");
      const p = await k.pm([call], { account: u.account, paymaster: u.paymaster });
      return refused(k, await k.sign(p), is(/unstaked|StorageReadNonSender|stake/i));
    },
  },
};

let published;
const readSnapAttestors = () => (published ??= readData("snapshot-devnet.json")).attestors;

// ---------------------------------------------------------------------------------------------------------------------------
// Runs, one at a time: every case spends the same accounts' nonces.
const runs = new Map();
const queue = [];
let running = false;
let hour = { at: 0, n: 0 };

const view = (run) => ({ id: run.id, case: run.case, title: run.title, path: run.path, status: run.status, position: run.status === "queued" ? queue.indexOf(run) + 1 : 0, steps: run.steps, result: run.result, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt });

async function pump(env) {
  if (running) return;
  running = true;
  while (queue.length) {
    const run = queue[0];
    run.status = "running";
    run.startedAt = Date.now();
    try {
      const block = await pub.getBlock().catch(() => null);
      if (!block || Date.now() / 1000 - Number(block.timestamp) > 120) throw new Error("the frames devnet is not producing blocks right now");
      // A transaction left in the pool on this nonce (someone else's run, or one the node holds but will never mine) blocks the
      // next one until it is replaced at a higher fee.
      for (let bump = 1n; ; bump *= 2n) {
        const k = kit(env, run, bump);
        await ensurePayer(k.payer, k.log);
        // The paymaster's cached snapshot must be live for any paymaster-path case; the stateless ones carry their own.
        if (CASES[run.case].path === "paymaster") await k.snapshot();
        try {
          run.result = await CASES[run.case].run(k);
          break;
        } catch (e) {
          if (!(e instanceof Replace) || bump >= 16n) throw e;
          k.log("The pool already holds a transaction on this nonce. Rebuilding at a higher fee to replace it");
          await sleep(3000);
        }
      }
      run.status = "done";
    } catch (e) {
      run.status = "failed";
      run.error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 400);
    }
    run.finishedAt = Date.now();
    queue.shift();
    await sleep(1500);
  }
  running = false;
}

/** GET /api/frames/cases: what can run, by proof-ledger id. */
export const list = () => ({ cases: Object.entries(CASES).map(([id, c]) => ({ id, title: c.title, path: c.path })), queued: queue.length });

/** POST /api/frames/case { id } */
export function start(env, body, ip) {
  owners(env);
  const id = String(body?.id ?? "");
  if (!CASES[id]) throw new HttpError(404, `no runnable devnet case ${id}`);
  limit(`frames-case:${ip}`, 12);
  if (Date.now() - hour.at > 3600_000) hour = { at: Date.now(), n: 0 };
  if (hour.n >= RUNS_PER_HOUR) throw new HttpError(429, "the demo has used this hour’s devnet runs. Try again later");
  if (queue.length >= 20) throw new HttpError(429, "too many devnet runs are waiting. Try again in a minute");
  hour.n++;
  const run = { id: crypto.randomUUID(), case: id, title: CASES[id].title, path: CASES[id].path, status: "queued", steps: [], result: null, error: null, startedAt: null, finishedAt: null, createdAt: Date.now() };
  runs.set(run.id, run);
  if (runs.size > 200) runs.delete(runs.keys().next().value);
  queue.push(run);
  pump(env);
  return view(run);
}

/** GET /api/frames/case/:id */
export function get(id) {
  const run = runs.get(String(id));
  if (!run) throw new HttpError(404, "no such run; the server may have restarted");
  return view(run);
}

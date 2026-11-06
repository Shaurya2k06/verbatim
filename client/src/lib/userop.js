// The production leg (Sepolia, ERC-4337) from the browser: build with @verbatim/client, send through the server's bundler proxy,
// and when a bundler refuses, ask the account itself why, exactly as the EntryPoint would.
import { BaseError, ContractFunctionRevertedError, concat, decodeAbiParameters, decodeErrorResult, encodeFunctionData, keccak256, pad, parseAbi, toHex } from "viem";
import { packedUniswap, prepareUserOp, userOpWithSignatures } from "@verbatim/client";
import { v4SwapCall } from "@verbatim/urrender";
import { ERRORS as KIT_ERRORS, EXPLAIN } from "@verbatim/app-kit/errors";
import ACCOUNT_ABI from "./abi/VerbatimAccount4337.json";
import { api, apiGet } from "./api";
import { load } from "./data";
import { SEPOLIA_BUNDLER, rpc, sepoliaPublic } from "./networks";

export { ACCOUNT_ABI };
const pub = () => sepoliaPublic();
const ERRORS = [...ACCOUNT_ABI.filter((x) => x.type === "error"), ...KIT_ERRORS.filter((e) => !ACCOUNT_ABI.some((x) => x.type === "error" && x.name === e.name))];
const VERBATIM_RESULT = keccak256(toHex("VerbatimResult(bool,bytes)"));

/** The deployment, and a snapshot fresh enough to sign under (the server re-signs the published root when it nears expiry). */
export async function context() {
  const [deps, snapshot] = await Promise.all([load("manifest.json").then(() => load("deployments/sepolia.json")), apiGet("/snapshot/sepolia").catch(() => load("deployments/snapshot-sepolia.json"))]);
  return { dep: deps, snapshot };
}

export function decodeError(data) {
  if (!data || data === "0x") return null;
  try {
    const e = decodeErrorResult({ abi: ERRORS, data });
    const args = (e.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a)));
    return { name: e.errorName, args, raw: `${e.errorName}(${args.join(", ")})`, human: EXPLAIN[e.errorName] ?? null };
  } catch {
    return { name: null, args: [], raw: data, human: null };
  }
}

export async function fees() {
  try {
    const r = await rpc(SEPOLIA_BUNDLER, "pimlico_getUserOperationGasPrice");
    return { maxFeePerGas: BigInt(r.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(r.fast.maxPriorityFeePerGas) };
  } catch {
    return pub().estimateFeesPerGas();
  }
}

export async function accountState(account) {
  const read = (functionName, args = []) => pub().readContract({ address: account, abi: ACCOUNT_ABI, functionName, args });
  const [owners, threshold, attestorThreshold, maxTtl, maxSnapshotTtl, allowMask, policyVersion, ledger, watchlist] = await Promise.all(
    ["owners", "threshold", "attestorThreshold", "maxTtl", "maxSnapshotTtl", "allowMask", "policyVersion", "ledger", "watchlist"].map((f) => read(f).catch(() => null)),
  );
  return { owners, threshold: Number(threshold), attestorThreshold: Number(attestorThreshold), maxTtl: Number(maxTtl), maxSnapshotTtl: Number(maxSnapshotTtl), allowMask: Number(allowMask), policyVersion: Number(policyVersion), ledger, watchlist };
}

/**
 * Renders and prepares a user operation. `override` puts a different sentence on it than its calls render to: that is how the
 * attacks lie. `validity` is seconds from the chain's clock, capped by the snapshot's own expiry.
 */
export async function prepare({ calls, override, validity = 240 }) {
  const { dep, snapshot } = await context();
  const [block, f] = await Promise.all([pub().getBlock(), fees()]);
  let expiry = block.timestamp + BigInt(validity);
  const cap = BigInt(snapshot.expiry) - 30n;
  if (validity > 0 && expiry > cap) expiry = cap;
  const p = await prepareUserOp({
    client: pub(),
    account: dep.account,
    calls,
    snapshot,
    router: { permit2: dep.uniswap.permit2, weth: dep.uniswap.weth9, publisher: packedUniswap },
    fees: f,
    expiry,
    override,
  });
  return { ...p, dep };
}

/** The signing request the offline device reads. On this path txCommit is the user operation hash. */
export const requestOf = (p) => ({ tree: p.tree, txCommit: p.hash });

/** The account's own validation verdict, by the call the EntryPoint makes. Null when validation passes. */
export async function validationVerdict(p, op) {
  const two = (hi, lo) => concat([pad(hi, { size: 16 }), pad(lo, { size: 16 })]);
  const packed = { sender: op.sender, nonce: BigInt(op.nonce), initCode: "0x", callData: op.callData, accountGasLimits: two(op.verificationGasLimit, op.callGasLimit), preVerificationGas: BigInt(op.preVerificationGas), gasFees: two(op.maxPriorityFeePerGas, op.maxFeePerGas), paymasterAndData: "0x", signature: op.signature };
  try {
    await pub().simulateContract({ account: p.dep.entryPoint, address: op.sender, abi: ACCOUNT_ABI, functionName: "validateUserOp", args: [packed, p.hash, 0n] });
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (r?.data?.errorName) {
      const args = (r.data.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a)));
      return { name: r.data.errorName, args, raw: `${r.data.errorName}(${args.join(", ")})`, human: EXPLAIN[r.data.errorName] ?? null };
    }
    const data = e?.cause?.data ?? e?.data;
    return decodeError(typeof data === "string" ? data : null) ?? { name: null, raw: e.shortMessage ?? e.message, human: null };
  }
}

/** Sends through the server's bundler proxy. A refusal comes back as `{ rejected }`, with the account's own reason. */
export async function send(p, sigs) {
  const op = userOpWithSignatures(p, sigs);
  try {
    const hash = await rpc(SEPOLIA_BUNDLER, "eth_sendUserOperation", [op, p.dep.entryPoint], 30_000);
    return { userOpHash: hash, op };
  } catch (e) {
    const reason = await validationVerdict(p, op);
    return { rejected: true, bundler: e.message, reason, op };
  }
}

/** Waits for the operation, then reads the account's VerbatimResult: a refused batch still lands, so `success` says too little. */
export async function wait(userOpHash, account, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpc(SEPOLIA_BUNDLER, "eth_getUserOperationReceipt", [userOpHash]).catch(() => null);
    if (r) {
      const logs = r.logs ?? r.receipt?.logs ?? [];
      const l = logs.find((x) => x.address?.toLowerCase() === account.toLowerCase() && x.topics?.[0] === VERBATIM_RESULT);
      let result = null;
      if (l) {
        const ok = BigInt(l.topics[1]) === 1n;
        const [err] = decodeAbiParameters([{ type: "bytes" }], l.data);
        result = { ok, error: decodeError(err) };
      }
      return { txHash: r.receipt?.transactionHash, success: r.success, actualGasUsed: r.actualGasUsed ? BigInt(r.actualGasUsed) : null, result, logs: r.receipt?.logs ?? logs };
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("not mined within 3 minutes");
}

// --- Uniswap on Sepolia -------------------------------------------------------------------------------------------------------
const QUOTER = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

/** What the pool would pay for an ETH-in swap right now, from Uniswap's own v4 Quoter. */
export async function quote(dep, key, amountIn) {
  const { result } = await pub().simulateContract({ address: dep.uniswap.quoter, abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: true, exactAmount: amountIn, hookData: "0x" }] });
  return result[0];
}

export const swapCall = (dep, key, amountIn, minOut) => ({
  target: dep.uniswap.router,
  value: amountIn,
  data: v4SwapCall({ key, zeroForOne: true, amountIn, amountOutMinimum: minOut, legacyParams: !!dep.uniswap.routerLegacyParams }, BigInt(Math.floor(Date.now() / 1000) + 3600)),
});

export const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const transferCall = (token, to, amount) => ({ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] }) });

/** Sums a token's Transfer logs in a receipt into the given addresses. */
export function received(logs, token, to) {
  const topic = keccak256(toHex("Transfer(address,address,uint256)"));
  let sum = 0n;
  for (const l of logs ?? []) {
    if (l.address?.toLowerCase() !== token.toLowerCase() || l.topics?.[0] !== topic) continue;
    if (`0x${l.topics[2].slice(26)}`.toLowerCase() === to.toLowerCase()) sum += BigInt(l.data);
  }
  return sum;
}

export { api };

// The production leg's user operations: stateless, any bundler, no paymaster (context.md §11).
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { packedUniswap, prepareUserOp, userOpWithSignatures, type Call } from "@verbatim/client";
import type { PublishedSnapshot } from "@verbatim/snapshot-cli";
import { key } from "./env";
import { ENTRY_POINT, UNI, WETH_SEPOLIA, pub } from "./sepolia";

export const PATH_ERC4337 = 3;

export interface Gas {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
}

export const GAS: Gas = { callGasLimit: 1_500_000n, verificationGasLimit: 300_000n, preVerificationGas: 500_000n };

export async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)) });
  const b = (await res.json()) as any;
  if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.code, data: b.error.data });
  return b.result;
}

export async function gasPrice(bundler: string): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  try {
    const r = await rpc(bundler, "pimlico_getUserOperationGasPrice", []);
    return { maxFeePerGas: BigInt(r.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(r.fast.maxPriorityFeePerGas) };
  } catch {
    const block = await pub.getBlock();
    const prio = BigInt(await rpc(bundler, "rundler_maxPriorityFeePerGas", []));
    return { maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + prio, maxPriorityFeePerGas: prio };
  }
}

export interface Built {
  op: Record<string, unknown>;
  hash: Hex;
  digest: Hex;
  tree: Hex;
  spec: Hex;
  treeHash: Hex;
  specHash: Hex;
  risk: number;
  hints: Address[];
  expiry: bigint;
  proofs: Hex;
}

const CHAIN = 11155111;
void CHAIN;

/** Renders with the twin, proves from the snapshot, signs with two owners. `override` signs something other than what it sends. */
export async function buildOp(account: Address, calls: Call[], bundler: string, snapshot: PublishedSnapshot, opts: { expiry?: bigint; gas?: Gas; override?: { tree: Hex; spec: Hex } } = {}): Promise<Built> {
  const fees = await gasPrice(bundler);
  const expiry = opts.expiry ?? (await pub.getBlock()).timestamp + 240n;
  const p = await prepareUserOp({ client: pub as never, account, calls, snapshot, router: { permit2: UNI.permit2, weth: WETH_SEPOLIA, publisher: packedUniswap }, fees, expiry, gas: opts.gas ?? GAS, override: opts.override });
  const owners = ["OWNER1_KEY", "OWNER2_KEY"].map((k) => privateKeyToAccount(key(k)));
  const sigs = await Promise.all(owners.map(async (o) => ({ signer: o.address, sig: (await o.signTypedData(p.digestTypedData as never)) as Hex })));
  return { op: userOpWithSignatures(p, sigs), hash: p.hash, digest: p.digest, tree: p.tree, spec: p.spec, treeHash: p.treeHash, specHash: p.specHash, risk: p.risk, hints: p.hints, expiry: p.expiry, proofs: p.proofs };
}

export async function sendOp(bundler: string, op: Record<string, unknown>): Promise<Hex> {
  return rpc(bundler, "eth_sendUserOperation", [op, ENTRY_POINT]);
}

export async function waitOp(bundler: string, h: Hex, timeoutMs = 180_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpc(bundler, "eth_getUserOperationReceipt", [h]).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 4000));
  }
  throw new Error(`user operation ${h} not mined`);
}

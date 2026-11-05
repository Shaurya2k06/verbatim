// The production leg's user operations: stateless, any bundler, no paymaster (context.md §11).
import { concat, encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { SnapshotTrust, encodeBody, packedUniswap, renderWithChain, typedData, type Call } from "@verbatim/client";
import { encodeProofs, treeOf, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { key } from "./env";
import { ENTRY_POINT, UNI, WETH_SEPOLIA, pub } from "./sepolia";

const EP = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);
const ACCOUNT = parseAbi(["function policyVersion() view returns (uint32)"]);
const EXECUTE_USER_OP: Hex = "0x8dd7712f"; // executeUserOp(PackedUserOperation,bytes32)
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

const SIG_T = { type: "tuple", components: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "root", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "snapExpiry", type: "uint64" }, { name: "ownerSigs", type: "bytes" }, { name: "attestorSigs", type: "bytes" }, { name: "attestors", type: "address[]" }, { name: "hints", type: "address[]" }, { name: "proofs", type: "bytes" }] } as const;

const CHAIN = 11155111;

/** Renders with the twin, proves from the snapshot, signs with two owners. `override` signs something other than what it sends. */
export async function buildOp(account: Address, calls: Call[], bundler: string, snapshot: PublishedSnapshot, opts: { expiry?: bigint; gas?: Gas; override?: { tree: Hex; spec: Hex } } = {}): Promise<Built> {
  const gas = opts.gas ?? GAS;
  const fees = await gasPrice(bundler);
  const expiry = opts.expiry ?? (await pub.getBlock()).timestamp + 240n;
  const trust = new SnapshotTrust(pub as never, snapshot, { permit2: UNI.permit2, weth: WETH_SEPOLIA, publisher: packedUniswap });
  const policyVersion = Number(await pub.readContract({ address: account, abi: ACCOUNT, functionName: "policyVersion" }));
  const base = { chainId: BigInt(CHAIN), account, expiry, snapshotRoot: snapshot.root, policyVersion, path: PATH_ERC4337, feeAsset: "0x0000000000000000000000000000000000000000" as Address, maxFee: (gas.verificationGasLimit + gas.callGasLimit + gas.preVerificationGas) * fees.maxFeePerGas, body: encodeBody(calls, "0x") };
  const { out, hints } = await renderWithChain(base, trust as never, pub as never);
  const tree = opts.override?.tree ?? out.tree;
  const spec = opts.override?.spec ?? out.spec;
  const treeHash = keccak256(tree);
  const specHash = keccak256(spec);
  const proofs = encodeProofs(treeOf(snapshot), [...trust.used.values()]);
  const nonce = await pub.readContract({ address: ENTRY_POINT, abi: EP, functionName: "getNonce", args: [account, 0n] });
  const callData = concat([EXECUTE_USER_OP, encodeBody(calls, spec)]);
  const userOperation = { sender: account, nonce, callData, callGasLimit: gas.callGasLimit, verificationGasLimit: gas.verificationGasLimit, preVerificationGas: gas.preVerificationGas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, signature: "0x" as Hex };
  const hash = getUserOperationHash({ chainId: CHAIN, entryPointAddress: ENTRY_POINT, entryPointVersion: "0.7", userOperation });
  const td = typedData(BigInt(CHAIN), account, treeHash, specHash, expiry, snapshot.root, PATH_ERC4337, hash);
  const owners = ["OWNER1_KEY", "OWNER2_KEY"].map((k) => privateKeyToAccount(key(k))).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const ownerSigs = concat(await Promise.all(owners.map((o) => o.signTypedData(td as never))));
  const attestorSigs = concat(snapshot.signatures.map((x) => x.sig));
  const signature = encodeAbiParameters([SIG_T], [{ treeHash, specHash, expiry, root: snapshot.root, issuedAt: BigInt(snapshot.issuedAt), snapExpiry: BigInt(snapshot.expiry), ownerSigs, attestorSigs, attestors: snapshot.attestors, hints, proofs }]);
  const q = (n: bigint): Hex => `0x${n.toString(16)}`;
  const op = { sender: account, nonce: q(nonce), callData, callGasLimit: q(gas.callGasLimit), verificationGasLimit: q(gas.verificationGasLimit), preVerificationGas: q(gas.preVerificationGas), maxFeePerGas: q(fees.maxFeePerGas), maxPriorityFeePerGas: q(fees.maxPriorityFeePerGas), signature };
  const { hashTypedData } = await import("viem");
  return { op, hash, digest: hashTypedData(td as never), tree, spec, treeHash, specHash, risk: out.risk, hints, expiry, proofs };
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

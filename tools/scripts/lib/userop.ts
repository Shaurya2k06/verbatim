import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { ChainTrust, encodeBody, renderWithChain, typedData, PAYMASTER_ABI, type Call, type Fee } from "@verbatim/client";
import { key } from "./env";
import { ENTRY_POINT, pub, readS } from "./sepolia";

export const ACCOUNT_4337_ABI = parseAbi([
  "struct Fee { address asset; uint256 amount; }",
  "struct Call { address target; uint256 value; bytes data; }",
  "function executeVerified(Fee fee, Call[] calls, bytes spec, uint64 signedAtBlock)",
]);
const EP = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);

export interface Gas {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

export const GAS: Gas = { callGasLimit: 3_500_000n, verificationGasLimit: 110_000n, preVerificationGas: 300_000n, paymasterVerificationGasLimit: 400_000n, paymasterPostOpGasLimit: 100_000n };
const total = (g: Gas) => g.callGasLimit + g.verificationGasLimit + g.preVerificationGas + g.paymasterVerificationGasLimit + g.paymasterPostOpGasLimit;

export async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
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
  tree: Hex;
  spec: Hex;
  treeHash: Hex;
  specHash: Hex;
  risk: number;
  hints: Address[];
  signedAtBlock: bigint;
}

/** Renders with the twin and signs with two owners. `override` lets an attack sign something other than what it sends. */
export async function buildOp(calls: Call[], bundler: string, opts: { signedAtBlock?: bigint; gas?: Gas; override?: { tree: Hex; spec: Hex } } = {}): Promise<Built> {
  const s = readS();
  const gas = opts.gas ?? GAS;
  const trust = new ChainTrust(pub as never, s.paymaster);
  trust.legB = true;
  const fee: Fee = { asset: "0x0000000000000000000000000000000000000000", amount: total(gas) };
  const signedAtBlock = opts.signedAtBlock ?? (await pub.getBlockNumber());
  const read = (functionName: string) => pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName, args: [s.account] } as never) as Promise<any>;
  const base = { chainId: 11155111n, account: s.account as Address, signedAtBlock, ttl: BigInt(await read("ttlOf")), feeAsset: fee.asset, feeAmount: fee.amount, gasLimitTotal: total(gas), policyHash: await read("policyHashOf"), body: encodeBody(fee, calls, "0x") };
  const { out, hints } = await renderWithChain(base, trust, pub as never);
  const tree = opts.override?.tree ?? out.tree;
  const spec = opts.override?.spec ?? out.spec;
  const treeHash = keccak256(tree);
  const specHash = keccak256(spec);
  const fees = await gasPrice(bundler);
  const nonce = await pub.readContract({ address: ENTRY_POINT, abi: EP, functionName: "getNonce", args: [s.account, 0n] });
  const callData = encodeFunctionData({ abi: ACCOUNT_4337_ABI, functionName: "executeVerified", args: [fee, calls, spec, signedAtBlock] });
  const paymasterData = encodeAbiParameters([{ type: "address[]" }], [hints]);
  const userOperation = { sender: s.account as Address, nonce, callData, callGasLimit: gas.callGasLimit, verificationGasLimit: gas.verificationGasLimit, preVerificationGas: gas.preVerificationGas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, paymaster: s.paymaster as Address, paymasterVerificationGasLimit: gas.paymasterVerificationGasLimit, paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit, paymasterData, signature: "0x" as Hex };
  const hash = getUserOperationHash({ chainId: 11155111, entryPointAddress: ENTRY_POINT, entryPointVersion: "0.7", userOperation });
  const td = typedData(11155111n, s.account, hash, treeHash, specHash, signedAtBlock);
  const owners = ["OWNER1_KEY", "OWNER2_KEY"].map((k) => privateKeyToAccount(key(k))).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const sigs = await Promise.all(owners.map((o) => o.signTypedData(td as never)));
  const signature = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "bytes" }], [treeHash, specHash, signedAtBlock, `0x${sigs.map((x) => x.slice(2)).join("")}` as Hex]);
  const q = (n: bigint): Hex => `0x${n.toString(16)}`;
  const op = {
    sender: s.account, nonce: q(nonce), callData, callGasLimit: q(gas.callGasLimit), verificationGasLimit: q(gas.verificationGasLimit), preVerificationGas: q(gas.preVerificationGas),
    maxFeePerGas: q(fees.maxFeePerGas), maxPriorityFeePerGas: q(fees.maxPriorityFeePerGas), paymaster: s.paymaster, paymasterVerificationGasLimit: q(gas.paymasterVerificationGasLimit), paymasterPostOpGasLimit: q(gas.paymasterPostOpGasLimit), paymasterData, signature,
  };
  return { op, hash, tree, spec, treeHash, specHash, risk: out.risk, hints, signedAtBlock };
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

/** eth_call that returns revert data instead of hiding it. */
export async function rawRevert(from: Address, to: Address, data: Hex): Promise<string> {
  const { RPC } = await import("./sepolia");
  try {
    await rpc(RPC, "eth_call", [{ from, to, data }, "latest"]);
    return "no revert";
  } catch (e) {
    const d = (e as any).data;
    return typeof d === "string" ? d : typeof d?.data === "string" ? d.data : (e as Error).message;
  }
}

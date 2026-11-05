// EIP-8141 frame transactions, as implemented by the public devnet (ethrex `eip8141-tracer`, chain 1337).
// Envelope, sig hash and wire format were checked against forshtat/ethrex@9aa3645d (see docs/DECISIONS.md, Q1).
import { concat, fromRlp, keccak256, numberToHex, toRlp, type Address, type Hex } from "viem";

export const FRAME_TX_TYPE = 0x06;
export const ENTRY_POINT: Address = "0x00000000000000000000000000000000000000aa";

export const Mode = { DEFAULT: 0, VERIFY: 1, SENDER: 2 } as const;
export const Scope = { NONE: 0, PAYMENT: 1, EXECUTION: 2, EXECUTION_AND_PAYMENT: 3 } as const;
export const ATOMIC_BATCH_FLAG = 4;
export const SigScheme = { ARBITRARY: 0, SECP256K1: 1, P256: 2 } as const;

export interface Frame {
  mode: number;
  flags: number;
  /** null resolves to tx.sender */
  target: Address | null;
  limits: { execution: bigint; state: bigint };
  value: bigint;
  data: Hex;
}

export interface FrameSignature {
  scheme: number;
  signer: Hex;
  msg: Hex;
  signature: Hex;
}

export interface FrameTx {
  chainId: bigint;
  nonceKeys: bigint[];
  nonceSeq: bigint;
  sender: Address;
  frames: Frame[];
  signatures: FrameSignature[];
  fees: { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; maxFeePerBlobGas: bigint };
  blobVersionedHashes: Hex[];
  recentRootReferences: never[];
}

const int = (n: bigint | number): Hex => {
  const b = BigInt(n);
  if (b < 0n) throw new Error(`negative RLP integer: ${b}`);
  if (b === 0n) return "0x";
  const h = numberToHex(b);
  return (h.length % 2 ? `0x0${h.slice(2)}` : h) as Hex;
};

const payload = (tx: FrameTx) =>
  toRlp([
    int(tx.chainId),
    tx.nonceKeys.map(int),
    int(tx.nonceSeq),
    tx.sender,
    tx.frames.map((f) => [int(f.mode), int(f.flags), f.target ?? "0x", [int(f.limits.execution), int(f.limits.state)], int(f.value), f.data]),
    tx.signatures.map((s) => [int(s.scheme), s.signer, s.msg, s.signature]),
    [int(tx.fees.maxPriorityFeePerGas), int(tx.fees.maxFeePerGas), int(tx.fees.maxFeePerBlobGas)],
    tx.blobVersionedHashes,
    [],
  ]);

/** `0x06 || rlp(payload)`, what `eth_sendRawTransaction` and `ethrex_simulateFrameTransaction` take. */
export const encodeTx = (tx: FrameTx): Hex => concat([numberToHex(FRAME_TX_TYPE, { size: 1 }), payload(tx)]);

/** Frame data is covered; only the raw `signature` bytes of empty-`msg` entries are elided. */
export const sigHash = (tx: FrameTx): Hex =>
  keccak256(encodeTx({ ...tx, signatures: tx.signatures.map((s) => (s.msg === "0x" ? { ...s, signature: "0x" as Hex } : s)) }));

export const txHash = (tx: FrameTx): Hex => keccak256(encodeTx(tx));

export function decodeTx(raw: Hex): unknown[] {
  if (!raw.startsWith("0x06")) throw new Error("not a type-0x06 transaction");
  return fromRlp(`0x${raw.slice(4)}`, "hex") as unknown[];
}

export function frame(init: Partial<Frame> & { mode: number; execution?: bigint; state?: bigint }): Frame {
  return {
    mode: init.mode,
    flags: init.flags ?? 0,
    target: init.target ?? null,
    limits: init.limits ?? { execution: init.execution ?? 0n, state: init.state ?? 0n },
    value: init.value ?? 0n,
    data: init.data ?? "0x",
  };
}

export function newTx(init: { chainId: bigint | number; sender: Address; nonce: bigint; frames: Frame[]; signatures?: FrameSignature[]; maxFeePerGas: bigint; maxPriorityFeePerGas?: bigint }): FrameTx {
  return {
    chainId: BigInt(init.chainId),
    nonceKeys: [0n],
    nonceSeq: init.nonce,
    sender: init.sender,
    frames: init.frames,
    signatures: init.signatures ?? [],
    fees: { maxPriorityFeePerGas: init.maxPriorityFeePerGas ?? init.maxFeePerGas, maxFeePerGas: init.maxFeePerGas, maxFeePerBlobGas: 0n },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}

const hex = (n: bigint): Hex => `0x${n.toString(16)}`;

/** The JSON shape of `eth_sendFrameTransaction`. */
export const toWire = (tx: FrameTx) => ({
  chainId: hex(tx.chainId),
  nonceKeys: tx.nonceKeys.map(hex),
  nonceSeq: hex(tx.nonceSeq),
  sender: tx.sender,
  frames: tx.frames.map((f) => ({
    mode: f.mode,
    flags: f.flags,
    target: f.target,
    limits: { execution: hex(f.limits.execution), state: hex(f.limits.state) },
    value: hex(f.value),
    data: f.data,
  })),
  signatures: tx.signatures.map((s) => ({ scheme: s.scheme, signer: s.signer, msg: s.msg, signature: s.signature })),
  fees: { maxPriorityFeePerGas: hex(tx.fees.maxPriorityFeePerGas), maxFeePerGas: hex(tx.fees.maxFeePerGas), maxFeePerBlobGas: hex(tx.fees.maxFeePerBlobGas) },
  blobVersionedHashes: tx.blobVersionedHashes,
  recentRootReferences: [],
});

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

export interface Endpoints {
  /** The sidecar: the alt mempool, plus proxied reads. */
  mempool: string;
  /** ethrex directly: simulation and tracing. */
  node: string;
}

export const DEVNET: Endpoints = { mempool: "https://altmempoolgateway.forshtat.com/rpc", node: "https://altmempool.forshtat.com" };
export const EXPLORER = "https://explorer.altmempool.wtf/";
export const STAKING_REGISTRY: Address = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";

export async function rpc<T = any>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
  return body.result as T;
}

/** Into the standard alt mempool (ERC-8421 rules, via the sidecar). A rejection throws RpcError. */
export const submit = (tx: FrameTx, ep: Endpoints = DEVNET) => rpc<Hex>(ep.mempool, "eth_sendFrameTransaction", [toWire(tx)]);

/** ethrex's admission gates plus full multi-frame execution, without sending anything. */
export const simulate = (tx: FrameTx, ep: Endpoints = DEVNET, trace = false) =>
  rpc<any>(ep.node, "ethrex_simulateFrameTransaction", [encodeTx(tx), "latest", { trace }]);

export interface FrameReceipt {
  status: Hex;
  blockNumber: Hex;
  gasUsed?: Hex;
  payer?: Address;
  frameReceipts?: { status: Hex; gasUsed?: unknown; logs?: any[] }[];
  [k: string]: unknown;
}

export async function waitReceipt(hash: Hex, ep: Endpoints = DEVNET, timeoutMs = 120_000): Promise<FrameReceipt> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpc<FrameReceipt | null>(ep.node, "eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`transaction ${hash} not mined within ${timeoutMs} ms`);
}

/** Maps a node's rejection text to the rule family it comes from. */
export function explainRejection(message: string): { rule: string; message: string } {
  const rules: [RegExp, string][] = [
    [/uses banned opcode|banned opcode/i, "OPCODES (banned opcode)"],
    [/accessed .* slot|forbidden .* slot|StorageRead/i, "STORAGE"],
    [/MAX_VERIFY_GAS/, "BUDGET"],
    [/validation prefix not recognized/, "PREFIX-010"],
    [/validation frame (\d+): reverted|validation prefix frame reverted/, "PREFIX-060 (validation frame reverted)"],
    [/ran out of gas/, "out of gas in validation"],
    [/un-deployed contract/, "CALLING-010"],
  ];
  for (const [re, rule] of rules) if (re.test(message)) return { rule, message };
  return { rule: "UNKNOWN", message };
}

export const explorerLink = (hash: Hex) => `${EXPLORER}?tx=${hash}`;

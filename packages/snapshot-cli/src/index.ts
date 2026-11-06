// The snapshot of context.md §6: a sorted Merkle tree of typed leaves, signed by a k-of-n attestor set.
// contracts/src/lib/SnapshotVerifier.sol is the on-chain half. Same hashing, held together by contracts/vectors/snapshot.json.
import { concat, encodeAbiParameters, hashTypedData, keccak256, toHex, type Address, type Hex } from "viem";

export const LEAF = { DESC: 1, TOKEN: 2, HOOK: 3, NAME: 4, PROXY: 5, ROUTER: 6, SPENDER: 7 } as const;
export const SCHEMA = 1;
export const MAX_DEPTH = 20;

const w = (type: string, v: unknown): Hex => encodeAbiParameters([{ type }], [v as never]);

export interface Leaf {
  type: number;
  /** 32-byte words, as abi.encode lays them out. */
  key: Hex[];
  value: Hex[];
  /** Carried beside a DESC leaf: its hash is in the value, the bytes travel with the proof. */
  vdesc?: Hex;
}

export const descLeaf = (chainId: bigint, codehash: Hex, selector: Hex, descHash: Hex, publisher: Hex, status: number, vdesc: Hex): Leaf => ({
  type: LEAF.DESC,
  key: [w("uint256", chainId), codehash, w("bytes4", selector)],
  value: [descHash, publisher, w("uint256", BigInt(status))],
  vdesc,
});
export const tokenLeaf = (chainId: bigint, token: Address, packedSymbol: Hex, decimals: number, riskFlags: number): Leaf => ({
  type: LEAF.TOKEN,
  key: [w("uint256", chainId), w("address", token)],
  value: [packedSymbol, w("uint256", BigInt(decimals)), w("uint256", BigInt(riskFlags))],
});
export const hookLeaf = (chainId: bigint, codehash: Hex, attestFlags: number): Leaf => ({
  type: LEAF.HOOK,
  key: [w("uint256", chainId), codehash],
  value: [w("uint256", BigInt(attestFlags))],
});
export const nameLeaf = (chainId: bigint, a: Address, packedName: Hex, resolver: Address): Leaf => ({
  type: LEAF.NAME,
  key: [w("uint256", chainId), w("address", a)],
  value: [packedName, w("address", resolver)],
});
export const proxyLeaf = (chainId: bigint, codehash: Hex, upgrader: Address, logicCodehash: Hex, impl: Address, getter: Hex): Leaf => ({
  type: LEAF.PROXY,
  key: [w("uint256", chainId), codehash],
  value: [w("address", upgrader), logicCodehash, w("address", impl), w("bytes4", getter)],
});
export const routerLeaf = (chainId: bigint, codehash: Hex, kind: number): Leaf => ({
  type: LEAF.ROUTER,
  key: [w("uint256", chainId), codehash],
  value: [w("uint256", BigInt(kind))],
});
export const spenderLeaf = (chainId: bigint, a: Address): Leaf => ({
  type: LEAF.SPENDER,
  key: [w("uint256", chainId), w("address", a)],
  value: [w("uint256", 1n)],
});

const typeByte = (t: number): Hex => toHex(t, { size: 1 });

/** keccak(type ‖ abi.encode(key)): the sort order. */
export const leafKey = (l: Pick<Leaf, "type" | "key">): Hex => keccak256(concat([typeByte(l.type), ...l.key]));
/** keccak(0x00 ‖ type ‖ abi.encode(key, value)). */
export const leafHash = (l: Leaf): Hex => keccak256(concat(["0x00", typeByte(l.type), ...l.key, ...l.value]));
/** keccak(0x01 ‖ left ‖ right). */
export const nodeHash = (a: Hex, b: Hex): Hex => keccak256(concat(["0x01", a, b]));

// Sentinels bound every gap, so a non-membership proof always has two neighbours. Their leafKey is fixed and not a hash.
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MAX32 = `0x${"ff".repeat(32)}` as Hex;
export const SENTINEL_LOW: Leaf = { type: 0, key: [ZERO32], value: [] };
export const SENTINEL_HIGH: Leaf = { type: 255, key: [MAX32], value: [] };
export const sortKey = (l: Leaf): Hex => (l.type === 0 ? ZERO32 : l.type === 255 ? MAX32 : leafKey(l));

export interface Tree {
  root: Hex;
  depth: number;
  leaves: Leaf[];
  levels: Hex[][];
}

export function buildTree(input: Leaf[]): Tree {
  const seen = new Set<string>();
  for (const l of input) {
    const k = leafKey(l);
    if (seen.has(k)) throw new Error(`duplicate leaf ${k}`);
    seen.add(k);
  }
  const leaves = [SENTINEL_LOW, ...input, SENTINEL_HIGH].sort((a, b) => (BigInt(sortKey(a)) < BigInt(sortKey(b)) ? -1 : 1));
  let depth = 0;
  while (1 << depth < leaves.length) depth++;
  if (depth > MAX_DEPTH) throw new Error("snapshot too large");
  // Unused positions hold zero, which no leaf or node hash can equal.
  const first = leaves.map(leafHash);
  while (first.length < 1 << depth) first.push(ZERO32);
  const levels: Hex[][] = [first];
  for (let d = 0; d < depth; d++) {
    const prev = levels[d];
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(nodeHash(prev[i], prev[i + 1]));
    levels.push(next);
  }
  return { root: levels[depth][0], depth, leaves, levels };
}

export const indexOf = (t: Tree, l: Pick<Leaf, "type" | "key">): number => {
  const k = leafKey(l);
  return t.leaves.findIndex((x) => x.type === l.type && leafKey(x) === k);
};

export function pathOf(t: Tree, index: number): Hex[] {
  const out: Hex[] = [];
  let i = index;
  for (let d = 0; d < t.depth; d++) {
    out.push(t.levels[d][i ^ 1]);
    i >>= 1;
  }
  return out;
}

export function verifyPath(root: Hex, l: Leaf, index: number, path: Hex[]): boolean {
  let h = leafHash(l);
  let i = index;
  for (const sib of path) {
    h = i & 1 ? nodeHash(sib, h) : nodeHash(h, sib);
    i >>= 1;
  }
  return i === 0 && h === root;
}

export interface Adjacency {
  low: Leaf;
  high: Leaf;
  lowIndex: number;
  lowPath: Hex[];
  highPath: Hex[];
}

/** Two consecutive leaves whose keys bracket `k`. Throws if `k` is in the tree. */
export function nonMembership(t: Tree, l: Pick<Leaf, "type" | "key">): Adjacency {
  const k = BigInt(leafKey(l));
  for (let i = 0; i + 1 < t.leaves.length; i++) {
    const a = BigInt(sortKey(t.leaves[i]));
    const b = BigInt(sortKey(t.leaves[i + 1]));
    if (a === k || b === k) throw new Error("leaf is present");
    if (a < k && k < b) return { low: t.leaves[i], high: t.leaves[i + 1], lowIndex: i, lowPath: pathOf(t, i), highPath: pathOf(t, i + 1) };
  }
  throw new Error("no bracket");
}

export function verifyNonMembership(root: Hex, l: Pick<Leaf, "type" | "key">, p: Adjacency): boolean {
  const k = BigInt(leafKey(l));
  return BigInt(sortKey(p.low)) < k && k < BigInt(sortKey(p.high)) && verifyPath(root, p.low, p.lowIndex, p.lowPath) && verifyPath(root, p.high, p.lowIndex + 1, p.highPath);
}

/**
 * What goes in frame 1. One item per leaf the render used:
 *   type(1) index(2) nKey(1) nValue(1) vdescLen(2) key words, value words, path(depth words), vdesc
 * preceded by depth(1). Compact, because every word here is read in a metered VERIFY frame.
 */
export function encodeProofs(t: Tree, used: Leaf[]): Hex {
  const parts: Hex[] = [toHex(t.depth, { size: 1 })];
  for (const l of used) {
    const i = indexOf(t, l);
    if (i < 0) throw new Error("leaf is not in this snapshot");
    const vd = (l.vdesc ?? "0x") as Hex;
    parts.push(toHex(l.type, { size: 1 }), toHex(i, { size: 2 }), toHex(l.key.length, { size: 1 }), toHex(l.value.length, { size: 1 }), toHex((vd.length - 2) / 2, { size: 2 }), ...l.key, ...l.value, ...pathOf(t, i), vd);
  }
  return concat(parts);
}

/** `D_snapshot`, §6. */
export const snapshotTypedData = (chainId: bigint, root: Hex, issuedAt: bigint, expiry: bigint, schema: number = SCHEMA) => ({
  domain: { name: "VerbatimSnapshot", version: "1", chainId },
  types: { Snapshot: [{ name: "root", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "expiry", type: "uint64" }, { name: "schema", type: "uint16" }] },
  primaryType: "Snapshot" as const,
  message: { root, issuedAt, expiry, schema },
});

export const snapshotDigest = (chainId: bigint, root: Hex, issuedAt: bigint, expiry: bigint): Hex => hashTypedData(snapshotTypedData(chainId, root, issuedAt, expiry));

/** The fields of a TrustUpdate a snapshot is made from. */
export interface SnapshotInput {
  descriptors: { codehash: Hex; selector: Hex; vdesc: Hex; publisher: Hex }[];
  tokens: { token: Address; symbol: Hex; symLen: number; decimals: number; flags: number }[];
  proxies: { codehash: Hex; template: { upgrader: Address; logicCodehash: Hex; impl: Address; getter: Hex } }[];
  routers: { codehash: Hex; legacy: boolean }[];
  hooks: Hex[];
  spenders: Address[];
  names: { addr: Address; name: Hex; resolver: Address }[];
}

/** bytes11 symbol and its length as the renderer's packed string: text left-aligned, length in the last byte. */
export const packedSymbol = (symbol: Hex, symLen: number): Hex => `0x${symbol.slice(2).padEnd(62, "0")}${symLen.toString(16).padStart(2, "0")}` as Hex;

export function leavesOf(u: SnapshotInput, chainId: bigint, status: number): Leaf[] {
  const out: Leaf[] = [];
  for (const d of u.descriptors) out.push(descLeaf(chainId, d.codehash, d.selector, keccak256(d.vdesc), d.publisher, status, d.vdesc));
  for (const t of u.tokens) out.push(tokenLeaf(chainId, t.token, packedSymbol(t.symbol, t.symLen), t.decimals, t.flags));
  for (const p of u.proxies) out.push(proxyLeaf(chainId, p.codehash, p.template.upgrader, p.template.logicCodehash, p.template.impl, p.template.getter));
  for (const r of u.routers) out.push(routerLeaf(chainId, r.codehash, r.legacy ? 3 : 1));
  for (const h of u.hooks) out.push(hookLeaf(chainId, h, 1));
  for (const a of u.spenders) out.push(spenderLeaf(chainId, a));
  for (const n of u.names) out.push(nameLeaf(chainId, n.addr, n.name, n.resolver));
  return out;
}

/** A snapshot as it is published: all a wallet needs to build proofs, with the attestors' entries. */
export interface PublishedSnapshot {
  chainId: string;
  schema: number;
  root: Hex;
  depth: number;
  issuedAt: string;
  expiry: string;
  leaves: Leaf[];
  attestors: Address[];
  /** `signer`, r||s||v, ascending by signer. */
  signatures: { signer: Address; sig: Hex }[];
}

export const treeOf = (p: PublishedSnapshot): Tree => buildTree(p.leaves.filter((l) => l.type !== 0 && l.type !== 255));

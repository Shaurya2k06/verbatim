import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { buildTree, hookLeaf, indexOf, leafHash, leafKey, nodeHash, nonMembership, pathOf, routerLeaf, spenderLeaf, tokenLeaf, verifyNonMembership, verifyPath } from "./index";

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;
const SYM = `0x${"11".repeat(32)}` as const;
const hook = (n: number) => hookLeaf(1337n, keccak256(`0x0${n}`), 1);
const some = [tokenLeaf(1337n, A, SYM, 6, 0), spenderLeaf(1337n, A), routerLeaf(1337n, keccak256("0x01"), 1), hook(1), hook(2)];

describe("snapshot tree", () => {
  it("every leaf proves against the root", () => {
    const t = buildTree(some);
    for (const l of some) expect(verifyPath(t.root, l, indexOf(t, l), pathOf(t, indexOf(t, l)))).toBe(true);
  });
  it("a wrong index does not prove", () => {
    const t = buildTree(some);
    const i = indexOf(t, some[0]);
    expect(verifyPath(t.root, some[0], i ^ 1, pathOf(t, i))).toBe(false);
  });
  it("a changed value does not prove", () => {
    const t = buildTree(some);
    const i = indexOf(t, some[0]);
    expect(verifyPath(t.root, tokenLeaf(1337n, A, SYM, 18, 0), i, pathOf(t, i))).toBe(false);
  });
  it("order does not change the root", () => expect(buildTree([...some].reverse()).root).toBe(buildTree(some).root));
  it("refuses duplicates", () => expect(() => buildTree([some[0], some[0]])).toThrow(/duplicate/));
  it("a chain is part of the key", () => expect(leafKey(spenderLeaf(1n, A))).not.toBe(leafKey(spenderLeaf(2n, A))));
  it("leaf and node hashes are domain separated", () => {
    // A two-word node cannot be replayed as a leaf: the first byte differs before any content.
    const n = nodeHash(leafHash(some[0]), leafHash(some[1]));
    expect(n).not.toBe(leafHash({ type: 1, key: [leafHash(some[0])], value: [leafHash(some[1])] }));
  });
  it("two leaf types with the same key differ", () => expect(leafKey(spenderLeaf(1337n, A))).not.toBe(leafKey({ ...spenderLeaf(1337n, A), type: 2 })));
  it("proves absence with two neighbours", () => {
    const t = buildTree(some);
    const missing = spenderLeaf(1337n, B);
    expect(verifyNonMembership(t.root, missing, nonMembership(t, missing))).toBe(true);
  });
  it("cannot prove a present leaf absent", () => {
    const t = buildTree(some);
    expect(() => nonMembership(t, some[1])).toThrow(/present/);
  });
  it("neighbours must be consecutive", () => {
    const t = buildTree(some);
    const missing = spenderLeaf(1337n, B);
    const p = nonMembership(t, missing);
    expect(verifyNonMembership(t.root, missing, { ...p, lowIndex: p.lowIndex + 1 })).toBe(false);
  });
  it("works with no leaves but the sentinels", () => {
    const t = buildTree([]);
    expect(t.depth).toBe(1);
    expect(verifyNonMembership(t.root, some[0], nonMembership(t, some[0]))).toBe(true);
  });
});

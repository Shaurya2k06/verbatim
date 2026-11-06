// The published policy, on the sentence itself: the oracle reads what a human would, by the same decoder. Anything it cannot
// read is a refusal. See docs/BOUNTY.md.
import { decodeTree, specOf, type TreeNode } from "@verbatim/displayvm-ts";
import type { Address, Hex } from "viem";

export interface Policy {
  account: Address;
  chainId: bigint;
  /** Output token, its smallest-unit price per 1e18 wei of ETH, from a pinned oracle. */
  output: Address;
  pricePerEth: bigint;
  /** Pool hooks are refused: only attested pools with no take flags. */
  maxIn: bigint;
  minOutBps: bigint;
  maxValidity: bigint;
}

const REFUSED_RISKS = new Set([0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0007, 0x0008, 0x0009, 0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0106, 0x0107, 0x0108, 0x0202]);

export type Verdict = { ok: true } | { ok: false; why: string };

const no = (why: string): Verdict => ({ ok: false, why });

export function check(tree: Hex, p: Policy, now: bigint): Verdict {
  let t;
  try {
    t = decodeTree(tree);
    specOf(t);
  } catch (e) {
    return no(`unreadable: ${(e as Error).message}`);
  }
  if (t.chainId !== p.chainId) return no("wrong chain");
  if (t.account.toLowerCase() !== p.account.toLowerCase()) return no("wrong account");
  if (t.expiry <= now || t.expiry > now + p.maxValidity) return no("expiry out of range");
  const nodes: TreeNode[] = t.nodes;
  for (const n of nodes) {
    if (n.type === "RISK" && REFUSED_RISKS.has(n.code)) return no(`risk 0x${n.code.toString(16)}`);
    if (n.type === "BLIND") return no("blind data");
    if (n.type === "CALL_BEGIN" && n.attestStatus === 0) return no("unattested call");
  }
  const calls = nodes.filter((n) => n.type === "CALL_BEGIN");
  if (calls.length !== 1) return no("exactly one call");
  const value = nodes.find((n) => n.type === "FIELD_ETH_VALUE");
  if (!value || value.type !== "FIELD_ETH_VALUE" || value.raw === 0n || value.raw > p.maxIn) return no("ETH in out of range");
  const min = nodes.find((n) => n.type === "FIELD_AMOUNT" && n.label === "Minimum received");
  if (!min || min.type !== "FIELD_AMOUNT") return no("no minimum output");
  if (min.token.toLowerCase() !== p.output.toLowerCase()) return no("wrong output token");
  const fair = (value.raw * p.pricePerEth) / 10n ** 18n;
  if (min.raw * 10_000n < fair * p.minOutBps) return no("minimum below the floor");
  return { ok: true };
}

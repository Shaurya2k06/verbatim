import { decodeErrorResult, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import type { FrameReceipt } from "@verbatim/frames-sdk";
import { artifact } from "./chain";

const ERRORS = [...artifact("VerbatimAccount.sol", "VerbatimAccount").abi.filter((x: any) => x.type === "error"), ...artifact("RendererPaymaster.sol", "RendererPaymaster").abi.filter((x: any) => x.type === "error"), ...artifact("EnsTrustChecker.sol", "EnsTrustChecker").abi.filter((x: any) => x.type === "error"), ...parseAbi(["error AssertionFailed(uint256 index, uint256 expected, uint256 actual)", "error ReadFailed(address target)", "error BadSpec()"])];

/** Decodes revert data anywhere in a node's message. */
export function decodeRevert(text: string): string {
  const m = text.match(/0x[0-9a-fA-F]{8,}/);
  if (!m) return text;
  try {
    const d = decodeErrorResult({ abi: ERRORS as never, data: m[0] as Hex });
    const args = (d.args ?? []).map((a: unknown) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a)));
    const inner = d.errorName === "CallFailed" ? ` [${decodeRevert(String(d.args?.[1]))}]` : "";
    return `${text} => ${d.errorName}(${args.join(", ")})${inner}`;
  } catch {
    return text;
  }
}

export const frameGas = (r: FrameReceipt) => (r.frameReceipts ?? []).map((f: any) => ({ execution: Number(f.gasUsed?.execution ?? f.gasUsed), state: Number(f.stateGasUsed ?? f.gasUsed?.state ?? 0) }));

export function batchResult(r: FrameReceipt, account: Address): { ok: boolean | null; err: string } {
  const sig = keccak256(toHex("VerbatimResult(bool,bytes)"));
  for (const f of r.frameReceipts ?? []) {
    for (const l of f.logs ?? []) {
      if (l.topics?.[0] === sig && l.address?.toLowerCase() === account.toLowerCase()) {
        const ok = BigInt(l.topics[1]) === 1n;
        const hex = l.data as Hex;
        const len = hex.length > 130 ? parseInt(hex.slice(66, 130), 16) : 0;
        return { ok, err: len ? decodeRevert(`0x${hex.slice(130, 130 + len * 2)}`) : "" };
      }
    }
  }
  return { ok: null, err: "" };
}


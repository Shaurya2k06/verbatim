import type { Hex } from "viem";

const LOG1 = 0xa1;
const APPROVE = 0xaa;

/** Offsets of an opcode in bytecode, skipping PUSH data. */
export function findOpcode(code: Uint8Array, op: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === op) hits.push(i);
    if (c >= 0x60 && c <= 0x7f) i += c - 0x5f;
  }
  return hits;
}

export const toBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
export const toHex = (b: Uint8Array): Hex => `0x${Buffer.from(b).toString("hex")}`;

/**
 * Flips the single LOG1 in a contract using DevnetFrames into APPROVE. Fails closed unless the runtime holds exactly
 * one LOG1, and works on the runtime's position inside the creation code, so constructor code is never touched.
 * Immutable slots are zero in the artifact, so a PUSH32 placeholder cannot desynchronise the walk.
 */
export function patchApprove(creation: Hex, runtime: Hex): { creation: Hex; runtime: Hex } {
  const c = toBytes(creation);
  const r = toBytes(runtime);
  const hits = findOpcode(r, LOG1);
  if (hits.length !== 1) throw new Error(`expected exactly one LOG1 in runtime, found ${hits.length}`);
  const start = Buffer.from(c).indexOf(Buffer.from(r));
  if (start < 0 || Buffer.from(c).lastIndexOf(Buffer.from(r)) !== start) throw new Error("runtime not found once in creation code");
  c[start + hits[0]] = APPROVE;
  r[hits[0]] = APPROVE;
  return { creation: toHex(c), runtime: toHex(r) };
}

// The device's whole trust base: decode strictly, show every node, sign only what was shown.
// `treeHash` is computed here from the displayed bytes and never accepted from the host.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { hashTypedData, keccak256, type Hex } from "viem";
import { decodeTree, formatForDevice, type DecodedTree, type DeviceLine } from "@verbatim/displayvm-ts";

export interface Request {
  tree: Hex;
  specHash: Hex;
  /** Not checkable here: the layout lock and the on-chain re-render are what bind it. */
  txCommit: Hex;
}

export interface Reviewed extends Request {
  decoded: DecodedTree;
  lines: DeviceLine[];
  treeHash: Hex;
  digest: Hex;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const HEX32 = /^0x[0-9a-f]{64}$/;

export function encodeRequest(r: Request): string {
  return `VBT1:${b64(gzipSync(strToU8(JSON.stringify({ t: r.tree, s: r.specHash, c: r.txCommit }))))}`;
}

export function decodeRequest(text: string): Request {
  const m = text.trim().match(/^VBT1:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("not a Verbatim signing request");
  const o = JSON.parse(strFromU8(gunzipSync(unb64(m[1]))));
  if (typeof o.t !== "string" || !HEX32.test(o.s) || !HEX32.test(o.c)) throw new Error("malformed signing request");
  return { tree: o.t, specHash: o.s, txCommit: o.c };
}

/** Splits for an animated QR, when one code would be too dense to scan. */
export function toFrames(payload: string, size = 700): string[] {
  if (payload.length <= size) return [payload];
  const parts = payload.match(new RegExp(`.{1,${size}}`, "g"))!;
  return parts.map((p, i) => `VBF1:${i + 1}/${parts.length}:${p}`);
}

export class FrameCollector {
  parts = new Map<number, string>();
  total = 0;
  /** Returns the whole payload once every frame has been seen. */
  add(text: string): string | null {
    const m = text.match(/^VBF1:(\d+)\/(\d+):(.*)$/s);
    if (!m) return text;
    this.total = Number(m[2]);
    this.parts.set(Number(m[1]), m[3]);
    if (this.parts.size < this.total) return null;
    return Array.from({ length: this.total }, (_, i) => this.parts.get(i + 1)).join("");
  }
}

/** The longest a device will sign for, in seconds. A signature that outlives this is durable authority. */
export const DEVICE_MAX_TTL = 600;

/** `now` is the device's own clock: the host cannot move it. */
export function review(r: Request, now: number = Math.floor(Date.now() / 1000)): Reviewed {
  const decoded = decodeTree(r.tree);
  const until = Number(decoded.validUntil);
  if (until > now + DEVICE_MAX_TTL) throw new Error(`this signature would stay valid for ${until - now} seconds, and the limit is ${DEVICE_MAX_TTL}`);
  if (until <= now) throw new Error("this sentence has already expired");
  const treeHash = keccak256(r.tree);
  const digest = hashTypedData(typedData(decoded, r, treeHash));
  return { ...r, decoded, lines: formatForDevice(decoded), treeHash, digest };
}

export function typedData(d: DecodedTree, r: Request, treeHash: Hex) {
  return {
    domain: { name: "Verbatim", version: "1", chainId: d.chainId, verifyingContract: d.account },
    types: { VerbatimTx: [{ name: "txCommit", type: "bytes32" }, { name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "validUntil", type: "uint64" }] },
    primaryType: "VerbatimTx" as const,
    message: { txCommit: r.txCommit, treeHash, specHash: r.specHash, validUntil: d.validUntil },
  };
}

export const encodeResponse = (signer: string, sig: string) => `VSG1:${signer}:${sig}`;

export function decodeResponse(text: string): { signer: Hex; sig: Hex } {
  const m = text.trim().match(/^VSG1:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{130})$/);
  if (!m) throw new Error("not a Verbatim signature");
  return { signer: m[1] as Hex, sig: m[2] as Hex };
}

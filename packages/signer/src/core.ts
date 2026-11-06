// The device's whole trust base: decode strictly, show every node, sign only what was shown.
// `treeHash` is computed here from the displayed bytes and never accepted from the host.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { hashTypedData, keccak256, toBytes, type Hex } from "viem";
import { decodeTree, formatForDevice, specOf, type DecodedTree, type DeviceLine } from "@verbatim/displayvm-ts";

export interface Request {
  tree: Hex;
  /** Not checkable here: the layout lock and the on-chain re-render are what bind it. */
  txCommit: Hex;
}

export interface Reviewed extends Request {
  decoded: DecodedTree;
  lines: DeviceLine[];
  treeHash: Hex;
  /** Derived from the tree's own guarantees. The host never supplies it. */
  specHash: Hex;
  digest: Hex;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const HEX32 = /^0x[0-9a-f]{64}$/;

export function encodeRequest(r: Request): string {
  return `VBT1:${b64(gzipSync(strToU8(JSON.stringify({ t: r.tree, c: r.txCommit }))))}`;
}

export function decodeRequest(text: string): Request {
  const m = text.trim().match(/^VBT1:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("not a Verbatim signing request");
  const o = JSON.parse(strFromU8(gunzipSync(unb64(m[1]))));
  if (typeof o.t !== "string" || !HEX32.test(o.c)) throw new Error("malformed signing request");
  return { tree: o.t, txCommit: o.c };
}

/**
 * Splits a request into a rotating QR. Small frames scan quickly from a laptop screen, and the host shows them in a loop, so a
 * missed frame simply comes round again. Each frame names the whole payload by its hash: frames from two requests never mix, and
 * the reassembled text is checked against that hash before it is used.
 */
export const FRAME_SIZE = 260;
export function toFrames(payload: string, size = FRAME_SIZE): string[] {
  if (payload.length <= size) return [payload];
  const id = payloadId(payload);
  const parts = payload.match(new RegExp(`.{1,${size}}`, "gs"))!;
  return parts.map((p, i) => `VBF2:${id}:${i + 1}/${parts.length}:${p}`);
}

const payloadId = (payload: string) => keccak256(toBytes(payload)).slice(2, 10);

export class FrameCollector {
  parts = new Map<number, string>();
  total = 0;
  id = "";
  /** Frames seen so far of the current payload, for a progress bar. */
  get seen() {
    return this.parts.size;
  }
  /** Returns the whole payload once every frame has been seen, and null until then. A plain, unframed code is returned as is. */
  add(text: string): string | null {
    const m = text.match(/^VBF2:([0-9a-f]{8}):(\d+)\/(\d+):(.*)$/s) ?? text.match(/^VBF1:()(\d+)\/(\d+):(.*)$/s);
    if (!m) return text;
    const [, id, i, n, part] = m;
    const total = Number(n);
    const at = Number(i);
    if (!total || at < 1 || at > total) return null;
    // A different request on the screen: start over rather than mix the two.
    if (id !== this.id || total !== this.total) {
      this.parts.clear();
      this.id = id;
      this.total = total;
    }
    this.parts.set(at, part);
    if (this.parts.size < this.total) return null;
    const whole = Array.from({ length: this.total }, (_, k) => this.parts.get(k + 1)).join("");
    if (id && payloadId(whole) !== id) {
      this.parts.clear();
      return null;
    }
    return whole;
  }
}

/**
 * A short code from the request's EIP-712 digest. The laptop shows it next to its QR and the device shows it after reviewing,
 * so a person can see both screens hold the same request. It proves nothing about the sentence's truth: the chain checks that.
 */
export const matchCode = (digest: Hex) => `${digest.slice(2, 6)}-${digest.slice(6, 10)}`.toUpperCase();

/** The longest a device will sign for, in seconds. A signature that outlives this is durable authority. */
export const DEVICE_MAX_TTL = 600;

/** `now` is the device's own clock: the host cannot move it. */
export function review(r: Request, now: number = Math.floor(Date.now() / 1000)): Reviewed {
  const decoded = decodeTree(r.tree);
  const until = Number(decoded.expiry);
  if (until > now + DEVICE_MAX_TTL) throw new Error(`this signature would stay valid for ${until - now} seconds, and the limit is ${DEVICE_MAX_TTL}`);
  if (until <= now) throw new Error("this sentence has already expired");
  const treeHash = keccak256(r.tree);
  const specHash = keccak256(specOf(decoded));
  const digest = hashTypedData(typedData(decoded, r, treeHash, specHash));
  return { ...r, decoded, lines: formatForDevice(decoded), treeHash, specHash, digest };
}

export function typedData(d: DecodedTree, r: Request, treeHash: Hex, specHash: Hex) {
  return {
    domain: { name: "Verbatim", version: "11", chainId: d.chainId, verifyingContract: d.account },
    types: { Tx: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "snapshotRoot", type: "bytes32" }, { name: "path", type: "uint8" }, { name: "txCommit", type: "bytes32" }] },
    primaryType: "Tx" as const,
    message: { treeHash, specHash, expiry: d.expiry, snapshotRoot: d.snapshotRoot, path: d.path, txCommit: r.txCommit },
  };
}

export const encodeResponse = (signer: string, sig: string) => `VSG1:${signer}:${sig}`;

export function decodeResponse(text: string): { signer: Hex; sig: Hex } {
  const m = text.trim().match(/^VSG1:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{130})$/);
  if (!m) throw new Error("not a Verbatim signature");
  return { signer: m[1] as Hex, sig: m[2] as Hex };
}

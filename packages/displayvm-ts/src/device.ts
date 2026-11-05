// What a signing device needs: strict VTREE decoding and display formatting. Refuses anything it does not know.
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { NODE, RISK, SPEC, itemSize } from "@verbatim/urrender";

export const RISK_NAMES: Record<number, string> = Object.fromEntries(Object.entries(RISK).map(([k, v]) => [v, k]));

export const RISK_TEXT: Record<number, string> = {
  [RISK.UNLIMITED_APPROVAL]: "UNLIMITED APPROVAL",
  [RISK.OPERATOR_APPROVAL]: "CAN MOVE ALL YOUR NFTS",
  [RISK.UPGRADEABLE_TARGET]: "CONTRACT IS UPGRADEABLE",
  [RISK.UNVERIFIED_CONTRACT]: "UNVERIFIED CONTRACT",
  [RISK.TRUST_CHANGE]: "CHANGES WHO CONTROLS THIS ACCOUNT",
  [RISK.NO_POST_CHECK]: "NOT CHECKED AFTER SIGNING",
  [RISK.RECIPIENT_HAS_CODE]: "RECIPIENT IS A CONTRACT",
  [RISK.RECIPIENT_NOT_SELF]: "OUTPUT GOES TO ANOTHER ADDRESS",
  [RISK.SPENDER_UNATTESTED]: "SPENDER IS NOT ATTESTED",
  [RISK.NO_MIN_OUT]: "NO MINIMUM OUTPUT",
  [RISK.HOOK_CAN_TAKE_INPUT]: "HOOK CAN TAKE YOUR INPUT",
  [RISK.HOOK_CAN_TAKE_OUTPUT]: "HOOK CAN TAKE YOUR OUTPUT",
  [RISK.HOOK_DYNAMIC_FEE]: "POOL FEE CAN CHANGE",
  [RISK.HOOK_UNVERIFIED]: "UNVERIFIED HOOK",
  [RISK.SWEEP_TO_OTHER]: "FUNDS SWEPT TO ANOTHER ADDRESS",
  [RISK.PERMIT2_ALLOWANCE_CHANGE]: "CHANGES PERMIT2 ALLOWANCE",
  [RISK.UR_ALLOW_REVERT]: "COMMAND MAY PARTIALLY FAIL",
  [RISK.TOKEN_UNSAFE]: "REBASING OR FEE-ON-TRANSFER TOKEN",
};

export type TreeNode =
  | { type: "CALL_BEGIN"; target: Address; codehash: Hex; selector: Hex; descHash: Hex; intent: string; publisher: string; attestStatus: number }
  | { type: "CALL_END" }
  | { type: "FIELD_ADDRESS"; label: string; addr: Address; nameSource: number; name: string; hasCode: boolean; isSelf: boolean }
  | { type: "FIELD_AMOUNT"; label: string; token: Address; symbol: string; decimals: number; raw: bigint }
  | { type: "FIELD_UINT"; label: string; value: bigint; unit: number }
  | { type: "FIELD_BOOL"; label: string; value: boolean }
  | { type: "FIELD_ENUM"; label: string; code: number; text: string }
  | { type: "FIELD_BYTES"; label: string; keccak: Hex; len: number }
  | { type: "FIELD_ETH_VALUE"; raw: bigint }
  | { type: "GROUP_BEGIN"; label: string }
  | { type: "GROUP_END" }
  | { type: "RISK"; code: number; args: Hex }
  | { type: "BLIND"; label: string; keccak: Hex; len: number; boundBy: number }
  | { type: "FEE"; asset: Address; amount: bigint }
  | { type: "GUARANTEE"; op: number; bytes: Hex };

export interface DecodedTree {
  chainId: bigint;
  account: Address;
  expiry: bigint;
  snapshotRoot: Hex;
  policyVersion: number;
  /** 1 stateless, 2 paymaster, 3 ERC-4337 */
  path: number;
  nodes: TreeNode[];
}

class Reader {
  p = 0;
  constructor(public d: Uint8Array, public end: number) {}
  need(n: number) {
    if (this.p + n > this.end) throw new Error("VTREE: truncated");
  }
  u8() {
    this.need(1);
    return this.d[this.p++];
  }
  be(n: number): bigint {
    this.need(n);
    let v = 0n;
    for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(this.d[this.p + i]);
    this.p += n;
    return v;
  }
  hex(n: number): Hex {
    this.need(n);
    const h = bytesToHex(this.d.slice(this.p, this.p + n));
    this.p += n;
    return h;
  }
  str(): string {
    const n = this.u8();
    if (n > 48) throw new Error("VTREE: string too long");
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = this.d[this.p + i];
      if (c < 0x20 || c > 0x7e || c === 0x5c) throw new Error("VTREE: bad character in string");
      s += String.fromCharCode(c);
    }
    this.p += n;
    return s;
  }
  done() {
    if (this.p !== this.end) throw new Error("VTREE: trailing bytes in node");
  }
}

/** Strict: unknown node types, trailing bytes and malformed strings all refuse. */
export function decodeTree(tree: Hex): DecodedTree {
  const d = hexToBytes(tree);
  const h = new Reader(d, d.length);
  if (h.be(4) !== 0x56540002n) throw new Error("VTREE: bad magic");
  const out: DecodedTree = { chainId: h.be(8), account: h.hex(20) as Address, expiry: h.be(8), snapshotRoot: h.hex(32), policyVersion: Number(h.be(4)), path: h.u8(), nodes: [] };
  if (out.path < 1 || out.path > 3) throw new Error("VTREE: unknown path");
  while (h.p < d.length) {
    const type = h.u8();
    const len = Number(h.be(2));
    h.need(len);
    const r = new Reader(d, h.p + len);
    r.p = h.p;
    out.nodes.push(decodeNode(type, r));
    r.done();
    h.p += len;
  }
  return out;
}

function decodeNode(type: number, r: Reader): TreeNode {
  switch (type) {
    case NODE.CALL_BEGIN:
      return { type: "CALL_BEGIN", target: r.hex(20) as Address, codehash: r.hex(32), selector: r.hex(4), descHash: r.hex(32), intent: r.str(), publisher: r.str(), attestStatus: r.u8() };
    case NODE.CALL_END:
      return { type: "CALL_END" };
    case NODE.FIELD_ADDRESS: {
      const label = r.str();
      const addr = r.hex(20) as Address;
      const nameSource = r.u8();
      const name = r.str();
      const flags = r.u8();
      if (flags > 3 || nameSource > 2) throw new Error("VTREE: bad address flags");
      return { type: "FIELD_ADDRESS", label, addr, nameSource, name, hasCode: !!(flags & 1), isSelf: !!(flags & 2) };
    }
    case NODE.FIELD_AMOUNT:
      return { type: "FIELD_AMOUNT", label: r.str(), token: r.hex(20) as Address, symbol: r.str(), decimals: r.u8(), raw: r.be(32) };
    case NODE.FIELD_UINT:
      return { type: "FIELD_UINT", label: r.str(), value: r.be(32), unit: r.u8() };
    case NODE.FIELD_BOOL: {
      const label = r.str();
      const v = r.u8();
      if (v > 1) throw new Error("VTREE: bad bool");
      return { type: "FIELD_BOOL", label, value: v === 1 };
    }
    case NODE.FIELD_ENUM:
      return { type: "FIELD_ENUM", label: r.str(), code: Number(r.be(2)), text: r.str() };
    case NODE.FIELD_BYTES:
      return { type: "FIELD_BYTES", label: r.str(), keccak: r.hex(32), len: Number(r.be(4)) };
    case NODE.FIELD_ETH_VALUE:
      return { type: "FIELD_ETH_VALUE", raw: r.be(32) };
    case NODE.GROUP_BEGIN:
      return { type: "GROUP_BEGIN", label: r.str() };
    case NODE.GROUP_END:
      return { type: "GROUP_END" };
    case NODE.RISK: {
      const code = Number(r.be(2));
      if (!(code in RISK_NAMES)) throw new Error(`VTREE: unknown risk code ${code}`);
      return { type: "RISK", code, args: r.hex(r.end - r.p) };
    }
    case NODE.BLIND:
      return { type: "BLIND", label: r.str(), keccak: r.hex(32), len: Number(r.be(4)), boundBy: Number(r.be(2)) };
    case NODE.FEE:
      return { type: "FEE", asset: r.hex(20) as Address, amount: r.be(32) };
    case NODE.GUARANTEE: {
      const at = r.p;
      const op = r.u8();
      let size: number;
      try {
        size = itemSize(op);
      } catch {
        throw new Error(`VTREE: unknown guarantee 0x${op.toString(16)}`);
      }
      r.p = at;
      return { type: "GUARANTEE", op, bytes: r.hex(1 + size) };
    }
    default:
      throw new Error(`VTREE: unknown node type 0x${type.toString(16)}`);
  }
}

/**
 * The spec is the GUARANTEE section, re-encoded: §7.2. So the device derives what it signs instead of taking a hash from the
 * host. A tree whose guarantees are not contiguous and last is refused.
 */
export function specOf(t: DecodedTree): Hex {
  const items = t.nodes.filter((n): n is Extract<TreeNode, { type: "GUARANTEE" }> => n.type === "GUARANTEE");
  const first = t.nodes.findIndex((n) => n.type === "GUARANTEE");
  if (first < 0 || first !== t.nodes.length - items.length) throw new Error("VTREE: guarantees must be the last nodes");
  const required = [SPEC.TRACKED_NO_DECREASE, SPEC.TRACKED_NO_ALLOW_INC, SPEC.ACCOUNT_INVARIANT, SPEC.APPROVALS_CLEARED];
  if (items.length < 4 || required.some((op, i) => items[items.length - 4 + i].op !== op)) throw new Error("VTREE: a required guarantee is missing");
  const n = items.length.toString(16).padStart(4, "0");
  return `0x56530002${n}${items.map((g) => g.bytes.slice(2)).join("")}` as Hex;
}

/** Exact decimal, never rounded: digits, at most one dot, then the symbol. */
export function formatAmount(raw: bigint, decimals: number, symbol: string): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${whole}${frac ? "." + frac : ""} ${symbol}`;
}

const shortAddr = (a: string) => a;

export interface DeviceLine {
  text: string;
  risk?: boolean;
  guarantee?: boolean;
  indent: number;
}

/** What this tree says about a token, so a guarantee can name it. An unnamed token stays an address. */
function tokenNames(t: DecodedTree): Map<string, { symbol: string; decimals: number }> {
  const m = new Map<string, { symbol: string; decimals: number }>([["0x0000000000000000000000000000000000000000", { symbol: "ETH", decimals: 18 }]]);
  for (const n of t.nodes) if (n.type === "FIELD_AMOUNT") m.set(n.token.toLowerCase(), { symbol: n.symbol, decimals: n.decimals });
  return m;
}

const addrAt = (h: string, byte: number) => `0x${h.slice(2 + byte * 2, 2 + (byte + 20) * 2)}`;
const wordAt = (h: string, byte: number, len = 32) => BigInt(`0x${h.slice(2 + byte * 2, 2 + (byte + len) * 2)}`);

/** One plain sentence per guarantee. Bytes: op, then the arguments. */
export function guaranteeText(g: Extract<TreeNode, { type: "GUARANTEE" }>, t: DecodedTree, names = tokenNames(t)): string {
  const b = g.bytes;
  const you = (a: string) => (a.toLowerCase() === t.account.toLowerCase() ? "You" : a);
  const amount = (asset: string, raw: bigint) => {
    const n = names.get(asset.toLowerCase());
    return n ? formatAmount(raw, n.decimals, n.symbol) : `${raw} of token ${asset}`;
  };
  switch (g.op) {
    case SPEC.DELTA_EQ: {
      const v = BigInt.asIntN(256, wordAt(b, 41));
      const who = you(addrAt(b, 1));
      const asset = addrAt(b, 21);
      if (v === 0n) return `${who} end with the same ${amount(asset, 0n).split(" ").slice(1).join(" ")}`;
      return v < 0n ? `${who} lose exactly ${amount(asset, -v)}` : `${who} gain exactly ${amount(asset, v)}`;
    }
    case SPEC.DELTA_GE:
      return `${you(addrAt(b, 1))} receive at least ${amount(addrAt(b, 21), wordAt(b, 41))}`;
    case SPEC.ALLOW_LE:
      return `${addrAt(b, 21)} may spend at most ${amount(addrAt(b, 1), wordAt(b, 41))} afterwards`;
    case SPEC.P2ALLOW_LE:
      return `Through Permit2, ${addrAt(b, 41)} may spend at most ${amount(addrAt(b, 21), wordAt(b, 61, 20))} afterwards`;
    case SPEC.OPERATOR_EQ:
      return `${addrAt(b, 21)} ${wordAt(b, 41, 1) === 1n ? "may" : "may not"} move your items in ${addrAt(b, 1)}`;
    case SPEC.OWNER_EQ:
      return `${addrAt(b, 53)} owns item ${wordAt(b, 21)} of ${addrAt(b, 1)} afterwards`;
    case SPEC.CODEHASH_EQ:
      return `The code at ${addrAt(b, 1)} is what was attested`;
    case SPEC.NO_CODE:
      return `${addrAt(b, 1)} is not a contract`;
    case SPEC.TRACKED_NO_DECREASE:
      return "No other tracked holding decreases";
    case SPEC.TRACKED_NO_ALLOW_INC:
      return "No other Permit2 allowance grows";
    case SPEC.ACCOUNT_INVARIANT:
      return wordAt(b, 1, 1) === 1n ? "! Owners or policy may change" : "Owners and policy stay the same";
    case SPEC.APPROVALS_CLEARED:
      return "No approval outlives this transaction";
    case SPEC.IMPL_EQ:
      return `The proxy at ${addrAt(b, 1)} still runs ${addrAt(b, 25)}`;
    case SPEC.NAME_EQ:
      return `The name shown for ${addrAt(b, 1)} still resolves to it`;
    default:
      throw new Error(`VTREE: unknown guarantee 0x${g.op.toString(16)}`);
  }
}

/** Every node becomes a line. Guarantees come first (§7.1), then risk lines, then the sentence. */
export function formatForDevice(t: DecodedTree): DeviceLine[] {
  const guarantees: DeviceLine[] = [];
  const risks: DeviceLine[] = [];
  const lines: DeviceLine[] = [];
  const names = tokenNames(t);
  let indent = 0;
  const push = (text: string, extra: Partial<DeviceLine> = {}) => lines.push({ text, indent, ...extra });
  for (const n of t.nodes) {
    switch (n.type) {
      case "CALL_BEGIN":
        push(`${n.intent}${n.publisher ? ` (by ${n.publisher})` : ""} at ${shortAddr(n.target)}`);
        if (n.attestStatus === 0) push("Not attested", { risk: true });
        indent++;
        break;
      case "CALL_END":
        indent--;
        break;
      case "GROUP_BEGIN":
        push(n.label);
        indent++;
        break;
      case "GROUP_END":
        indent--;
        break;
      case "FIELD_ADDRESS": {
        const who = n.isSelf ? "this account" : n.nameSource ? `${n.name} (${n.addr})` : n.addr;
        push(`${n.label}: ${who}${n.hasCode && !n.isSelf ? " [contract]" : ""}`);
        break;
      }
      case "FIELD_AMOUNT":
        push(`${n.label}: ${formatAmount(n.raw, n.decimals, n.symbol)}`);
        break;
      case "FIELD_UINT":
        push(`${n.label}: ${n.unit === 1 ? `timestamp ${n.value}` : n.unit === 2 ? `${n.value} bps` : n.value}`);
        break;
      case "FIELD_BOOL":
        push(`${n.label}: ${n.value ? "yes" : "no"}`);
        break;
      case "FIELD_ENUM":
        push(`${n.label}: ${n.text}`);
        break;
      case "FIELD_BYTES":
        push(`${n.label}: ${n.len} bytes, hash ${n.keccak}`);
        break;
      case "FIELD_ETH_VALUE":
        push(`Sends ${formatAmount(n.raw, 18, "ETH")}`);
        break;
      case "RISK": {
        const line = { text: `! ${RISK_TEXT[n.code]}${n.args !== "0x" ? ` ${n.args}` : ""}`, indent: 0, risk: true };
        risks.push(line);
        break;
      }
      case "BLIND": {
        const line = { text: `! BLIND DATA "${n.label}": ${n.len} bytes, hash ${n.keccak}`, indent: 0, risk: true };
        risks.push(line);
        break;
      }
      case "FEE":
        push(`Fee cap: ${formatAmount(n.amount, 18, "ETH")}`);
        break;
      case "GUARANTEE":
        guarantees.push({ text: guaranteeText(n, t, names), indent: 0, guarantee: true });
        break;
    }
  }
  lines.push({ text: `Valid until ${new Date(Number(t.expiry) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`, indent: 0 });
  lines.push({ text: `Policy version ${t.policyVersion}, path ${t.path === 1 ? "stateless" : t.path === 2 ? "paymaster" : "ERC-4337"}`, indent: 0 });
  lines.push({ text: `Snapshot ${t.snapshotRoot}`, indent: 0 });
  return [...guarantees, ...risks, ...lines];
}

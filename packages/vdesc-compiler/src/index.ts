// ERC-7730 JSON plus the Verbatim "effects" extension, to VDesc bytes (docs/VDESC.md). Deterministic.
import { bytesToHex, keccak256, toFunctionSelector, type Hex } from "viem";

export type Src = { kind: "target" } | { kind: "const"; address: Hex } | { kind: "field"; path: string };

export interface FieldSpec {
  /** Word path, e.g. "0", or "2>0" for "follow the pointer at word 2, then word 0". "2.0" stays inside an inline tuple. */
  path?: string;
  label: string;
  format: "address" | "tokenAmount" | "uint" | "bool" | "enum" | "bytes" | "calldata" | "ethValue";
  role?: "other" | "recipient" | "spender" | "operator";
  token?: Src;
  unit?: "none" | "timestamp" | "bips";
  enum?: Record<string, string>;
  callTarget?: string;
  callValue?: string;
}

export type EffectSpec =
  | { kind: "OUT_EXACT"; token: Src; amount: string; to: string }
  | { kind: "IN_MIN"; token: Src; amount: string }
  | { kind: "APPROVE_SET"; token: Src; spender: string; amount: string }
  | { kind: "OPERATOR_SET"; token: Src; operator: string; approved: string }
  | { kind: "SHARES_MIN"; token: Src; min: string }
  | { kind: "NFT_OUT"; token: Src; id: string; to: string }
  | { kind: "P2_APPROVE_SET"; token: Src; spender: string; amount: string };

/** One function of a descriptor, in our effects-extended ERC-7730 subset. */
export interface FunctionSpec {
  signature: string;
  intent: string;
  /** Number of static words, when calldata length is fixed. Omit for dynamic functions. */
  exactWords?: number;
  fields: FieldSpec[];
  effects?: EffectSpec[];
  flags?: ("UNLIMITED_IF" | "OPERATOR" | "ADMIN")[];
}

const ROLES = { other: 0, recipient: 1, spender: 2, operator: 3 } as const;
const UNITS = { none: 0, timestamp: 1, bips: 2 } as const;
const FORMATS = { address: 1, tokenAmount: 2, uint: 3, bool: 4, enum: 5, bytes: 6, calldata: 7, ethValue: 8 } as const;
const EFFECTS = { OUT_EXACT: 1, IN_MIN: 2, APPROVE_SET: 3, OPERATOR_SET: 4, SHARES_MIN: 5, NFT_OUT: 6, P2_APPROVE_SET: 7 } as const;
const FLAGS = { UNLIMITED_IF: 1, OPERATOR: 2, ADMIN: 4 } as const;

const VALID = /^[\x20-\x5b\x5d-\x7e]*$/;

function str(s: string): number[] {
  if (s.length > 48 || !VALID.test(s)) throw new Error(`bad descriptor string: ${JSON.stringify(s)}`);
  return [s.length, ...Buffer.from(s, "ascii")];
}

/** "2" -> one step. ">" follows a pointer, "." stays inline. Empty -> no path. */
function path(p?: string): number[] {
  if (!p) return [0];
  const steps: number[] = [];
  const re = /(\d+)([>.]?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    const idx = Number(m[1]);
    if (idx > 0x7f) throw new Error(`path index too large: ${p}`);
    steps.push(m[2] === ">" ? idx | 0x80 : idx);
  }
  if (!steps.length || steps.length > 8) throw new Error(`bad path: ${p}`);
  return [steps.length, ...steps];
}

function src(s: Src): number[] {
  if (s.kind === "target") return [0];
  if (s.kind === "field") return [1, ...path(s.path)];
  const a = Buffer.from(s.address.slice(2), "hex");
  if (a.length !== 20) throw new Error(`bad address ${s.address}`);
  return [2, ...a];
}

function field(f: FieldSpec): number[] {
  const out = [...path(f.path), FORMATS[f.format], ...str(f.label)];
  switch (f.format) {
    case "address":
      out.push(ROLES[f.role ?? "other"]);
      break;
    case "tokenAmount":
      if (!f.token) throw new Error(`tokenAmount field "${f.label}" needs a token source`);
      out.push(...src(f.token));
      break;
    case "uint":
      out.push(UNITS[f.unit ?? "none"]);
      break;
    case "enum": {
      const entries = Object.entries(f.enum ?? {}).sort(([a], [b]) => Number(a) - Number(b));
      out.push(entries.length);
      for (const [code, text] of entries) out.push((Number(code) >> 8) & 0xff, Number(code) & 0xff, ...str(text));
      break;
    }
    case "calldata":
      if (f.callTarget) out.push(1, ...path(f.callTarget));
      else out.push(0);
      if (f.callValue) out.push(1, ...path(f.callValue));
      else out.push(0);
      break;
    default:
      break;
  }
  return out;
}

function effect(e: EffectSpec): number[] {
  const head = [EFFECTS[e.kind], ...src(e.token)];
  switch (e.kind) {
    case "OUT_EXACT":
      return [...head, ...path(e.amount), ...path(e.to)];
    case "IN_MIN":
      return [...head, ...path(e.amount)];
    case "APPROVE_SET":
    case "P2_APPROVE_SET":
      return [...head, ...path(e.spender), ...path(e.amount)];
    case "OPERATOR_SET":
      return [...head, ...path(e.operator), ...path(e.approved)];
    case "SHARES_MIN":
      return [...head, ...path(e.min)];
    case "NFT_OUT":
      return [...head, ...path(e.id), ...path(e.to)];
  }
}

export function compile(f: FunctionSpec): { vdesc: Hex; descHash: Hex; selector: Hex } {
  const bytes = [
    0x56, 0x44, 0x00, 0x01,
    ...str(f.intent),
    f.exactWords ?? 0xff,
    f.fields.length,
    ...f.fields.flatMap(field),
    (f.effects ?? []).length,
    ...(f.effects ?? []).flatMap(effect),
  ];
  const flags = (f.flags ?? []).reduce((acc, x) => acc | FLAGS[x], 0);
  bytes.push((flags >> 8) & 0xff, flags & 0xff);
  const vdesc = bytesToHex(Uint8Array.from(bytes));
  return { vdesc, descHash: keccak256(vdesc), selector: toFunctionSelector(f.signature) };
}

/**
 * Reads a descriptor file: standard ERC-7730 `metadata` and `display.formats` keys, each format carrying the
 * Verbatim `x-verbatim` extension with the compiled-field details. Our own subset, documented in docs/VDESC.md.
 */
export function compileFile(json: { metadata?: { owner?: string }; display: { formats: Record<string, { intent: string; "x-verbatim": Omit<FunctionSpec, "signature" | "intent"> }> } }) {
  return Object.entries(json.display.formats)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([signature, fmt]) => ({ signature, publisher: json.metadata?.owner ?? "", ...compile({ signature, intent: fmt.intent, ...fmt["x-verbatim"] }) }));
}

// VTREE / VSPEC writers: the TypeScript twin of contracts/src/lib/VTree.sol. Any change there must land here.
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

export class RenderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new RenderError(code);
};

export const NODE = {
  CALL_BEGIN: 0x01, CALL_END: 0x02,
  FIELD_ADDRESS: 0x10, FIELD_AMOUNT: 0x11, FIELD_UINT: 0x12, FIELD_BOOL: 0x13, FIELD_ENUM: 0x14, FIELD_BYTES: 0x15, FIELD_ETH_VALUE: 0x16,
  GROUP_BEGIN: 0x20, GROUP_END: 0x21, RISK: 0x30, BLIND: 0x31, FEE: 0x40, VALID_UNTIL: 0x41, POLICY: 0x42,
} as const;

export const UNIT = { NONE: 0, TIMESTAMP: 1, BIPS: 2 } as const;

export const RISK = {
  UNLIMITED_APPROVAL: 0x0001, OPERATOR_APPROVAL: 0x0002, UPGRADEABLE_TARGET: 0x0003, UNVERIFIED_CONTRACT: 0x0004, TRUST_CHANGE: 0x0005,
  NO_POST_CHECK: 0x0006, RECIPIENT_HAS_CODE: 0x0007, RECIPIENT_NOT_SELF: 0x0008, NO_MIN_OUT: 0x0101, HOOK_CAN_TAKE_INPUT: 0x0102,
  HOOK_CAN_TAKE_OUTPUT: 0x0103, HOOK_DYNAMIC_FEE: 0x0104, HOOK_UNVERIFIED: 0x0105, SWEEP_TO_OTHER: 0x0106, PERMIT2_ALLOWANCE_CHANGE: 0x0107,
  UR_ALLOW_REVERT: 0x0108, TTL_LONG: 0x0201, TOKEN_UNSAFE: 0x0202,
} as const;

export const BIT = {
  UNVERIFIED: 1 << 0, BLIND: 1 << 1, UNLIMITED: 1 << 2, NO_MIN_OUT: 1 << 3, HOOK_TAKE: 1 << 4, HOOK_UNVERIFIED: 1 << 5, TTL_LONG: 1 << 6, TOKEN_UNSAFE: 1 << 7, TRUST_CHANGE: 1 << 8,
} as const;

const beBytes = (v: bigint, n: number): number[] => {
  const out = new Array<number>(n);
  let x = v;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
};

export class Buf {
  bytes: number[] = [];
  constructor(public cap: number) {}
  private check() {
    if (this.bytes.length > this.cap) fail("BufOverflow");
  }
  u8(v: number | bigint) {
    this.bytes.push(Number(BigInt(v) & 0xffn));
    this.check();
  }
  be(v: number | bigint, n: number) {
    this.bytes.push(...beBytes(BigInt(v), n));
    this.check();
  }
  addr(a: string) {
    this.bytes.push(...hexToBytes(a.toLowerCase() as Hex));
    this.check();
  }
  word(v: bigint) {
    this.be(v & ((1n << 256n) - 1n), 32);
  }
  copy(d: Uint8Array, off: bigint | number, n: bigint | number) {
    const o = BigInt(off);
    const m = BigInt(n);
    if (o + m > BigInt(d.length)) fail("OutOfBounds");
    for (let i = 0; i < Number(m); i++) this.bytes.push(d[Number(o) + i]);
    this.check();
  }
  patchBe(pos: number, v: number | bigint, n: number) {
    if (pos + n > this.bytes.length) fail("OutOfBounds");
    const b = beBytes(BigInt(v), n);
    for (let i = 0; i < n; i++) this.bytes[pos + i] = b[i];
  }
  get len() {
    return this.bytes.length;
  }
  toHex(): Hex {
    return bytesToHex(Uint8Array.from(this.bytes));
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

// Readers over bytes, with offsets as bigints so a hostile 256-bit offset simply misses the bounds check.
export function rdWord(d: Uint8Array, off: bigint | number): bigint {
  const o = BigInt(off);
  if (o + 32n > BigInt(d.length)) fail("OutOfBounds");
  let v = 0n;
  const start = Number(o);
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(d[start + i]);
  return v;
}
export function rdU8(d: Uint8Array, off: bigint | number): number {
  const o = BigInt(off);
  if (o >= BigInt(d.length)) fail("OutOfBounds");
  return d[Number(o)];
}
export function rdBe(d: Uint8Array, off: bigint | number, n: number): bigint {
  const o = BigInt(off);
  if (o + BigInt(n) > BigInt(d.length)) fail("OutOfBounds");
  let v = 0n;
  const start = Number(o);
  for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(d[start + i]);
  return v;
}
export const toAddr = (v: bigint): Address => `0x${(v & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}` as Address;
export function rdAddr(d: Uint8Array, off: bigint | number): Address {
  const v = rdWord(d, off);
  if (v >> 160n !== 0n) fail("OutOfBounds");
  return toAddr(v);
}
export function slice(d: Uint8Array, off: bigint | number, n: bigint | number): Uint8Array {
  const o = BigInt(off);
  const m = BigInt(n);
  if (o + m > BigInt(d.length)) fail("OutOfBounds");
  return d.slice(Number(o), Number(o + m));
}

const ascii = (s: string) => new TextEncoder().encode(s);

export const VT = {
  begin(t: Buf, kind: number): number {
    t.u8(kind);
    const at = t.len;
    t.be(0, 2);
    return at;
  },
  end(t: Buf, at: number) {
    t.patchBe(at, t.len - at - 2, 2);
  },
  strFrom(t: Buf, d: Uint8Array, off: bigint | number, n: bigint | number) {
    if (BigInt(n) > 48n) fail("StrTooLong");
    t.u8(Number(n));
    t.copy(d, off, n);
  },
  str(t: Buf, s: string | Uint8Array) {
    const b = typeof s === "string" ? ascii(s) : s;
    VT.strFrom(t, b, 0, b.length);
  },
  /** bytes32: text left-aligned, length in the last byte. */
  strPacked(t: Buf, s: bigint) {
    const n = Number(s & 0xffn);
    if (n > 31) fail("StrTooLong");
    t.u8(n);
    t.be(s >> BigInt((32 - n) * 8), n);
  },
  risk(t: Buf, code: number) {
    const at = VT.begin(t, NODE.RISK);
    t.be(code, 2);
    VT.end(t, at);
  },
  riskAddr(t: Buf, code: number, a: string) {
    const at = VT.begin(t, NODE.RISK);
    t.be(code, 2);
    t.addr(a);
    VT.end(t, at);
  },
  fieldUint(t: Buf, label: string | Uint8Array, v: bigint, unit: number) {
    const at = VT.begin(t, NODE.FIELD_UINT);
    VT.str(t, label);
    t.word(v);
    t.u8(unit);
    VT.end(t, at);
  },
  fieldBytes(t: Buf, label: string | Uint8Array, h: bigint, n: bigint) {
    const at = VT.begin(t, NODE.FIELD_BYTES);
    VT.str(t, label);
    t.word(h);
    t.be(n, 4);
    VT.end(t, at);
  },
  fieldBool(t: Buf, label: string | Uint8Array, v: boolean) {
    const at = VT.begin(t, NODE.FIELD_BOOL);
    VT.str(t, label);
    t.u8(v ? 1 : 0);
    VT.end(t, at);
  },
  fieldEth(t: Buf, v: bigint) {
    const at = VT.begin(t, NODE.FIELD_ETH_VALUE);
    t.word(v);
    VT.end(t, at);
  },
  blind(t: Buf, label: string | Uint8Array, h: bigint, n: bigint) {
    const at = VT.begin(t, NODE.BLIND);
    VT.str(t, label);
    t.word(h);
    t.be(n, 4);
    t.be(0xffff, 2);
    VT.end(t, at);
  },
  groupBegin(t: Buf, label: string | Uint8Array) {
    const at = VT.begin(t, NODE.GROUP_BEGIN);
    VT.str(t, label);
    VT.end(t, at);
  },
  groupEnd(t: Buf) {
    VT.end(t, VT.begin(t, NODE.GROUP_END));
  },
  callEnd(t: Buf) {
    VT.end(t, VT.begin(t, NODE.CALL_END));
  },
};

export const SPEC = {
  MAGIC: 0x56530001, DELTA_EQ: 0x01, DELTA_GE: 0x02, ALLOW_LE: 0x03, P2ALLOW_LE: 0x04, OPERATOR_EQ: 0x05, OWNER_EQ: 0x06, CODEHASH_EQ: 0x07, NO_CODE: 0x08,
  TRACKED_NO_DECREASE: 0x09, TRACKED_NO_ALLOW_INC: 0x0a, ACCOUNT_INVARIANT: 0x0b, IMPL_EQ: 0x0c, NAME_EQ: 0x0d, P2_ABSOLUTE: 0, P2_RELATIVE: 1,
} as const;

const INT_MIN = -(1n << 255n);
const INT_MAX = (1n << 255n) - 1n;

export const toInt = (v: bigint): bigint => {
  if (v >> 255n !== 0n) fail("TooManyEffects");
  return v;
};

export class Effects {
  deltas: { holder: string; asset: string; value: bigint; ge: boolean }[] = [];
  other: Buf;
  nOther = 0;
  constructor(cap: number) {
    this.other = new Buf(cap);
  }
  addDelta(holder: string, asset: string, value: bigint, ge: boolean) {
    const h = holder.toLowerCase();
    const a = asset.toLowerCase();
    for (const d of this.deltas) {
      if (d.holder === h && d.asset === a) {
        if (d.ge !== ge) fail("ConflictingEffects");
        d.value += value;
        if (d.value > INT_MAX || d.value < INT_MIN) fail("Overflow");
        return;
      }
    }
    if (this.deltas.length === 16) fail("TooManyEffects");
    this.deltas.push({ holder: h, asset: a, value, ge });
  }
  allowLe(token: string, spender: string, max: bigint) {
    this.other.u8(SPEC.ALLOW_LE);
    this.other.addr(token);
    this.other.addr(spender);
    this.other.word(max);
    this.nOther++;
  }
  p2AllowLe(permit2: string, token: string, spender: string, mode: number, value: bigint) {
    this.other.u8(SPEC.P2ALLOW_LE);
    this.other.addr(permit2);
    this.other.addr(token);
    this.other.addr(spender);
    this.other.u8(mode);
    this.other.be(value, 20);
    this.nOther++;
  }
  operatorEq(c: string, op: string, v: boolean) {
    this.other.u8(SPEC.OPERATOR_EQ);
    this.other.addr(c);
    this.other.addr(op);
    this.other.u8(v ? 1 : 0);
    this.nOther++;
  }
  ownerEq(c: string, id: bigint, owner: string) {
    this.other.u8(SPEC.OWNER_EQ);
    this.other.addr(c);
    this.other.word(id);
    this.other.addr(owner);
    this.nOther++;
  }
  codehashEq(target: string, h: bigint) {
    this.other.u8(SPEC.CODEHASH_EQ);
    this.other.addr(target);
    this.other.word(h);
    this.nOther++;
  }
  noCode(a: string) {
    this.other.u8(SPEC.NO_CODE);
    this.other.addr(a);
    this.nOther++;
  }
  implEq(target: string, getter: bigint, impl: string) {
    this.other.u8(SPEC.IMPL_EQ);
    this.other.addr(target);
    this.other.be(getter, 4);
    this.other.addr(impl);
    this.nOther++;
  }
  nameEq(a: string, resolver: string, packedName: bigint) {
    this.other.u8(SPEC.NAME_EQ);
    this.other.addr(a);
    this.other.addr(resolver);
    this.other.word(packedName);
    this.nOther++;
  }
  finish(trustChange: boolean): Uint8Array {
    const s = new Buf(1 << 30);
    s.be(SPEC.MAGIC, 4);
    s.be(this.deltas.length + this.nOther + 3, 2);
    for (const d of this.deltas) {
      s.u8(d.ge ? SPEC.DELTA_GE : SPEC.DELTA_EQ);
      s.addr(d.holder);
      s.addr(d.asset);
      s.word(d.value);
    }
    s.copy(this.other.toBytes(), 0, this.other.len);
    s.u8(SPEC.TRACKED_NO_DECREASE);
    s.u8(SPEC.TRACKED_NO_ALLOW_INC);
    s.u8(SPEC.ACCOUNT_INVARIANT);
    s.u8(trustChange ? 1 : 0);
    return s.toBytes();
  }
}

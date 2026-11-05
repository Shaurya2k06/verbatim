// TypeScript twin of contracts/src/lib/DisplayVM.sol. Untrusted by design: on-chain render is the authority and any
// mismatch fails closed, so this only has to be right to be useful. tools/difffuzz holds it to byte equality.
import { bytesToHex, hexToBigInt, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { BIT, Buf, Effects, NODE, RISK, RenderError, VT, rdAddr, rdBe, rdU8, rdWord, renderUR, slice, toAddr, toInt, type URCtx } from "@verbatim/urrender";

export { RenderError } from "@verbatim/urrender";
export * from "./device";

const MAX_DEPTH = 3;
const MAX_TREE = 6144;
const MAX_OTHER = 2048;
export const DEFAULT_MAX_TTL = 300n;
const EMPTY_CODE = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const PACKED_ETH = 0x4554480000000000000000000000000000000000000000000000000000000003n;
const PACKED_UNKNOWN = 0x3f00000000000000000000000000000000000000000000000000000000000001n;

const K = { ADDRESS: 1, TOKEN_AMOUNT: 2, UINT: 3, BOOL: 4, ENUM: 5, BYTES: 6, CALLDATA: 7, ETH_VALUE: 8 } as const;
const E = { OUT_EXACT: 1, IN_MIN: 2, APPROVE_SET: 3, OPERATOR_SET: 4, SHARES_MIN: 5, NFT_OUT: 6, P2_APPROVE_SET: 7, IN_VALUE: 8 } as const;
const F = { UNLIMITED_IF: 1, OPERATOR: 2, ADMIN: 4 } as const;
const VDESC_MAGIC = 0x56440001n;
const ROLE_RECIPIENT = 1;

export interface Desc {
  blob: Hex;
  publisher: Hex;
  epoch: bigint;
  status: number;
}

export interface TokenInfo {
  /** bytes32 packed: text left-aligned, length in the last byte */
  symbol: Hex;
  decimals: number;
  flags: number;
  known: boolean;
}

/** Synchronous view of a trust store. `null` from `descriptor` means no live descriptor. */
export interface Trust {
  codehashOf(a: Address): Hex;
  descriptor(codehash: Hex, selector: Hex): Desc | null;
  tokenInfo(token: Address): TokenInfo;
  nameOf(a: Address): Hex;
  nameResolver(a: Address): Address;
  hookIsAttested(codehash: Hex): boolean;
  spenderIsAttested(spender: Address): boolean;
  codeKind(codehash: Hex): number;
  routerConfig(): { permit2: Address; weth: Address; publisher: Hex };
  proxyTemplate(codehash: Hex): { upgrader: Address; logicCodehash: Hex; impl: Address; getter: Hex };
}

export interface RenderIn {
  chainId: bigint;
  account: Address;
  /** Unix seconds. The device checks it against its own clock, the account at execution. */
  validUntil: bigint;
  feeAsset: Address;
  feeAmount: bigint;
  gasLimitTotal: bigint;
  policyHash: Hex;
  /** ABI body of executeVerified, no selector */
  body: Hex;
  hints: Address[];
}

export interface RenderOut {
  tree: Hex;
  spec: Hex;
  treeHash: Hex;
  specHash: Hex;
  risk: number;
}

const fail = (code: string): never => {
  throw new RenderError(code);
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hexWord = (v: bigint): Hex => `0x${v.toString(16).padStart(64, "0")}` as Hex;

interface Ctx extends URCtx {
  hints: Address[];
  trustChange: boolean;
  trust: Trust;
}

export function render(i: RenderIn, trust: Trust): RenderOut {
  const t = new Buf(MAX_TREE);
  const c: Ctx = {
    account: i.account,
    router: ZERO,
    permit2: ZERO,
    weth: ZERO,
    value: 0n,
    effects: new Effects(MAX_OTHER),
    risk: 0,
    hints: i.hints,
    trustChange: false,
    trust,
    amount: (b, label, token, raw, ctx) => amountField(b, label, token, raw, ctx as Ctx),
    hookAttested: (hook, ctx) => {
      const x = ctx as Ctx;
      const ch = hinted(x, hook);
      if (ch === 0n) return false;
      x.effects.codehashEq(hook, ch);
      return x.trust.hookIsAttested(hexWord(ch));
    },
    addressField: (b, label, a, ctx) => addressField(b, label, a, ROLE_RECIPIENT, ctx as Ctx),
  };

  t.be(0x56540001, 4);
  t.be(i.chainId, 8);
  t.addr(i.account);
  t.be(i.validUntil, 8);

  let at = VT.begin(t, NODE.FEE);
  t.addr(i.feeAsset);
  tokenBody(t, i.feeAsset, i.feeAmount, c);
  t.be(i.gasLimitTotal, 8);
  VT.end(t, at);

  at = VT.begin(t, NODE.VALID_UNTIL);
  t.be(i.validUntil, 8);
  VT.end(t, at);

  const b = hexToBytes(i.body);
  const arr = rdWord(b, 64n);
  const n = rdWord(b, arr);
  if (n > 16n) fail("BadCalldata");
  const el = arr + 32n;
  for (let k = 0n; k < n; k++) {
    const callAt = el + rdWord(b, el + k * 32n);
    const target = rdAddr(b, callAt);
    const value = rdWord(b, callAt + 32n);
    const dataAt = callAt + rdWord(b, callAt + 64n);
    const dataLen = rdWord(b, dataAt);
    renderCall(t, c, target, value, slice(b, dataAt + 32n, dataLen), 0);
  }

  at = VT.begin(t, NODE.POLICY);
  t.word(hexToBigInt(i.policyHash));
  VT.end(t, at);

  const tree = t.toHex();
  const spec = bytesToHex(c.effects.finish(c.trustChange));
  return { tree, spec, treeHash: keccak256(tree), specHash: keccak256(spec), risk: c.risk };
}

/** The spec a tree implies. Render computes both together, since effects need the descriptors. */
export const derive = (i: RenderIn, trust: Trust) => render(i, trust).spec;

function hinted(c: Ctx, a: Address): bigint {
  for (const h of c.hints) {
    if (same(h, a)) {
      const ch = c.trust.codehashOf(a);
      if (ch === ZERO32 || ch === EMPTY_CODE) fail("BadHint");
      return hexToBigInt(ch);
    }
  }
  c.effects.noCode(a);
  return 0n;
}

function callBegin(t: Buf, target: string, ch: bigint, sel: bigint, descHash: bigint, label: Uint8Array, lOff: number, lLen: number, publisher: bigint, status: number, version: bigint) {
  const at = VT.begin(t, NODE.CALL_BEGIN);
  t.addr(target);
  t.word(ch);
  t.be(sel, 4);
  t.word(descHash);
  VT.strFrom(t, label, lOff, lLen);
  VT.strPacked(t, publisher);
  t.u8(status);
  t.be(version, 8);
  VT.end(t, at);
}

const txt = (s: string) => new TextEncoder().encode(s);

function renderCall(t: Buf, c: Ctx, target: Address, value: bigint, data: Uint8Array, depth: number) {
  if (depth > MAX_DEPTH) fail("DepthExceeded");
  const e = c.effects;
  const account = c.account;
  const ch = hinted(c, target);
  if (value > 0n) e.addDelta(account, ZERO, -toInt(value), false);

  if (ch === 0n) {
    const l = txt("Send ETH");
    callBegin(t, target, 0n, 0n, 0n, l, 0, l.length, 0n, 0, 0n);
    VT.fieldEth(t, value);
    addressField(t, "To", target, ROLE_RECIPIENT, c);
    if (data.length !== 0) blindCall(t, c, data);
    VT.callEnd(t);
    return;
  }
  e.codehashEq(target, ch);

  const sel = data.length >= 4 ? rdBe(data, 0, 4) : 0n;
  const selHex = (`0x${sel.toString(16).padStart(8, "0")}`) as Hex;
  const chHex = hexWord(ch);
  let d = c.trust.descriptor(chHex, selHex);
  const kind = d === null ? c.trust.codeKind(chHex) : 0;

  if (kind === 1 || kind === 3) {
    c.legacyParams = kind === 3;
    const r = c.trust.routerConfig();
    const l = txt("Uniswap swap");
    callBegin(t, target, ch, sel, 0n, l, 0, l.length, hexToBigInt(r.publisher), 2, 0n);
    if (value > 0n) VT.fieldEth(t, value);
    c.router = target;
    c.permit2 = r.permit2;
    c.weth = r.weth;
    c.value = value;
    renderUR(t, data, c);
    VT.callEnd(t);
    return;
  }
  let upgrader: Address = ZERO;
  if (kind === 2) {
    const p = c.trust.proxyTemplate(chHex);
    upgrader = p.upgrader;
    e.implEq(target, BigInt(p.getter), p.impl);
    d = c.trust.descriptor(p.logicCodehash, selHex);
  }
  if (d === null) {
    const l = txt("Unverified call");
    callBegin(t, target, ch, sel, 0n, l, 0, l.length, 0n, 0, 0n);
    if (value > 0n) VT.fieldEth(t, value);
    if (kind === 2) VT.riskAddr(t, RISK.UPGRADEABLE_TARGET, upgrader);
    blindCall(t, c, data);
    VT.callEnd(t);
    return;
  }
  renderDesc(t, c, target, ch, sel, value, data, d, depth, kind === 2, upgrader);
}

function blindCall(t: Buf, c: Ctx, data: Uint8Array) {
  VT.risk(t, RISK.UNVERIFIED_CONTRACT);
  VT.blind(t, "calldata", hexToBigInt(keccak256(data)), BigInt(data.length));
  c.risk |= BIT.UNVERIFIED | BIT.BLIND;
}

function renderDesc(t: Buf, c: Ctx, target: Address, ch: bigint, sel: bigint, value: bigint, data: Uint8Array, desc: Desc, depth: number, isProxy: boolean, upgrader: Address) {
  const d = hexToBytes(desc.blob);
  if (rdBe(d, 0, 4) !== VDESC_MAGIC) fail("BadDescriptor");
  const labelLen = rdU8(d, 4);
  callBegin(t, target, ch, sel, hexToBigInt(keccak256(d)), d, 5, labelLen, hexToBigInt(desc.publisher), desc.status, desc.epoch);
  if (value > 0n) VT.fieldEth(t, value);
  if (isProxy) VT.riskAddr(t, RISK.UPGRADEABLE_TARGET, upgrader);

  let p = 5 + labelLen;
  const exact = rdU8(d, p++);
  if (exact !== 0xff && data.length !== 4 + exact * 32) fail("BadCalldata");
  let n = rdU8(d, p++);
  for (let i = 0; i < n; i++) p = field(t, c, target, value, data, d, p, depth);
  n = rdU8(d, p++);
  const flags = Number(rdBe(d, d.length - 2, 2));
  for (let i = 0; i < n; i++) p = effect(t, c, target, value, data, d, p, flags);
  if (flags & F.ADMIN) {
    VT.risk(t, RISK.TRUST_CHANGE);
    c.risk |= BIT.TRUST_CHANGE;
    c.trustChange = true;
  }
  VT.callEnd(t);
}

function pos(d: Uint8Array, p: number, cd: Uint8Array): [bigint, number] {
  const n = rdU8(d, p);
  if (n === 0) fail("BadDescriptor");
  let base = 4n;
  let at = 0n;
  for (let i = 0; i < n; i++) {
    const s = rdU8(d, p + 1 + i);
    at = base + BigInt(s & 0x7f) * 32n;
    if (i + 1 < n) base = s & 0x80 ? base + rdWord(cd, at) : at;
  }
  return [at, p + 1 + n];
}

function dynAt(cd: Uint8Array, d: Uint8Array, pathAt: number): [bigint, bigint] {
  const n = rdU8(d, pathAt);
  let base = 4n;
  let at = 0n;
  for (let i = 0; i < n; i++) {
    const s = rdU8(d, pathAt + 1 + i);
    at = base + BigInt(s & 0x7f) * 32n;
    if (i + 1 < n) base = s & 0x80 ? base + rdWord(cd, at) : at;
  }
  const a = base + rdWord(cd, at);
  const len = rdWord(cd, a);
  const off = a + 32n;
  if (off + len > BigInt(cd.length)) fail("BadCalldata");
  return [off, len];
}

function src(d: Uint8Array, p: number, target: Address, cd: Uint8Array): [Address, number] {
  const kind = rdU8(d, p);
  if (kind === 0) return [target, p + 1];
  if (kind === 2) return [toAddr(rdBe(d, p + 1, 20)), p + 21];
  const [at, next] = pos(d, p + 1, cd);
  return [rdAddr(cd, at), next];
}

function field(t: Buf, c: Ctx, target: Address, value: bigint, cd: Uint8Array, d: Uint8Array, start: number, depth: number): number {
  const pathAt = start;
  let p = start + 1 + rdU8(d, start);
  const kind = rdU8(d, p++);
  const lLen = rdU8(d, p);
  const lOff = p + 1;
  p = lOff + lLen;
  const label = slice(d, lOff, lLen);
  const leaf = () => pos(d, pathAt, cd)[0];

  if (kind === K.ETH_VALUE) {
    VT.fieldEth(t, value);
  } else if (kind === K.ADDRESS) {
    const a = rdAddr(cd, leaf());
    addressField(t, label, a, rdU8(d, p++), c);
  } else if (kind === K.TOKEN_AMOUNT) {
    const at = leaf();
    const [token, nx] = src(d, p, target, cd);
    p = nx;
    amountField(t, label, token, rdWord(cd, at), c);
  } else if (kind === K.UINT) {
    const v = rdWord(cd, leaf());
    VT.fieldUint(t, label, v, rdU8(d, p++));
  } else if (kind === K.BOOL) {
    const v = rdWord(cd, leaf());
    if (v > 1n) fail("BadCalldata");
    VT.fieldBool(t, label, v === 1n);
  } else if (kind === K.ENUM) {
    const v = rdWord(cd, leaf());
    p = enumField(t, label, v, d, p);
  } else if (kind === K.BYTES) {
    const [off, len] = dynAt(cd, d, pathAt);
    VT.fieldBytes(t, label, hexToBigInt(keccak256(slice(cd, off, len))), len);
  } else if (kind === K.CALLDATA) {
    const [off, len] = dynAt(cd, d, pathAt);
    let nt = target;
    const tk = rdU8(d, p++);
    if (tk === 1) {
      const [at, nx] = pos(d, p, cd);
      nt = rdAddr(cd, at);
      p = nx;
    }
    let nv = 0n;
    const vk = rdU8(d, p++);
    if (vk === 1) {
      const [at, nx] = pos(d, p, cd);
      nv = rdWord(cd, at);
      p = nx;
    }
    VT.groupBegin(t, label);
    renderCall(t, c, nt, nv, slice(cd, off, len), depth + 1);
    VT.groupEnd(t);
  } else {
    fail("BadDescriptor");
  }
  return p;
}

function enumField(t: Buf, label: Uint8Array, v: bigint, d: Uint8Array, start: number): number {
  let p = start;
  const n = rdU8(d, p++);
  let found = false;
  for (let j = 0; j < n; j++) {
    const code = rdBe(d, p, 2);
    const sLen = rdU8(d, p + 2);
    if (code === v && !found) {
      found = true;
      const at = VT.begin(t, NODE.FIELD_ENUM);
      VT.str(t, label);
      t.be(code, 2);
      VT.strFrom(t, d, p + 3, sLen);
      VT.end(t, at);
    }
    p += 3 + sLen;
  }
  if (!found) fail("UnknownEnum");
  return p;
}

function effect(t: Buf, c: Ctx, target: Address, value: bigint, cd: Uint8Array, d: Uint8Array, start: number, flags: number): number {
  let p = start;
  const kind = rdU8(d, p++);
  const [token, afterSrc] = src(d, p, target, cd);
  if (kind === E.IN_VALUE) {
    c.effects.addDelta(c.account, token, toInt(value), true);
    return afterSrc;
  }
  const [a, nx] = pos(d, afterSrc, cd);
  p = nx;
  const v1 = rdWord(cd, a);
  let v2 = 0n;
  if (kind !== E.IN_MIN && kind !== E.SHARES_MIN) {
    const [b, nx2] = pos(d, p, cd);
    p = nx2;
    v2 = rdWord(cd, b);
  }
  const e = c.effects;
  if (kind === E.OUT_EXACT) {
    e.addDelta(c.account, token, same(toAddr(v2), c.account) ? 0n : -toInt(v1), false);
  } else if (kind === E.IN_MIN || kind === E.SHARES_MIN) {
    e.addDelta(c.account, token, toInt(v1), true);
  } else if (kind === E.APPROVE_SET) {
    e.allowLe(token, toAddr(v1), v2);
    if (v2 !== 0n) spenderCheck(t, c, toAddr(v1));
    if (flags & F.UNLIMITED_IF && v2 >> 255n !== 0n) {
      VT.risk(t, RISK.UNLIMITED_APPROVAL);
      c.risk |= BIT.UNLIMITED;
    }
  } else if (kind === E.OPERATOR_SET) {
    if (v2 > 1n) fail("BadCalldata");
    e.operatorEq(token, toAddr(v1), v2 === 1n);
    if (v2 === 1n) spenderCheck(t, c, toAddr(v1));
    if (flags & F.OPERATOR && v2 === 1n) VT.risk(t, RISK.OPERATOR_APPROVAL);
  } else if (kind === E.NFT_OUT) {
    e.ownerEq(token, v1, toAddr(v2));
  } else if (kind === E.P2_APPROVE_SET) {
    if (v2 >> 160n !== 0n) fail("BadCalldata");
    e.p2AllowLe(target, token, toAddr(v1), 0, v2);
    if (v2 !== 0n) spenderCheck(t, c, toAddr(v1));
    VT.risk(t, RISK.PERMIT2_ALLOWANCE_CHANGE);
    if (v2 >= (1n << 160n) - 1n) {
      VT.risk(t, RISK.UNLIMITED_APPROVAL);
      c.risk |= BIT.UNLIMITED;
    }
  } else {
    fail("BadDescriptor");
  }
  return p;
}

function spenderCheck(t: Buf, c: Ctx, spender: Address) {
  if (!c.trust.spenderIsAttested(spender)) {
    VT.risk(t, RISK.SPENDER_UNATTESTED);
    c.risk |= BIT.SPENDER_UNATTESTED;
  }
}

function addressField(t: Buf, label: string | Uint8Array, a: Address, role: number, c: Ctx) {
  const self = same(a, c.account);
  const hasCode = self ? true : hinted(c, a) !== 0n;
  const name = hexToBigInt(c.trust.nameOf(a));
  if (name !== 0n) c.effects.nameEq(a, c.trust.nameResolver(a), name);
  const at = VT.begin(t, NODE.FIELD_ADDRESS);
  VT.str(t, label);
  t.addr(a);
  t.u8(name === 0n ? 0 : 1);
  VT.strPacked(t, name);
  t.u8((hasCode ? 1 : 0) | (self ? 2 : 0));
  VT.end(t, at);
  if (role === ROLE_RECIPIENT && !self) {
    VT.risk(t, RISK.RECIPIENT_NOT_SELF);
    if (hasCode) VT.risk(t, RISK.RECIPIENT_HAS_CODE);
  }
}

function tokenBody(t: Buf, token: Address, raw: bigint, c: Ctx) {
  let symbol: bigint;
  let decimals: number;
  if (same(token, ZERO)) {
    symbol = PACKED_ETH;
    decimals = 18;
  } else {
    const info = c.trust.tokenInfo(token);
    if (!info.known) {
      symbol = PACKED_UNKNOWN;
      decimals = 0;
      c.risk |= BIT.UNVERIFIED;
    } else {
      symbol = hexToBigInt(info.symbol);
      decimals = info.decimals;
      if (info.flags & 3) c.risk |= BIT.TOKEN_UNSAFE;
    }
  }
  VT.strPacked(t, symbol);
  t.u8(decimals);
  t.word(raw);
}

function amountField(t: Buf, label: string | Uint8Array, token: Address, raw: bigint, c: Ctx) {
  const at = VT.begin(t, NODE.FIELD_AMOUNT);
  VT.str(t, label);
  t.addr(token);
  tokenBody(t, token, raw, c);
  VT.end(t, at);
}

/** The policy decision the paymaster will take, for wallets that want to warn early. */
export function policyRefuses(risk: number, allow = 0): boolean {
  const refused = BIT.UNVERIFIED | BIT.BLIND | BIT.UNLIMITED | BIT.SPENDER_UNATTESTED | BIT.TOKEN_UNSAFE | BIT.ALLOW_REVERT;
  if (risk & refused & ~allow) return true;
  return !!(risk & BIT.HOOK_TAKE) && !(allow & BIT.HOOK_TAKE) && !!(risk & (BIT.NO_MIN_OUT | BIT.HOOK_UNVERIFIED));
}

/** Packs a short ASCII string into the bytes32 form used for symbols and publisher names. */
export function packStr(s: string): Hex {
  if (s.length > 31) throw new Error("packed strings hold at most 31 bytes");
  const hex = bytesToHex(new TextEncoder().encode(s)).slice(2).padEnd(62, "0");
  return `0x${hex}${s.length.toString(16).padStart(2, "0")}` as Hex;
}


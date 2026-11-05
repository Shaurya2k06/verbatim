// TypeScript twin of contracts/src/uniswap/URRender.sol. Output must be byte-identical; see tools/difffuzz.
import { bytesToHex, hexToBigInt, keccak256, type Address, type Hex } from "viem";
import { BIT, Buf, Effects, RISK, RenderError, SPEC, UNIT, VT, NODE, rdAddr, rdBe, rdU8, rdWord, slice, toAddr, toInt } from "./vtree";

export * from "./vtree";

export const SEL_EXECUTE_DEADLINE = 0x3593564cn;
export const SEL_EXECUTE = 0x24856bc3n;

export const CMD = { FLAG_ALLOW_REVERT: 0x80, MASK: 0x7f, V3_SWAP_EXACT_IN: 0x00, SWEEP: 0x04, PAY_PORTION: 0x06, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 } as const;
export const ACTION = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;

const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const CONTRACT_BALANCE = 1n << 255n;
const BEFORE_SWAP_RETURNS_DELTA = 1n << 3n;
const AFTER_SWAP_RETURNS_DELTA = 1n << 2n;
const DYNAMIC_FEE = 0x800000n;

const hashRange = (d: Uint8Array, off: bigint | number, n: bigint | number): bigint => hexToBigInt(keccak256(slice(d, off, n)));
const fail = (code: string): never => {
  throw new RenderError(code);
};

export interface URCtx {
  account: Address;
  router: Address;
  permit2: Address;
  weth: Address;
  value: bigint;
  effects: Effects;
  risk: number;
  amount(t: Buf, label: string, token: Address, raw: bigint, c: URCtx): void;
  hookAttested(hook: Address, c: URCtx): boolean;
  addressField(t: Buf, label: string, a: Address, c: URCtx): void;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function renderUR(t: Buf, data: Uint8Array, c: URCtx) {
  if (data.length < 4) fail("MalformedUR");
  const sel = rdBe(data, 0, 4);
  const hasDeadline = sel === SEL_EXECUTE_DEADLINE;
  if (!hasDeadline && sel !== SEL_EXECUTE) {
    VT.blind(t, "router call", hexToBigInt(keccak256(data)), BigInt(data.length));
    c.risk |= BIT.BLIND;
    return;
  }
  const base = 4n;
  const cmdAt = base + rdWord(data, base);
  const nCmd = rdWord(data, cmdAt);
  const cmdOff = cmdAt + 32n;
  if (cmdOff + nCmd > BigInt(data.length)) fail("MalformedUR");
  const inputsPtr = base + rdWord(data, base + 32n);
  const nInputs = rdWord(data, inputsPtr);
  if (nInputs !== nCmd || nCmd > 16n) fail("MalformedUR");
  if (hasDeadline) VT.fieldUint(t, "Deadline", rdWord(data, base + 64n), UNIT.TIMESTAMP);

  for (let i = 0n; i < nCmd; i++) {
    const raw = rdU8(data, cmdOff + i);
    const elem = inputsPtr + 32n + rdWord(data, inputsPtr + 32n + i * 32n);
    const len = rdWord(data, elem);
    const inp = elem + 32n;
    if (inp + len > BigInt(data.length)) fail("MalformedUR");
    if (raw & CMD.FLAG_ALLOW_REVERT) VT.risk(t, RISK.UR_ALLOW_REVERT);
    command(t, data, raw & CMD.MASK, inp, len, c);
  }
}

function command(t: Buf, d: Uint8Array, cmd: number, inp: bigint, len: bigint, c: URCtx) {
  if (cmd === CMD.V4_SWAP) v4Swap(t, d, inp, len, c);
  else if (cmd === CMD.WRAP_ETH) wrap(t, d, inp, len, c);
  else if (cmd === CMD.UNWRAP_WETH) unwrap(t, d, inp, len, c);
  else if (cmd === CMD.SWEEP) sweep(t, d, inp, len, c);
  else if (cmd === CMD.PAY_PORTION) payPortion(t, d, inp, len, c);
  else if (cmd === CMD.V3_SWAP_EXACT_IN) v3Swap(t, d, inp, len, c);
  else {
    VT.groupBegin(t, "Unsupported command");
    VT.blind(t, "command input", hashRange(d, inp, len), len);
    VT.groupEnd(t);
    c.risk |= BIT.BLIND;
  }
}

function word(d: Uint8Array, inp: bigint, len: bigint, i: bigint): bigint {
  if ((i + 1n) * 32n > len) fail("MalformedUR");
  return rdWord(d, inp + i * 32n);
}

function addrArg(d: Uint8Array, inp: bigint, len: bigint, i: bigint): Address {
  const v = word(d, inp, len, i);
  if (v >> 160n !== 0n) fail("MalformedUR");
  return toAddr(v);
}

function recipient(t: Buf, r: Address, c: URCtx): Address {
  if (same(r, MSG_SENDER)) {
    c.addressField(t, "Recipient", c.account, c);
    return c.account;
  }
  if (same(r, ADDRESS_THIS)) {
    const at = VT.begin(t, NODE.FIELD_ENUM);
    VT.str(t, "Recipient");
    t.be(2, 2);
    VT.str(t, "ROUTER (transient)");
    VT.end(t, at);
    return c.router;
  }
  c.addressField(t, "Recipient", r, c);
  return r;
}

function v4Swap(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Uniswap v4 swap");
  if (word(d, inp, len, 0n) !== 0x40n) fail("MalformedUR");
  const nActions = word(d, inp, len, 2n);
  if (nActions % 3n !== 0n || nActions === 0n || nActions > 12n) fail("MalformedUR");
  const actions = inp + 96n;
  const paramsLenOff = ((nActions + 31n) & ~31n) + 0x60n;
  if (word(d, inp, len, 1n) !== paramsLenOff || paramsLenOff + 32n > len) fail("MalformedUR");
  const pArr = inp + paramsLenOff + 32n;
  if (rdWord(d, pArr - 32n) !== nActions) fail("MalformedUR");

  for (let i = 0n; i < nActions; i += 3n) {
    const known = rdU8(d, actions + i) === ACTION.SWAP_EXACT_IN_SINGLE && rdU8(d, actions + i + 1n) === ACTION.SETTLE_ALL && rdU8(d, actions + i + 2n) === ACTION.TAKE_ALL;
    if (!known) {
      VT.blind(t, "v4 actions", hashRange(d, inp, len), len);
      c.risk |= BIT.BLIND;
      VT.groupEnd(t);
      return;
    }
    v4Single(t, d, pArr, i, inp + len, c);
  }
  VT.groupEnd(t);
}

function param(d: Uint8Array, pArr: bigint, i: bigint, end: bigint): [bigint, bigint] {
  const at = pArr + rdWord(d, pArr + i * 32n);
  const n = rdWord(d, at);
  const off = at + 32n;
  if (off + n > end) fail("MalformedUR");
  return [off, n];
}

function v4Single(t: Buf, d: Uint8Array, pArr: bigint, i: bigint, end: bigint, c: URCtx) {
  const [p, pn] = param(d, pArr, i, end);
  if (pn < 0x160n) fail("MalformedUR");
  const s = p + rdWord(d, p);
  const c0 = rdAddr(d, s);
  const c1 = rdAddr(d, s + 32n);
  const fee = rdWord(d, s + 64n);
  const spacing = rdWord(d, s + 96n);
  const hook = rdAddr(d, s + 128n);
  const z = rdWord(d, s + 160n);
  if (z > 1n) fail("MalformedUR");
  const amountIn = rdWord(d, s + 192n);
  const minOut = rdWord(d, s + 224n);
  const minHop = rdWord(d, s + 256n);
  const hd = s + rdWord(d, s + 288n);
  const hdLen = rdWord(d, hd);
  if (amountIn === 0n || amountIn >> 128n !== 0n || minOut >> 128n !== 0n) fail("MalformedUR");

  const [sp, sn] = param(d, pArr, i + 1n, end);
  const [tp, tn] = param(d, pArr, i + 2n, end);
  if (sn < 64n || tn < 64n) fail("MalformedUR");
  const tokenIn = z === 1n ? c0 : c1;
  const tokenOut = z === 1n ? c1 : c0;
  if (!same(rdAddr(d, sp), tokenIn) || !same(rdAddr(d, tp), tokenOut)) fail("MalformedUR");
  const maxIn = rdWord(d, sp + 32n);
  const takeMin = rdWord(d, tp + 32n);
  const min = takeMin > minOut ? takeMin : minOut;

  c.amount(t, "You pay", tokenIn, amountIn, c);
  c.amount(t, "Minimum received", tokenOut, min, c);
  c.amount(t, "Maximum paid", tokenIn, maxIn, c);
  VT.fieldUint(t, "Pool fee", fee, UNIT.NONE);
  VT.fieldUint(t, "Tick spacing", spacing, UNIT.NONE);
  VT.fieldUint(t, "Min hop price", minHop, UNIT.NONE);
  VT.fieldBytes(t, "Hook data", hashRange(d, hd + 32n, hdLen), hdLen);
  c.addressField(t, "Recipient", c.account, c);

  if (min === 0n) {
    VT.risk(t, RISK.NO_MIN_OUT);
    c.risk |= BIT.NO_MIN_OUT;
  }
  if (fee === DYNAMIC_FEE) VT.risk(t, RISK.HOOK_DYNAMIC_FEE);
  if (!same(hook, ZERO)) {
    const bits = BigInt(hook);
    if (bits & BEFORE_SWAP_RETURNS_DELTA) {
      VT.risk(t, RISK.HOOK_CAN_TAKE_INPUT);
      c.risk |= BIT.HOOK_TAKE;
    }
    if (bits & AFTER_SWAP_RETURNS_DELTA) {
      VT.risk(t, RISK.HOOK_CAN_TAKE_OUTPUT);
      c.risk |= BIT.HOOK_TAKE;
    }
    if (!c.hookAttested(hook, c)) {
      VT.risk(t, RISK.HOOK_UNVERIFIED);
      c.risk |= BIT.HOOK_UNVERIFIED;
    }
  }

  c.effects.addDelta(c.account, tokenIn, -toInt(amountIn), false);
  c.effects.addDelta(c.account, tokenOut, toInt(min), true);
  if (same(tokenIn, ZERO)) {
    if (c.value < amountIn) fail("UnsupportedETHFlow");
  } else {
    c.effects.p2AllowLe(c.permit2, tokenIn, c.router, SPEC.P2_RELATIVE, amountIn);
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

function wrap(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Wrap ETH");
  const r = addrArg(d, inp, len, 0n);
  const amount = word(d, inp, len, 1n);
  if (amount !== c.value || amount === CONTRACT_BALANCE) fail("UnsupportedETHFlow");
  c.amount(t, "Wrap", ZERO, amount, c);
  const to = recipient(t, r, c);
  if (!same(to, c.router)) {
    if (same(to, c.account)) c.effects.addDelta(to, c.weth, toInt(amount), false);
    else c.effects.addDelta(to, c.weth, toInt(amount), true);
  }
  VT.groupEnd(t);
}

function unwrap(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Unwrap WETH");
  const r = addrArg(d, inp, len, 0n);
  const min = word(d, inp, len, 1n);
  c.amount(t, "Minimum received", ZERO, min, c);
  const to = recipient(t, r, c);
  if (same(to, c.account)) c.effects.addDelta(to, ZERO, toInt(min), true);
  VT.groupEnd(t);
}

function sweep(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Sweep");
  const token = addrArg(d, inp, len, 0n);
  const r = addrArg(d, inp, len, 1n);
  const min = word(d, inp, len, 2n);
  c.amount(t, "Minimum swept", token, min, c);
  const to = recipient(t, r, c);
  if (!same(to, c.account)) VT.risk(t, RISK.SWEEP_TO_OTHER);
  c.effects.addDelta(to, token, toInt(min), true);
  VT.groupEnd(t);
}

function payPortion(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Pay portion");
  const token = addrArg(d, inp, len, 0n);
  const r = addrArg(d, inp, len, 1n);
  const bips = word(d, inp, len, 2n);
  c.amount(t, "Token", token, 0n, c);
  VT.fieldUint(t, "Portion", bips, UNIT.BIPS);
  const to = recipient(t, r, c);
  if (!same(to, c.account)) VT.risk(t, RISK.SWEEP_TO_OTHER);
  VT.groupEnd(t);
}

function v3Swap(t: Buf, d: Uint8Array, inp: bigint, len: bigint, c: URCtx) {
  VT.groupBegin(t, "Uniswap v3 swap");
  const r = addrArg(d, inp, len, 0n);
  const amountIn = word(d, inp, len, 1n);
  const minOut = word(d, inp, len, 2n);
  const payer = word(d, inp, len, 4n);
  if (payer > 1n || amountIn === 0n || amountIn === CONTRACT_BALANCE) fail("MalformedUR");
  const pathAt = inp + word(d, inp, len, 3n);
  const pathLen = rdWord(d, pathAt);
  const path = pathAt + 32n;
  if (pathLen < 43n || (pathLen - 20n) % 23n !== 0n || path + pathLen > inp + len) fail("MalformedUR");
  const tokenIn = toAddr(rdBe(d, path, 20));
  const tokenOut = toAddr(rdBe(d, path + pathLen - 20n, 20));
  c.amount(t, "You pay", tokenIn, amountIn, c);
  c.amount(t, "Minimum received", tokenOut, minOut, c);
  const hops = (pathLen - 20n) / 23n;
  for (let h = 0n; h < hops; h++) {
    const at = path + 20n + h * 23n;
    VT.fieldUint(t, "Hop fee", rdBe(d, at, 3), UNIT.NONE);
    c.amount(t, "Hop token", toAddr(rdBe(d, at + 3n, 20)), 0n, c);
  }
  const to = recipient(t, r, c);
  if (minOut === 0n) {
    VT.risk(t, RISK.NO_MIN_OUT);
    c.risk |= BIT.NO_MIN_OUT;
  }
  if (payer === 1n) {
    c.effects.addDelta(c.account, tokenIn, -toInt(amountIn), false);
    c.effects.p2AllowLe(c.permit2, tokenIn, c.router, SPEC.P2_RELATIVE, amountIn);
  }
  if (!same(to, c.router)) c.effects.addDelta(to, tokenOut, toInt(minOut), true);
  VT.groupEnd(t);
}

export { bytesToHex };
export type { Hex };

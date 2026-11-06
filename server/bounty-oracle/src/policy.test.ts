import { describe, expect, it } from "vitest";
import { check, type Policy } from "./policy";
import type { Hex } from "viem";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const USDC = "0x00000000000000000000000000000000000000b2";
const p: Policy = { account: ACCOUNT, chainId: 1337n, output: USDC, pricePerEth: 3000_000000n, maxIn: 10n ** 16n, minOutBps: 9800n, maxValidity: 240n };
const NOW = 1_800_000_000n;
const u8 = (n: number) => n.toString(16).padStart(2, "0");
const word = (v: bigint) => v.toString(16).padStart(64, "0");
const node = (t: number, hex: string) => u8(t) + (hex.length / 2).toString(16).padStart(4, "0") + hex;
const str = (s: string) => u8(s.length) + Buffer.from(s).toString("hex");
const TAIL = node(0x50, "09") + node(0x50, "0a") + node(0x50, "0b00") + node(0x50, "0c");
const head = (a = ACCOUNT.slice(2), chain = 1337n, exp = NOW + 100n) => "0x56540002" + chain.toString(16).padStart(16, "0") + a + exp.toString(16).padStart(16, "0") + "ab".repeat(32) + "00000001" + "03";
const call = (attest = 2) => node(0x01, "11".repeat(20) + "22".repeat(32) + "3593564c" + "44".repeat(32) + str("Swap") + str("Uniswap") + u8(attest));
const eth = (v: bigint) => node(0x16, word(v));
const min = (v: bigint, t = USDC.slice(2)) => node(0x11, str("Minimum received") + t + str("USDC") + "06" + word(v));
const END = node(0x02, "");
const tree = (body: string, h = head()) => (h + body + TAIL) as Hex;
const honest = () => call() + eth(10n ** 15n) + min(2_950_000n) + END;

describe("bounty oracle policy", () => {
  it("signs an in-policy swap", () => expect(check(tree(honest()), p, NOW)).toEqual({ ok: true }));
  it("refuses a minimum under the floor", () => expect(check(tree(call() + eth(10n ** 15n) + min(2_000_000n) + END), p, NOW)).toMatchObject({ ok: false }));
  it("refuses too much in", () => expect(check(tree(call() + eth(10n ** 17n) + min(295_000_000n) + END), p, NOW)).toMatchObject({ ok: false }));
  it("refuses another output token", () => expect(check(tree(call() + eth(10n ** 15n) + min(2_950_000n, "cc".repeat(20)) + END), p, NOW)).toMatchObject({ ok: false }));
  it("refuses an unattested call", () => expect(check(tree(call(0) + eth(10n ** 15n) + min(2_950_000n) + END), p, NOW)).toMatchObject({ ok: false }));
  it("refuses a hook that can take output", () => expect(check(tree(honest() + node(0x30, "0103")), p, NOW)).toMatchObject({ ok: false }));
  it("refuses blind data", () => expect(check(tree(honest() + node(0x31, str("x") + "00".repeat(32) + "00000001" + "ffff")), p, NOW)).toMatchObject({ ok: false }));
  it("refuses two calls", () => expect(check(tree(honest() + honest()), p, NOW)).toMatchObject({ ok: false }));
  it("refuses a long validity", () => expect(check(tree(honest(), head(undefined, 1337n, NOW + 10_000n)), p, NOW)).toMatchObject({ ok: false }));
  it("refuses an expired one", () => expect(check(tree(honest(), head(undefined, 1337n, NOW)), p, NOW)).toMatchObject({ ok: false }));
  it("refuses another account", () => expect(check(tree(honest(), head("dd".repeat(20))), p, NOW)).toMatchObject({ ok: false }));
  it("refuses another chain", () => expect(check(tree(honest(), head(undefined, 1n)), p, NOW)).toMatchObject({ ok: false }));
  it("refuses garbage", () => expect(check("0x1234", p, NOW)).toMatchObject({ ok: false }));
});

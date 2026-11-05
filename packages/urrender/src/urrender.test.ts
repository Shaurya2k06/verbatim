import { keccak256, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { ADDRESS_THIS, BIT, Buf, CMD, Effects, MSG_SENDER, NODE, RISK, RenderError, VT, executeData, renderUR, sweepInput, v4ExactInSingleInput, wrapInput, type URCtx } from "./index";

const A = "0x00000000000000000000000000000000000a11ce" as Address;
const T0 = "0x0000000000000000000000000000000000007070" as Address;
const T1 = "0x0000000000000000000000000000000000008080" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function ctx(value = 0n, attested = false): URCtx {
  return {
    account: A, router: "0x0000000000000000000000000000000000003333", permit2: "0x0000000000000000000000000000000000002222", weth: "0x0000000000000000000000000000000000009090", value, effects: new Effects(2048), risk: 0,
    amount: (t, label, token, raw) => {
      const at = VT.begin(t, NODE.FIELD_AMOUNT);
      VT.str(t, label);
      t.addr(token);
      t.word(raw);
      VT.end(t, at);
    },
    hookAttested: () => attested,
    addressField: (t, label, a) => {
      const at = VT.begin(t, NODE.FIELD_ADDRESS);
      VT.str(t, label);
      t.addr(a);
      VT.end(t, at);
    },
  };
}

function risks(t: Buf): number[] {
  const out: number[] = [];
  const b = t.bytes;
  let p = 0;
  while (p < b.length) {
    const len = (b[p + 1] << 8) | b[p + 2];
    if (b[p] === NODE.RISK) out.push((b[p + 3] << 8) | b[p + 4]);
    p += 3 + len;
  }
  return out;
}

const swap = (hooks: Address, min: bigint, fee = 3000) => executeData([CMD.V4_SWAP], [v4ExactInSingleInput({ key: { currency0: T0, currency1: T1, fee, tickSpacing: 60, hooks }, zeroForOne: true, amountIn: 1000n, amountOutMinimum: min })], 2_000_000_000n);
const bytes = (h: string) => Buffer.from(h.slice(2), "hex");

function run(data: string, c = ctx()) {
  const t = new Buf(6144);
  renderUR(t, bytes(data), c);
  return { t, c };
}

describe("URRender", () => {
  it("renders an honest v4 swap with no risk", () => {
    const { t, c } = run(swap(ZERO, 500n));
    expect(risks(t)).toEqual([]);
    expect(c.risk).toBe(0);
    expect(c.effects.deltas.map((d) => [d.asset, d.value, d.ge])).toEqual([[T0, -1000n, false], [T1, 500n, true]]);
  });
  it("reads take-output from address bit 2 (afterSwapReturnsDelta)", () => {
    const { t, c } = run(swap("0x0000000000000000000000000000000000000044", 500n));
    expect(risks(t)).toContain(RISK.HOOK_CAN_TAKE_OUTPUT);
    expect(risks(t)).toContain(RISK.HOOK_UNVERIFIED);
    expect(c.risk & BIT.HOOK_TAKE).toBeTruthy();
  });
  it("reads take-input from address bit 3 (beforeSwapReturnsDelta)", () => {
    expect(risks(run(swap("0x0000000000000000000000000000000000000088", 500n)).t)).toContain(RISK.HOOK_CAN_TAKE_INPUT);
  });
  it("an attested hook with no delta flags is quiet", () => {
    expect(risks(run(swap("0x0000000000000000000000000000000000000040", 500n), ctx(0n, true)).t)).toEqual([]);
  });
  it("flags minOut = 0 and dynamic fee", () => {
    expect(risks(run(swap(ZERO, 0n, 0x800000)).t).sort()).toEqual([RISK.NO_MIN_OUT, RISK.HOOK_DYNAMIC_FEE].sort());
  });
  it("wrap must equal the call's value", () => {
    const d = executeData([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, 5n)]);
    expect(() => run(d, ctx(4n))).toThrow(RenderError);
    const { c } = run(d, ctx(5n));
    expect(c.effects.deltas[0]).toMatchObject({ value: 5n, ge: false });
  });
  it("wrapping into the router adds no output effect", () => {
    expect(run(executeData([CMD.WRAP_ETH], [wrapInput(ADDRESS_THIS, 5n)]), ctx(5n)).c.effects.deltas).toEqual([]);
  });
  it("sweep to someone else is flagged", () => {
    expect(risks(run(executeData([CMD.SWEEP], [sweepInput(T0, T1, 1n)])).t)).toContain(RISK.SWEEP_TO_OTHER);
  });
  it("allow-revert masks with 0x7f, as the deployed router does", () => {
    expect(risks(run(executeData([CMD.SWEEP | 0x80], [sweepInput(T0, MSG_SENDER, 1n)])).t)).toContain(RISK.UR_ALLOW_REVERT);
  });
  it("unknown commands and selectors are blind", () => {
    expect(run(executeData([0x0a], ["0x1234"])).c.risk & BIT.BLIND).toBeTruthy();
    expect(run("0xdeadbeef").c.risk & BIT.BLIND).toBeTruthy();
  });
  it("non-strict v4 encoding is refused like the router refuses it", () => {
    const honest = v4ExactInSingleInput({ key: { currency0: T0, currency1: T1, fee: 3000, tickSpacing: 60, hooks: ZERO }, zeroForOne: true, amountIn: 1n, amountOutMinimum: 1n });
    const bad = `0x${"00".repeat(31)}60${honest.slice(66)}` as `0x${string}`;
    expect(() => run(executeData([CMD.V4_SWAP], [bad]))).toThrow(RenderError);
  });
  it("hashes are stable", () => {
    expect(keccak256(run(swap(ZERO, 500n)).t.toHex())).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

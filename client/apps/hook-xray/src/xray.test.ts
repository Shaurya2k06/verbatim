import { describe, expect, it } from "vitest";
import { parseInput, poolId, xray } from "./xray";

const SKIM = "0x5922EaBd0E54cAb41215937A531C71562e748044" as const; // the demo's mined hook: afterSwap and afterSwapReturnsDelta

describe("hook x-ray", () => {
  it("reads the demo hook's flags", () => {
    const x = xray(SKIM);
    expect(x.on).toEqual(["afterSwap", "afterSwapReturnsDelta"]);
    expect(x.risks).toEqual(["HOOK CAN TAKE YOUR OUTPUT"]);
  });
  it("sees a dynamic fee", () => expect(xray("0x0000000000000000000000000000000000000000", 0x800000).risks).toEqual(["POOL FEE CAN CHANGE"]));
  it("takes all three inputs", () => {
    expect(parseInput(SKIM).hook).toBe(SKIM);
    expect(parseInput(`0x${"ab".repeat(32)}`).id).toBeTruthy();
    expect(parseInput(`{"currency0":"0x0000000000000000000000000000000000000000","currency1":"0x0000000000000000000000000000000000000001","fee":3000,"tickSpacing":60,"hooks":"${SKIM}"}`).key?.fee).toBe(3000);
  });
  it("refuses junk", () => expect(() => parseInput("{}")).toThrow());
  it("computes a pool ID", () => expect(poolId({ currency0: "0x0000000000000000000000000000000000000000", currency1: "0x0000000000000000000000000000000000000001", fee: 3000, tickSpacing: 60, hooks: SKIM })).toMatch(/^0x[0-9a-f]{64}$/));
});

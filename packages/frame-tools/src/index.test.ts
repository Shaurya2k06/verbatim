import { describe, expect, it } from "vitest";
import { findOpcode, patchApprove, toBytes } from "./index";

// PUSH1 0xa1 POP, then the runtime's only real LOG1.
const runtime = "0x60a150a1";
const creation = `0x600000${runtime.slice(2)}` as const;

describe("patchApprove", () => {
  it("skips PUSH data when looking for LOG1", () => {
    expect(findOpcode(toBytes(runtime), 0xa1)).toEqual([3]);
  });
  it("flips exactly that byte, in creation and runtime", () => {
    const p = patchApprove(creation, runtime);
    expect(p.runtime).toBe("0x60a150aa");
    expect(p.creation).toBe("0x60000060a150aa");
  });
  it("refuses no LOG1", () => {
    expect(() => patchApprove("0x600050", "0x6000")).toThrow(/exactly one/);
  });
  it("refuses two", () => {
    expect(() => patchApprove("0xa1a1", "0xa1a1")).toThrow(/exactly one/);
  });
  it("refuses a runtime not found in the creation code", () => {
    expect(() => patchApprove("0x00", "0xa1")).toThrow(/not found/);
  });
});

import { describe, expect, it } from "vitest";
import { decodeTree, formatAmount, formatForDevice } from "./device";

const HEADER = "0x56540001" + "0000000000000539" + "00".repeat(19) + "01" + "00000000000003e8" + "0000000000000401" + "0000000000000000";

describe("device decoder", () => {
  it("formats amounts exactly, never rounded", () => {
    expect(formatAmount(1_500_000n, 6, "dUSDC")).toBe("1.5 dUSDC");
    expect(formatAmount(1n, 18, "ETH")).toBe("0.000000000000000001 ETH");
    expect(formatAmount(10n ** 18n, 18, "ETH")).toBe("1 ETH");
    expect(formatAmount(0n, 6, "X")).toBe("0 X");
    expect(formatAmount(7n, 0, "?")).toBe("7 ?");
  });
  it("decodes a bare header", () => {
    expect(decodeTree(HEADER as `0x${string}`).nodes).toEqual([]);
  });
  it("refuses bad magic", () => expect(() => decodeTree(("0x56540002" + HEADER.slice(10)) as `0x${string}`)).toThrow(/magic/));
  it("refuses unknown node types", () => expect(() => decodeTree((HEADER + "7f0000") as `0x${string}`)).toThrow(/unknown node/));
  it("refuses unknown risk codes", () => expect(() => decodeTree((HEADER + "300002" + "7777") as `0x${string}`)).toThrow(/risk/));
  it("refuses trailing bytes inside a node", () => expect(() => decodeTree((HEADER + "020001" + "00") as `0x${string}`)).toThrow(/trailing/));
  it("refuses truncation", () => expect(() => decodeTree((HEADER + "30") as `0x${string}`)).toThrow());
  it("refuses control characters in strings", () => expect(() => decodeTree((HEADER + "200002" + "010a") as `0x${string}`)).toThrow(/character/));
  it("refuses a backslash in strings", () => expect(() => decodeTree((HEADER + "200002" + "015c") as `0x${string}`)).toThrow(/character/));
  it("lifts risks to the top", () => {
    const t = decodeTree((HEADER + "410008" + "0000000000000401" + "300002" + "0101") as `0x${string}`);
    const lines = formatForDevice(t);
    expect(lines[0].risk).toBe(true);
    expect(lines[0].text).toContain("NO MINIMUM OUTPUT");
    expect(lines[1].text).toContain("Valid until");
  });
});

import { describe, expect, it } from "vitest";
import { decodeTree, formatAmount, formatForDevice, specOf } from "./device";

const HEADER = "0x56540002" + "0000000000000539" + "00".repeat(19) + "01" + "000000006b49d200" + "ab".repeat(32) + "00000001" + "02";

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
  it("refuses bad magic", () => expect(() => decodeTree(("0x56540001" + HEADER.slice(10)) as `0x${string}`)).toThrow(/magic/));
  it("refuses unknown node types", () => expect(() => decodeTree((HEADER + "7f0000") as `0x${string}`)).toThrow(/unknown node/));
  it("refuses unknown risk codes", () => expect(() => decodeTree((HEADER + "300002" + "7777") as `0x${string}`)).toThrow(/risk/));
  it("refuses trailing bytes inside a node", () => expect(() => decodeTree((HEADER + "020001" + "00") as `0x${string}`)).toThrow(/trailing/));
  it("refuses truncation", () => expect(() => decodeTree((HEADER + "30") as `0x${string}`)).toThrow());
  it("refuses control characters in strings", () => expect(() => decodeTree((HEADER + "200002" + "010a") as `0x${string}`)).toThrow(/character/));
  it("refuses a backslash in strings", () => expect(() => decodeTree((HEADER + "200002" + "015c") as `0x${string}`)).toThrow(/character/));
  const TAIL = "500001" + "09" + "500001" + "0a" + "500002" + "0b00" + "500001" + "0c";
  it("shows guarantees first, then risks, then the sentence", () => {
    const t = decodeTree((HEADER + "300002" + "0101" + TAIL) as `0x${string}`);
    const lines = formatForDevice(t);
    expect(lines.slice(0, 4).every((l) => l.guarantee)).toBe(true);
    expect(lines[0].text).toContain("tracked holding");
    expect(lines[3].text).toContain("No approval outlives");
    expect(lines[4].risk).toBe(true);
    expect(lines[4].text).toContain("NO MINIMUM OUTPUT");
    expect(lines.some((l) => l.text.includes("Valid until"))).toBe(true);
  });
  it("derives the spec from the guarantee section, byte for byte", () => {
    const t = decodeTree((HEADER + TAIL) as `0x${string}`);
    expect(specOf(t)).toBe("0x565300020004090a0b000c");
  });
  it("refuses a tree missing a required guarantee", () => {
    const t = decodeTree((HEADER + "500001" + "09") as `0x${string}`);
    expect(() => specOf(t)).toThrow(/required/);
  });
  it("refuses guarantees that are not last", () => {
    const t = decodeTree((HEADER + TAIL + "300002" + "0101") as `0x${string}`);
    expect(() => specOf(t)).toThrow(/last/);
  });
  it("refuses an unknown guarantee", () => expect(() => decodeTree((HEADER + "500001" + "7e") as `0x${string}`)).toThrow(/guarantee/));
  it("refuses an unknown path", () => expect(() => decodeTree((HEADER.slice(0, -2) + "07") as `0x${string}`)).toThrow(/path/));
});

describe("decoder fuzz", () => {
  // A strict decoder may refuse anything, but it must never accept garbage by accident or crash some other way.
  it("mutated trees either decode strictly or throw a decode error", () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const base = (HEADER + "200002" + "0141" + "210000" + "300002" + "0101" + "410008" + "000000006b49d200").slice(2);
    for (let i = 0; i < 5000; i++) {
      const bytes = base.match(/../g)!.slice();
      const flips = 1 + (next() % 4);
      for (let f = 0; f < flips; f++) bytes[next() % bytes.length] = (next() % 256).toString(16).padStart(2, "0");
      if (next() % 5 === 0) bytes.length = next() % bytes.length;
      const hex = `0x${bytes.join("")}` as `0x${string}`;
      try {
        const t = decodeTree(hex);
        // What decoded must display, and every string in it must be in the charset.
        for (const l of formatForDevice(t)) expect(l.text).toMatch(/^[\x20-\x7e]*$/);
      } catch (e) {
        expect((e as Error).message).toMatch(/^VTREE:|RangeError|Invalid/);
      }
    }
  });
  it("over-length strings refuse", () => expect(() => decodeTree((HEADER + "200032" + "31" + "41".repeat(49)) as `0x${string}`)).toThrow(/too long/));
  it("every risk code has display text", async () => {
    const { RISK } = await import("@verbatim/urrender");
    const { RISK_TEXT } = await import("./device");
    for (const code of Object.values(RISK)) expect(RISK_TEXT[code as number]).toBeTruthy();
  });
});

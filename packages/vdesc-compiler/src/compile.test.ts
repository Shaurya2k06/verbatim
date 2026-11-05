import { describe, expect, it } from "vitest";
import { compile, compileFile } from "./index";

const transfer = { signature: "transfer(address,uint256)", intent: "Send tokens", exactWords: 2, fields: [{ path: "0", label: "To", format: "address" as const, role: "recipient" as const }, { path: "1", label: "Amount", format: "tokenAmount" as const, token: { kind: "target" as const } }], effects: [{ kind: "OUT_EXACT" as const, token: { kind: "target" as const }, amount: "1", to: "0" }] };

describe("vdesc compiler", () => {
  it("matches the golden encoding", () => {
    const hex = (s: string) => Buffer.from(s, "ascii").toString("hex");
    const want = `0x56440001` + `0b${hex("Send tokens")}` + "02" + "02" + "0100" + "01" + `02${hex("To")}` + "01" + "0101" + "02" + `06${hex("Amount")}` + "00" + "01" + "01" + "00" + "0101" + "0100" + "0000";
    expect(compile(transfer).vdesc).toBe(want);
    expect(compile(transfer).selector).toBe("0xa9059cbb");
  });
  it("is deterministic and order-independent across enum keys", () => {
    const a = compile({ signature: "f(uint8)", intent: "F", fields: [{ path: "0", label: "M", format: "enum", enum: { "1": "B", "0": "A" } }] });
    const b = compile({ signature: "f(uint8)", intent: "F", fields: [{ path: "0", label: "M", format: "enum", enum: { "0": "A", "1": "B" } }] });
    expect(a.vdesc).toBe(b.vdesc);
  });
  it("refuses long or unsafe strings", () => {
    expect(() => compile({ ...transfer, intent: "x".repeat(49) })).toThrow(/bad descriptor string/);
    expect(() => compile({ ...transfer, intent: "back\\slash" })).toThrow(/bad descriptor string/);
    expect(() => compile({ ...transfer, intent: "line\nbreak" })).toThrow(/bad descriptor string/);
  });
  it("encodes pointer and inline paths differently", () => {
    const f = (path: string) => compile({ signature: "f()", intent: "F", fields: [{ path, label: "L", format: "uint" }] }).vdesc;
    expect(f("2>0")).toContain("028200");
    expect(f("2.0")).toContain("020200");
  });
  it("compiles the ERC-7730 file form, sorted by signature", () => {
    const out = compileFile({ metadata: { owner: "Me" }, display: { formats: { "b()": { intent: "B", "x-verbatim": { fields: [] } }, "a()": { intent: "A", "x-verbatim": { fields: [] } } } } });
    expect(out.map((o) => o.signature)).toEqual(["a()", "b()"]);
    expect(out[0].publisher).toBe("Me");
  });
});

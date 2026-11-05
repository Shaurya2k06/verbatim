import { describe, expect, it } from "vitest";
import { Mode, Scope, encodeTx, frame, newTx, sigHash, txHash } from "./index";
const s = "0x1111111111111111111111111111111111111111" as const;
const base = () => newTx({ chainId: 1337, sender: s, nonce: 1n, maxFeePerGas: 2n, signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0xaabb" }], frames: [frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION, execution: 1000n, data: "0x01" })] });
describe("frame tx codec", () => {
  it("prefixes the type byte", () => expect(encodeTx(base()).startsWith("0x06")).toBe(true));
  it("sig hash elides empty-msg signature bytes but not frame data", () => {
    const a = base();
    const b = { ...base(), signatures: [{ ...a.signatures[0], signature: "0xccdd" as const }] };
    expect(sigHash(a)).toBe(sigHash(b));
    expect(txHash(a)).not.toBe(txHash(b));
    const c = base();
    c.frames[0].data = "0x02";
    expect(sigHash(a)).not.toBe(sigHash(c));
  });
});

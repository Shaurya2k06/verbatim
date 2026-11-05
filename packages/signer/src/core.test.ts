import { hashTypedData, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { FrameCollector, decodeRequest, decodeResponse, encodeRequest, encodeResponse, review, toFrames, typedData } from "./core";

const ACCOUNT = "00".repeat(19) + "01";
const TREE = (`0x56540001` + "0000000000000539" + ACCOUNT + "000000006b49d200" + "410008" + "000000006b49d200" + "300002" + "0101") as Hex;
const NOW = 0x6b49d200 - 100;
const req = { tree: TREE, specHash: keccak256("0x01"), txCommit: keccak256("0x02") };

describe("signer core", () => {
  it("round-trips a request", () => expect(decodeRequest(encodeRequest(req))).toEqual(req));
  it("computes the tree hash itself", () => expect(review(req, NOW).treeHash).toBe(keccak256(TREE)));
  it("binds the header's chain and account into the digest", () => {
    const r = review(req, NOW);
    expect(r.decoded.chainId).toBe(1337n);
    expect(r.digest).toBe(hashTypedData(typedData(r.decoded, req, keccak256(TREE))));
  });
  it("changes the digest when the tree changes", () => {
    const other = (TREE.slice(0, -4) + "0103") as Hex;
    expect(review(req, NOW).digest).not.toBe(review({ ...req, tree: other }, NOW).digest);
  });
  it("shows the risk first", () => expect(review(req, NOW).lines[0]).toMatchObject({ risk: true, text: "! NO MINIMUM OUTPUT" }));
  it("refuses a tree with an unknown node", () => expect(() => review({ ...req, tree: (TREE + "7f0000") as Hex }, NOW)).toThrow(/unknown node/));
  it("A13: refuses a future-dated sentence by its own clock", () => expect(() => review(req, 0x6b49d200 - 601)).toThrow(/stay valid/));
  it("accepts the edge of the limit", () => expect(review(req, 0x6b49d200 - 600).treeHash).toBe(keccak256(TREE)));
  it("refuses an expired sentence", () => expect(() => review(req, 0x6b49d200)).toThrow(/expired/));
  it("refuses a garbled request", () => {
    expect(() => decodeRequest("hello")).toThrow();
    expect(() => decodeRequest("VBT1:AAAA")).toThrow();
  });
  it("reassembles animated frames in any order", () => {
    const payload = "x".repeat(1800);
    const frames = toFrames(payload);
    expect(frames.length).toBe(3);
    const c = new FrameCollector();
    expect(c.add(frames[2])).toBeNull();
    expect(c.add(frames[0])).toBeNull();
    expect(c.add(frames[1])).toBe(payload);
  });
  it("produces signatures that recover to the owner", async () => {
    const a = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const r = review(req, NOW);
    const sig = await a.signTypedData(typedData(r.decoded, req, r.treeHash) as never);
    const back = decodeResponse(encodeResponse(a.address, sig));
    expect(back.signer).toBe(a.address);
    const { recoverAddress } = await import("viem");
    expect(await recoverAddress({ hash: r.digest, signature: back.sig })).toBe(a.address);
  });
});

import { keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { descriptorsFromJson, emptyUpdate, encodeRefresh, ensRecordValue, sortSigs, tokenEntry, updateHash } from "./update";

const file = { metadata: { owner: "x.eth" }, display: { formats: { "ping()": { intent: "Ping", "x-verbatim": { exactWords: 0, fields: [] } } } } };

describe("attestor cli", () => {
  it("binds the chain and the paymaster", () => {
    const u = emptyUpdate(1n);
    const p = "0x0000000000000000000000000000000000000001";
    expect(updateHash(1n, p, u)).not.toBe(updateHash(2n, p, u));
    expect(updateHash(1n, p, u)).not.toBe(updateHash(1n, "0x0000000000000000000000000000000000000002", u));
  });
  it("binds the epoch", () => {
    const p = "0x0000000000000000000000000000000000000001";
    expect(updateHash(1n, p, emptyUpdate(1n))).not.toBe(updateHash(1n, p, emptyUpdate(2n)));
  });
  it("compiles descriptors with their publisher packed", () => {
    const [d] = descriptorsFromJson(file, keccak256(toHex("code")));
    expect(d.selector).toBe("0x5c36b186");
    expect(d.publisher.startsWith("0x782e657468")).toBe(true);
    expect(d.publisher.endsWith("05")).toBe(true);
  });
  it("lists every hash in the ENS record", () => {
    expect(ensRecordValue([file, file]).split(",").length).toBe(2);
  });
  it("packs token symbols to 11 bytes", () => expect(tokenEntry("0x0000000000000000000000000000000000000001", "dUSDC", 6).symbol.length).toBe(24));
  it("sorts attestors ascending", () => expect(sortSigs([{ address: "0x02" }, { address: "0x01" }])[0].address).toBe("0x01"));
  it("encodes calldata", () => expect(encodeRefresh(emptyUpdate(1n), []).startsWith("0x")).toBe(true));
});

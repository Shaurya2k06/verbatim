// Builds a TrustUpdate and its attestation hash. Mirrors contracts/src/trust/TrustStore.sol (TrustAdmin).
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { compileFile, descriptorHash } from "@verbatim/vdesc-compiler";
import { packStr } from "@verbatim/displayvm-ts";

export const TRUST_UPDATE_TUPLE = {
  type: "tuple",
  components: [
    { name: "epoch", type: "uint64" },
    { name: "descriptors", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "selector", type: "bytes4" }, { name: "vdesc", type: "bytes" }, { name: "publisher", type: "bytes32" }, { name: "descriptorHash", type: "bytes32" }, { name: "attestations", type: "tuple[]", components: [{ name: "time", type: "uint64" }, { name: "expirationTime", type: "uint64" }, { name: "salt", type: "bytes32" }, { name: "signature", type: "bytes" }] }] },
    { name: "revocations", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "selector", type: "bytes4" }] },
    { name: "tokens", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "symbol", type: "bytes11" }, { name: "symLen", type: "uint8" }, { name: "decimals", type: "uint8" }, { name: "flags", type: "uint8" }] },
    { name: "proxies", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "template", type: "tuple", components: [{ name: "upgrader", type: "address" }, { name: "logicCodehash", type: "bytes32" }, { name: "impl", type: "address" }, { name: "getter", type: "bytes4" }] }] },
    { name: "routers", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "legacy", type: "bool" }] },
    { name: "hooks", type: "bytes32[]" },
    { name: "spenders", type: "address[]" },
    { name: "names", type: "tuple[]", components: [{ name: "addr", type: "address" }, { name: "name", type: "bytes32" }, { name: "resolver", type: "address" }] },
  ],
} as const;

export const REFRESH_ABI = [{ type: "function", name: "refreshTrust", stateMutability: "nonpayable", inputs: [{ ...TRUST_UPDATE_TUPLE, name: "u" }, { name: "sigs", type: "bytes[]" }], outputs: [] }] as const;

export interface TrustUpdate {
  epoch: bigint;
  descriptors: { codehash: Hex; selector: Hex; vdesc: Hex; publisher: Hex; descriptorHash: Hex; attestations: Attestation8176[] }[];
  revocations: { codehash: Hex; selector: Hex }[];
  tokens: { token: Address; symbol: Hex; symLen: number; decimals: number; flags: number }[];
  proxies: { codehash: Hex; template: { upgrader: Address; logicCodehash: Hex; impl: Address; getter: Hex } }[];
  routers: { codehash: Hex; legacy: boolean }[];
  hooks: Hex[];
  spenders: Address[];
  names: { addr: Address; name: Hex; resolver: Address }[];
}

export interface Attestation8176 {
  time: bigint;
  expirationTime: bigint;
  salt: Hex;
  signature: Hex;
}

/** ERC-8176's canonical schema UID and offchain EIP-712 payload. */
export const SCHEMA_8176: Hex = "0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2";

export function attestationTypedData(hash: Hex, a: { time: bigint; expirationTime: bigint; salt: Hex }) {
  return {
    domain: { name: "EAS Attestation", version: "0.26", chainId: 1, verifyingContract: "0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587" as Address },
    types: { Attest: [{ name: "version", type: "uint16" }, { name: "schema", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "time", type: "uint64" }, { name: "expirationTime", type: "uint64" }, { name: "revocable", type: "bool" }, { name: "refUID", type: "bytes32" }, { name: "data", type: "bytes" }, { name: "salt", type: "bytes32" }] },
    primaryType: "Attest" as const,
    message: { version: 2, schema: SCHEMA_8176, recipient: "0x0000000000000000000000000000000000000000" as Address, time: a.time, expirationTime: a.expirationTime, revocable: true, refUID: `0x${"00".repeat(32)}` as Hex, data: encodeAbiParameters([{ type: "bytes32" }], [hash]), salt: a.salt },
  };
}

/** Attestations from these signers, in the ascending order the contract requires. */
export async function attest8176(hash: Hex, signers: { address: string; signTypedData: (t: never) => Promise<Hex> }[], now: bigint, ttl = 30n * 24n * 3600n): Promise<Attestation8176[]> {
  const out: Attestation8176[] = [];
  for (const s of sortSigs(signers)) {
    const a = { time: now, expirationTime: now + ttl, salt: keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [hash, s.address as Address])) };
    out.push({ ...a, signature: await s.signTypedData(attestationTypedData(hash, a) as never) });
  }
  return out;
}

export const emptyUpdate = (epoch: bigint): TrustUpdate => ({ epoch, descriptors: [], revocations: [], tokens: [], proxies: [], routers: [], hooks: [], spenders: [], names: [] });

export const updateHash = (chainId: bigint, paymaster: Address, u: TrustUpdate): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, TRUST_UPDATE_TUPLE], [chainId, paymaster, u as never]));

export const encodeRefresh = (u: TrustUpdate, sigs: Hex[]): Hex => encodeFunctionData({ abi: REFRESH_ABI, functionName: "refreshTrust", args: [u as never, sigs] });

export function descriptorsFromJson(json: any, codehash: Hex, publisherOverride?: string, attestations: Attestation8176[] = []): TrustUpdate["descriptors"] {
  const hash = descriptorHash(json);
  return compileFile(json).map((d) => ({ codehash, selector: d.selector, vdesc: d.vdesc, publisher: packStr(publisherOverride ?? d.publisher), descriptorHash: hash, attestations }));
}

/** What the ENS `clear-signing` text record lists: every descHash the publisher stands behind. */
export const ensRecordValue = (jsonFiles: any[]): string => jsonFiles.flatMap((j) => compileFile(j).map((d) => d.descHash)).join(",");

export const tokenEntry = (token: Address, symbol: string, decimals: number, flags = 0): TrustUpdate["tokens"][number] => ({
  token,
  symbol: `0x${Array.from(new TextEncoder().encode(symbol), (b) => b.toString(16).padStart(2, "0")).join("").padEnd(22, "0")}` as Hex,
  symLen: symbol.length,
  decimals,
  flags,
});

/** Attestors must appear strictly ascending by address. */
export const sortSigs = <T extends { address: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));

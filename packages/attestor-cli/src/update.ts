// Builds a TrustUpdate and its attestation hash. Mirrors contracts/src/trust/TrustStore.sol (TrustAdmin).
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { compileFile } from "@verbatim/vdesc-compiler";
import { packStr } from "@verbatim/displayvm-ts";

export const TRUST_UPDATE_TUPLE = {
  type: "tuple",
  components: [
    { name: "epoch", type: "uint64" },
    { name: "descriptors", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "selector", type: "bytes4" }, { name: "vdesc", type: "bytes" }, { name: "publisher", type: "bytes32" }] },
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
  descriptors: { codehash: Hex; selector: Hex; vdesc: Hex; publisher: Hex }[];
  revocations: { codehash: Hex; selector: Hex }[];
  tokens: { token: Address; symbol: Hex; symLen: number; decimals: number; flags: number }[];
  proxies: { codehash: Hex; template: { upgrader: Address; logicCodehash: Hex; impl: Address; getter: Hex } }[];
  routers: { codehash: Hex; legacy: boolean }[];
  hooks: Hex[];
  spenders: Address[];
  names: { addr: Address; name: Hex; resolver: Address }[];
}

export const emptyUpdate = (epoch: bigint): TrustUpdate => ({ epoch, descriptors: [], revocations: [], tokens: [], proxies: [], routers: [], hooks: [], spenders: [], names: [] });

export const updateHash = (chainId: bigint, paymaster: Address, u: TrustUpdate): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, TRUST_UPDATE_TUPLE], [chainId, paymaster, u as never]));

export const encodeRefresh = (u: TrustUpdate, sigs: Hex[]): Hex => encodeFunctionData({ abi: REFRESH_ABI, functionName: "refreshTrust", args: [u as never, sigs] });

export function descriptorsFromJson(json: any, codehash: Hex, publisherOverride?: string): TrustUpdate["descriptors"] {
  return compileFile(json).map((d) => ({ codehash, selector: d.selector, vdesc: d.vdesc, publisher: packStr(publisherOverride ?? d.publisher) }));
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

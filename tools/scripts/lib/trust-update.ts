import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileFile } from "@verbatim/vdesc-compiler";
import { packStr } from "@verbatim/displayvm-ts";
import { ROOT, key } from "./env";
import { send } from "./chain";

export const TRUST_UPDATE_TUPLE = {
  type: "tuple",
  components: [
    { name: "epoch", type: "uint64" },
    { name: "descriptors", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "selector", type: "bytes4" }, { name: "vdesc", type: "bytes" }, { name: "publisher", type: "bytes32" }] },
    { name: "revocations", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "selector", type: "bytes4" }] },
    { name: "tokens", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "symbol", type: "bytes11" }, { name: "symLen", type: "uint8" }, { name: "decimals", type: "uint8" }, { name: "flags", type: "uint8" }] },
    { name: "proxies", type: "tuple[]", components: [{ name: "codehash", type: "bytes32" }, { name: "template", type: "tuple", components: [{ name: "upgrader", type: "address" }, { name: "logicCodehash", type: "bytes32" }, { name: "impl", type: "address" }, { name: "getter", type: "bytes4" }] }] },
    { name: "routers", type: "bytes32[]" },
    { name: "hooks", type: "bytes32[]" },
    { name: "names", type: "tuple[]", components: [{ name: "addr", type: "address" }, { name: "name", type: "bytes32" }] },
  ],
} as const;

export const REFRESH_ABI = [
  { type: "function", name: "refreshTrust", stateMutability: "nonpayable", inputs: [{ ...TRUST_UPDATE_TUPLE, name: "u" }, { name: "sigs", type: "bytes[]" }], outputs: [] },
] as const;

export interface TrustUpdate {
  epoch: bigint;
  descriptors: { codehash: Hex; selector: Hex; vdesc: Hex; publisher: Hex }[];
  revocations: { codehash: Hex; selector: Hex }[];
  tokens: { token: Address; symbol: Hex; symLen: number; decimals: number; flags: number }[];
  proxies: { codehash: Hex; template: { upgrader: Address; logicCodehash: Hex; impl: Address; getter: Hex } }[];
  routers: Hex[];
  hooks: Hex[];
  names: { addr: Address; name: Hex }[];
}

export const emptyUpdate = (epoch: bigint): TrustUpdate => ({ epoch, descriptors: [], revocations: [], tokens: [], proxies: [], routers: [], hooks: [], names: [] });

/** keccak256(abi.encode(chainid, address(this), u)), as TrustAdmin computes it. */
export const updateHash = (chainId: bigint, paymaster: Address, u: TrustUpdate): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, TRUST_UPDATE_TUPLE], [chainId, paymaster, u as never]));

/** A descriptor file, with `$NAME` placeholders resolved, for one contract's code hash. */
export function descriptorsFor(file: string, codehash: Hex, vars: Record<string, string> = {}): TrustUpdate["descriptors"] {
  let text = readFileSync(resolve(ROOT, "descriptors", file), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`$${k}`, v);
  return compileFile(JSON.parse(text)).map((d) => ({ codehash, selector: d.selector, vdesc: d.vdesc, publisher: packStr(d.publisher) }));
}

export const tokenEntry = (token: Address, symbol: string, decimals: number, flags = 0): TrustUpdate["tokens"][number] => ({
  token,
  symbol: `0x${Buffer.from(symbol, "ascii").toString("hex").padEnd(22, "0")}` as Hex,
  symLen: symbol.length,
  decimals,
  flags,
});

/** Collects 2 of 3 attestor signatures and submits `refreshTrust`. */
export async function attest(paymaster: Address, u: TrustUpdate, chainId = 1337n) {
  const h = updateHash(chainId, paymaster, u);
  const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => privateKeyToAccount(key(k)));
  const sorted = signers.sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1)).slice(0, 2);
  const sigs = await Promise.all(sorted.map((x) => x.sign({ hash: h })));
  return send(key("DEPLOYER_KEY"), paymaster, encodeFunctionData({ abi: REFRESH_ABI, functionName: "refreshTrust", args: [u as never, sigs] }), 0n, 25_000_000n);
}

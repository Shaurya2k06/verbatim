// What a v4 hook can do, read from its address alone. Bits as in Uniswap/v4-core@bea7f6d, src/libraries/Hooks.sol.
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export const FLAGS: [string, number, string][] = [
  ["beforeInitialize", 13, ""],
  ["afterInitialize", 12, ""],
  ["beforeAddLiquidity", 11, ""],
  ["afterAddLiquidity", 10, ""],
  ["beforeRemoveLiquidity", 9, ""],
  ["afterRemoveLiquidity", 8, ""],
  ["beforeSwap", 7, ""],
  ["afterSwap", 6, ""],
  ["beforeDonate", 5, ""],
  ["afterDonate", 4, ""],
  ["beforeSwapReturnsDelta", 3, "HOOK CAN TAKE YOUR INPUT"],
  ["afterSwapReturnsDelta", 2, "HOOK CAN TAKE YOUR OUTPUT"],
  ["afterAddLiquidityReturnsDelta", 1, "Can change what a liquidity provider pays in"],
  ["afterRemoveLiquidityReturnsDelta", 0, "Can change what a liquidity provider gets out"],
];

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export const poolId = (k: PoolKey): Hex => keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

export const DYNAMIC_FEE = 0x800000;

export interface Xray {
  hook: Address;
  on: string[];
  risks: string[];
}

export function xray(hook: Address, fee?: number): Xray {
  const bits = BigInt(hook) & 0x3fffn;
  const on = FLAGS.filter(([, b]) => (bits >> BigInt(b)) & 1n).map(([n]) => n);
  const risks = FLAGS.filter(([, b, r]) => r && (bits >> BigInt(b)) & 1n).map(([, , r]) => r);
  if (fee === DYNAMIC_FEE) risks.push("POOL FEE CAN CHANGE");
  return { hook, on, risks };
}

/** Accepts a PoolKey as JSON or a bare hook address. */
export function parseInput(text: string): { key?: PoolKey; hook?: Address; id?: Hex } {
  const t = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return { hook: t as Address };
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return { id: t as Hex };
  const k = JSON.parse(t);
  if (!k.hooks || k.fee === undefined) throw new Error("A PoolKey needs currency0, currency1, fee, tickSpacing and hooks");
  return { key: k };
}

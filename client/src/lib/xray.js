// What a v4 hook can do, read from its address alone. Ported from apps/hook-xray. Bits as in Uniswap/v4-core@bea7f6d, Hooks.sol.
import { encodeAbiParameters, keccak256 } from "viem";

export const FLAGS = [
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
  ["afterAddLiquidityReturnsDelta", 1, ""],
  ["afterRemoveLiquidityReturnsDelta", 0, ""],
];

export const DYNAMIC_FEE = 0x800000;

export const poolId = (k) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

export function xray(hook, fee) {
  const bits = BigInt(hook) & 0x3fffn;
  const on = FLAGS.filter(([, b]) => (bits >> BigInt(b)) & 1n).map(([n]) => n);
  const risks = FLAGS.filter(([, b, r]) => r && (bits >> BigInt(b)) & 1n).map(([, , r]) => r);
  if (fee === DYNAMIC_FEE) risks.push("POOL FEE CAN CHANGE");
  return { hook, on, risks };
}

/** A PoolKey as JSON, a pool ID, or a bare hook address. */
export function parseInput(text) {
  const t = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return { hook: t };
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return { id: t.toLowerCase() };
  const k = JSON.parse(t);
  if (!k.hooks || k.fee === undefined) throw new Error("A PoolKey needs currency0, currency1, fee, tickSpacing and hooks");
  return { key: k };
}

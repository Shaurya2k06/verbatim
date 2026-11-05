// Calldata builders, for wallets and tests. Layouts checked against Uniswap/universal-router and v4-periphery main.
import { encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, type Address, type Hex } from "viem";
import { ACTION, CMD } from "./index";

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable", "function execute(bytes commands, bytes[] inputs) payable"]);

const POOL_KEY = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;

export function v4ExactInSingleInput(a: { key: PoolKey; zeroForOne: boolean; amountIn: bigint; amountOutMinimum: bigint; minHopPriceX36?: bigint; hookData?: Hex; settleMax?: bigint; takeMin?: bigint }): Hex {
  const tokenIn = a.zeroForOne ? a.key.currency0 : a.key.currency1;
  const tokenOut = a.zeroForOne ? a.key.currency1 : a.key.currency0;
  const swap = encodeAbiParameters(
    [{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] }],
    [{ poolKey: a.key, zeroForOne: a.zeroForOne, amountIn: a.amountIn, amountOutMinimum: a.amountOutMinimum, minHopPriceX36: a.minHopPriceX36 ?? 0n, hookData: a.hookData ?? "0x" }],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenIn, a.settleMax ?? a.amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenOut, a.takeMin ?? a.amountOutMinimum]);
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8", "uint8"], [ACTION.SWAP_EXACT_IN_SINGLE, ACTION.SETTLE_ALL, ACTION.TAKE_ALL]), [swap, settle, take]]);
}

export const executeData = (commands: number[], inputs: Hex[], deadline?: bigint): Hex =>
  deadline === undefined
    ? encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [`0x${commands.map((c) => c.toString(16).padStart(2, "0")).join("")}`, inputs] })
    : encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [`0x${commands.map((c) => c.toString(16).padStart(2, "0")).join("")}`, inputs, deadline] });

export const v4SwapCall = (a: Parameters<typeof v4ExactInSingleInput>[0], deadline: bigint): Hex => executeData([CMD.V4_SWAP], [v4ExactInSingleInput(a)], deadline);

export const wrapInput = (recipient: Address, amount: bigint): Hex => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [recipient, amount]);

export const sweepInput = (token: Address, recipient: Address, min: bigint): Hex => encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, recipient, min]);

export const payPortionInput = sweepInput;

export const v3Input = (a: { recipient: Address; amountIn: bigint; amountOutMin: bigint; path: Hex; payerIsUser: boolean }): Hex =>
  encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }, { type: "uint256[]" }], [a.recipient, a.amountIn, a.amountOutMin, a.path, a.payerIsUser, []]);

export const MSG_SENDER: Address = "0x0000000000000000000000000000000000000001";
export const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";

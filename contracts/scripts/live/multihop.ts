// A real two-hop v4 swap through the account, on Sepolia: ETH -> dUSDC -> dWETH on the official router, sentence signed, minimum from Uniswap's own quoter.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAbi, parseEther, type Address, type Hex } from "viem";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import type { PublishedSnapshot } from "@verbatim/snapshot-cli";
import { CMD, executeData, v4ExactInInput } from "@verbatim/urrender";
import { ROOT, loadEnv } from "./lib/env";
import { record } from "./lib/proofs";
import { UNI, pub, readS } from "./lib/sepolia";
import { buildOp, sendOp, validationRevert, waitOp } from "./lib/userop";

const env = loadEnv();
const s = readS();
const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/snapshot-sepolia.json"), "utf8"));
const account: Address = s.account4337;
const ETH: Address = "0x0000000000000000000000000000000000000000";
const IN = parseEther("0.001");
const QUOTER: Address = "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227"; // Uniswap/docs, v4 deployments, Sepolia
const ZERO_HOOKS = ETH;
const path = [
  { currency: s.tokenA as Address, fee: s.poolEth.key.fee, tickSpacing: s.poolEth.key.tickSpacing, hooks: s.poolEth.key.hooks as Address },
  { currency: s.tokenB as Address, fee: s.pool.key.fee, tickSpacing: s.pool.key.tickSpacing, hooks: s.pool.key.hooks as Address },
];
const QUOTER_ABI = parseAbi([
  "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
  "struct QuoteExactParams { address exactCurrency; PathKey[] path; uint128 exactAmount; }",
  "function quoteExactInput(QuoteExactParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const { result } = await pub.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInput", args: [{ exactCurrency: ETH, path: path.map((h) => ({ intermediateCurrency: h.currency, fee: h.fee, tickSpacing: h.tickSpacing, hooks: ZERO_HOOKS, hookData: "0x" as Hex })), exactAmount: IN }] });
const quoted = result[0];
const min = (quoted * 95n) / 100n;
console.log("quoted", quoted, "minimum", min);

const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const data = executeData([CMD.V4_SWAP], [v4ExactInInput({ currencyIn: ETH, path, amountIn: IN, amountOutMinimum: min, legacyParams: true })], deadline);
const b = await buildOp(account, [{ target: UNI.router, value: IN, data }], env.BUNDLER_URL, snap);
const lines = formatForDevice(decodeTree(b.tree)).map((l) => l.text);
lines.forEach((l) => console.log(" ", l));
const refusal = await validationRevert(b);
if (refusal) console.log("validation refuses:", refusal.slice(0, 80));

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const bal = () => pub.readContract({ address: s.tokenB, abi: ERC20, functionName: "balanceOf", args: [account] });
const before = await bal();
const h = await sendOp(env.BUNDLER_URL, b.op);
const r = await waitOp(env.BUNDLER_URL, h);
const got = (await bal()) - before;
const pass = r.success === true && got >= min && lines.some((l) => l.startsWith("Through"));
record({ id: "B-multihop", title: "A two-hop v4 swap through the account", expected: "the sentence names the route, the swap lands, the output meets the signed minimum", pass, outcome: "mined", txHash: r.receipt.transactionHash, message: `received ${got}, minimum ${min}, 2 hops`, extra: { actualGasUsed: BigInt(r.actualGasUsed).toString(), txGasUsed: BigInt(r.receipt.gasUsed).toString(), sentence: lines } });
console.log("actualGasUsed", BigInt(r.actualGasUsed), "tx gasUsed", BigInt(r.receipt.gasUsed));

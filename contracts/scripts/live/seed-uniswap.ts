// Demo pools on the devnet's real PoolManager: honest (hooks = 0) and evil (SkimHook). Liquidity through the real PositionManager.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { addr, key, readState, writeState } from "./lib/env";
import { artifact, pub, send } from "./lib/chain";
import { CREATE2_DEPLOYER, mineSalt } from "./lib/hookminer";
import { attest, emptyUpdate } from "./lib/trust-update";

const POOL_MANAGER: Address = "0x6bF9Aa9c04fd001385742d61f6818C3236429848";
const POSM: Address = "0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const deployer = key("DEPLOYER_KEY");
const me = addr("DEPLOYER_KEY");
let s = readState();

const ERC20 = artifact("TestTokens.sol", "TestToken").abi;
const PM_ABI = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "function initialize(PoolKey key, uint160 sqrtPriceX96) returns (int24)"]);
const P2_ABI = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const POSM_ABI = parseAbi(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]);

const [c0, c1] = BigInt(s.tokenA) < BigInt(s.tokenB) ? [s.tokenA as Address, s.tokenB as Address] : [s.tokenB as Address, s.tokenA as Address];
const usdcIs0 = c0.toLowerCase() === s.tokenA.toLowerCase();
// 1 dWETH (18 dec) = 3000 dUSDC (6 dec).
const price = usdcIs0 ? 1e18 / 3000e6 : 3000e6 / 1e18;
const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(price) * 2 ** 48)) * 2n ** 48n;
const tick = Math.floor(Math.log(price) / Math.log(1.0001));
const tickLower = Math.floor((tick - 6000) / 60) * 60;
const tickUpper = Math.floor((tick + 6000) / 60) * 60;

if (!s.skimHook) {
  const hook = artifact("SkimHook.sol", "SkimHook");
  const flags = (1n << 6n) | (1n << 2n);
  const { salt, address, initCode } = mineSalt(flags, hook.creation, [{ type: "address" }, { type: "address" }], [POOL_MANAGER, addr("ATTACKER_KEY")]);
  console.log("mined SkimHook", address, "salt", salt);
  const code = await pub.getCode({ address });
  if (!code || code === "0x") await send(deployer, CREATE2_DEPLOYER, concat([salt, initCode]), 0n, 8_000_000n);
  writeState({ skimHook: address });
  s = readState();
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const honestKey = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: ZERO };
const evilKey = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: s.skimHook as Address };

const POOL_KEY_TYPES = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;

if (!s.liquiditySetup) {
  for (const t of [s.tokenA, s.tokenB] as Address[]) {
    await send(deployer, t, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [me, parseEther("100000000")] }));
    await send(deployer, t, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, (1n << 256n) - 1n] }));
    await send(deployer, PERMIT2, encodeFunctionData({ abi: P2_ABI, functionName: "approve", args: [t, POSM, (1n << 160n) - 1n, 2 ** 47] }), 0n, 1_000_000n);
  }
  writeState({ liquiditySetup: true });
}

for (const [name, k] of [["poolHonest", honestKey], ["poolEvil", evilKey]] as const) {
  if (readState()[name]) continue;
  const init = await send(deployer, POOL_MANAGER, encodeFunctionData({ abi: PM_ABI, functionName: "initialize", args: [k, sqrtPriceX96] }), 0n, 3_000_000n);
  console.log(name, "initialized", init.transactionHash);
  const mint = encodeAbiParameters(
    [POOL_KEY_TYPES, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
    [k, tickLower, tickUpper, 1_000_000_000_000_000n, (1n << 127n), (1n << 127n), me, "0x"],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [c0, c1]);
  const unlock = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8"], [0x02, 0x0d]), [mint, settle]]);
  const r = await send(deployer, POSM, encodeFunctionData({ abi: POSM_ABI, functionName: "modifyLiquidities", args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] }), 0n, 20_000_000n);
  console.log(name, "liquidity", r.transactionHash, "gas", r.gasUsed);
  writeState({ [name]: { key: k, init: init.transactionHash, liquidity: r.transactionHash } });
}
// Native-ETH pools: a swap from ETH needs no approval, so it fits one call under D9 (no approval outlives a batch).
const ethPrice = 3000e6 / 1e18; // token1 per token0
const ethSqrt = BigInt(Math.floor(Math.sqrt(ethPrice) * 2 ** 48)) * 2n ** 48n;
const ethTick = Math.floor(Math.log(ethPrice) / Math.log(1.0001));
const ethLower = Math.floor((ethTick - 6000) / 60) * 60;
const ethUpper = Math.floor((ethTick + 6000) / 60) * 60;
const ethSeed = parseEther("0.06");
for (const [name, hooks] of [["poolEthHonest", ZERO], ["poolEthEvil", readState().skimHook as Address]] as const) {
  if (readState()[name]) continue;
  const k = { currency0: ZERO, currency1: s.tokenA as Address, fee: 3000, tickSpacing: 60, hooks };
  const init = await send(deployer, POOL_MANAGER, encodeFunctionData({ abi: PM_ABI, functionName: "initialize", args: [k, ethSqrt] }), 0n, 3_000_000n);
  const mint = encodeAbiParameters(
    [POOL_KEY_TYPES, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
    [k, ethLower, ethUpper, 5_000_000_000_000n, ethSeed, 1n << 127n, me, "0x"],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ZERO, s.tokenA as Address]);
  const sweep = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ZERO, me]);
  const unlock = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8", "uint8"], [0x02, 0x0d, 0x14]), [mint, settle, sweep]]);
  const r = await send(deployer, POSM, encodeFunctionData({ abi: POSM_ABI, functionName: "modifyLiquidities", args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] }), ethSeed, 5_000_000n);
  console.log(name, "liquidity", r.transactionHash, r.status);
  writeState({ [name]: { key: k, init: init.transactionHash, liquidity: r.transactionHash } });
}
void keccak256; void attest; void emptyUpdate;
console.log("pools ready", { c0, c1, tickLower, tickUpper, skim: readState().skimHook });

// Demo pools drift: every demo swap sells dWETH into them, and eventually an honest "at least 2000" correctly fails.
// Buys dWETH back until the price is near 3000 again, then adds depth. Usage: tsx rebalance-pool.ts [devnet|sepolia]
import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { CMD, v4SwapCall } from "@verbatim/urrender";
import { addr, key, readState } from "./lib/env";
import { pub as devPub, send } from "./lib/chain";
import { UNI, me as sepMe, pub as sepPub, readS, wallet as sepWallet } from "./lib/sepolia";

const leg = process.argv[2] ?? "devnet";
const DEV = leg === "devnet";
const st = DEV ? readState() : readS();
const pub = (DEV ? devPub : sepPub) as typeof devPub;
const me: Address = DEV ? addr("DEPLOYER_KEY") : sepMe;
const dUSDC = st.tokenA as Address;
const dWETH = st.tokenB as Address;
const poolKey = DEV ? st.poolHonest.key : st.pool.key;
const ROUTER: Address = DEV ? "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be" : UNI.router;
const POSM: Address = DEV ? "0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B" : UNI.positionManager;
const PERMIT2: Address = UNI.permit2;
const POOL_MANAGER: Address = DEV ? "0x6bF9Aa9c04fd001385742d61f6818C3236429848" : UNI.poolManager;

async function tx(to: Address, data: Hex, gas = 3_000_000n) {
  if (DEV) return send(key("DEPLOYER_KEY"), to, data, 0n, gas);
  const w = sepWallet();
  const hash = await w.sendTransaction({ to, data, gas, account: w.account!, chain: w.chain });
  const r = await sepPub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return r;
}

const ERC20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const poolId = keccak256(encodeAbiParameters([KEY_T], [poolKey]));

// PoolManager.extsload: Slot0 is the first word of pools[poolId] (v4-core StateLibrary), at mapping slot 6.
const poolsSlot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, 6n]));
async function tick(): Promise<number> {
  const word = await pub.readContract({ address: POOL_MANAGER, abi: parseAbi(["function extsload(bytes32) view returns (bytes32)"]), functionName: "extsload", args: [poolsSlot] });
  const raw = (BigInt(word) >> 160n) & 0xffffffn;
  return Number(raw >= 1n << 23n ? raw - (1n << 24n) : raw);
}

const usdcIs0 = poolKey.currency0.toLowerCase() === dUSDC.toLowerCase();
const target = Math.floor(Math.log(usdcIs0 ? 1e18 / 3000e6 : 3000e6 / 1e18) / Math.log(1.0001));
const priceAt = (t: number) => (usdcIs0 ? 1e12 / 1.0001 ** t : 1.0001 ** t * 1e12);

let now = await tick();
console.log(`${leg}: tick ${now}, target ${target}, about ${Math.round(priceAt(now))} dUSDC per dWETH`);

// Set up the operator's approvals, once.
for (const t of [dUSDC, dWETH]) {
  await tx(t, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [me, parseEther("100000000")] }));
  await tx(t, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, (1n << 256n) - 1n] }));
  await tx(PERMIT2, encodeFunctionData({ abi: P2, functionName: "approve", args: [t, POSM, (1n << 160n) - 1n, 2 ** 47] }));
}
await tx(PERMIT2, encodeFunctionData({ abi: P2, functionName: "approve", args: [dUSDC, ROUTER, (1n << 160n) - 1n, 2 ** 47] }));

// Buy dWETH with dUSDC until the price is back.
const buyDirection = usdcIs0;
for (let i = 0; i < 40 && priceAt(now) < 2950; i++) {
  const data = v4SwapCall({ key: poolKey, zeroForOne: buyDirection, amountIn: 1_000_000_000n, amountOutMinimum: 0n, legacyParams: !DEV }, BigInt(Math.floor(Date.now() / 1000) + 3600));
  await tx(ROUTER, data, 2_000_000n);
  now = await tick();
  console.log(`  bought with 1000 dUSDC: tick ${now}, about ${Math.round(priceAt(now))}`);
}

// Twenty times the depth, so a demo's worth of swaps barely moves it.
const tickLower = Math.floor((target - 6000) / 60) * 60;
const tickUpper = Math.floor((target + 6000) / 60) * 60;
const mint = encodeAbiParameters([KEY_T, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }], [poolKey, tickLower, tickUpper, 20_000_000_000_000_000n, 1n << 127n, 1n << 127n, me, "0x"]);
const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [poolKey.currency0, poolKey.currency1]);
const unlock = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8"], [0x02, 0x0d]), [mint, settle]]);
const r = await tx(POSM, encodeFunctionData({ abi: parseAbi(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]), functionName: "modifyLiquidities", args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] }), DEV ? 20_000_000n : 15_000_000n);
now = await tick();
console.log(`${leg}: added depth ${r.transactionHash}, now about ${Math.round(priceAt(now))} dUSDC per dWETH`);
void CMD;

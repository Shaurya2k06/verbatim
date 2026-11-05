// Deploys the production leg on Sepolia: VerbatimAccount4337 with stateless semantics, against the official Uniswap contracts,
// with ENSv2 as the trust root (§13). Idempotent through .state/sepolia.json. `tsx legb-ens.ts verbatim-anchor --anchor` first.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeAbiParameters, encodeDeployData, encodePacked, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { packedUniswap } from "@verbatim/client";
import { packStr } from "@verbatim/displayvm-ts";
import { ROOT, addr, key } from "./lib/env";
import { artifact } from "./lib/chain";
import { ENS, ENTRY_POINT, RESOLVER_ABI, UNI, WETH_SEPOLIA, dnsName, me, namedKey, pub, readS, tx, wallet, writeS } from "./lib/sepolia";
import { descriptorsFor, emptyUpdate, publishSnapshot, tokenEntry, type TrustUpdate } from "./lib/trust-update";

const PUBLISHER = "verbatim-demo";
const ANCHOR = "verbatim-anchor";
const NAME = `${PUBLISHER}.eth`;

async function deploy(file: string, name: string, args: unknown[] = []) {
  const a = artifact(file, name);
  const data = args.length ? encodeDeployData({ abi: a.abi, bytecode: a.creation, args: args as never }) : a.creation;
  const w = wallet();
  const hash = await w.sendTransaction({ data, account: w.account!, chain: w.chain, gas: 50_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy of ${name} failed: ${hash}`);
  console.log(name, r.contractAddress, hash, "gas", r.gasUsed);
  return { address: r.contractAddress, hash };
}

const s = () => readS();
const pub_ = () => s()[PUBLISHER];
const anc = () => s()[ANCHOR];
if (!anc()?.locked) throw new Error(`run: tsx legb-ens.ts ${ANCHOR} --anchor`);
const council = privateKeyToAccount(namedKey("ens-council")).address;
const owners = ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map(addr);
const attestors = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr);
const chOf = async (a: Address) => keccak256((await pub.getCode({ address: a })) as Hex);

if (!s().checker) {
  const c = await deploy("EnsTrustChecker.sol", "EnsTrustChecker", [ENS.root, ENS.ethRegistry, ENS.universalResolver, await chOf(pub_().resolver), council, 365n * 24n * 3600n]);
  writeS({ checker: c.address, checkerTx: c.hash });
}
if (!s().statelessRenderer) {
  const r = await deploy("StatelessRenderer.sol", "StatelessRenderer", [UNI.permit2, WETH_SEPOLIA, packedUniswap]);
  const g = await deploy("RevocationRegistry.sol", "RevocationRegistry", [attestors, 2]);
  writeS({ statelessRenderer: r.address, statelessRendererTx: r.hash, revocations: g.address, revocationsTx: g.hash });
}
if (!s().anchor) {
  const a = await deploy("EnsTrustAnchor.sol", "EnsTrustAnchor", [ENS.root, ENS.ethRegistry, await chOf(anc().resolver), council, s().checker, ANCHOR]);
  writeS({ anchor: a.address, anchorTx: a.hash });
}
if (!s().attestorsRecord) {
  const r = await tx({ address: anc().resolver, abi: RESOLVER_ABI, functionName: "setText", args: [dnsName(`${ANCHOR}.eth`), "attestors", attestors.map((a) => a.toLowerCase()).join(",")] }, namedKey("ens-council"));
  console.log("council set the attestor list", r.transactionHash);
  writeS({ attestorsRecord: r.transactionHash });
}
if (!s().account4337) {
  const a = await deploy("VerbatimAccount4337.sol", "VerbatimAccount4337", [ENTRY_POINT, s().statelessRenderer, s().revocations, s().anchor, UNI.permit2, owners, 2, attestors, 2]);
  writeS({ account4337: a.address, account4337Tx: a.hash });
}
const ERC20 = artifact("TestTokens.sol", "TestToken").abi;

// The attested snapshot. Same leaves on every path; only this leg carries ENS names.
const u: TrustUpdate = emptyUpdate(1n);
const tokenCode = await chOf(s().tokenA);
const p2Code = await chOf(UNI.permit2);
u.descriptors = [...(await descriptorsFor("erc20.json", tokenCode, {}, NAME)), ...(await descriptorsFor("permit2.json", p2Code, {}, NAME))];
u.tokens = [tokenEntry(s().tokenA, "dUSDC", 6), tokenEntry(s().tokenB, "dWETH", 18)];
u.routers = [{ codehash: await chOf(UNI.router), legacy: true }];
u.spenders = [UNI.permit2, UNI.router];
u.names = [{ addr: pub_().nameAddress, name: packStr(NAME), resolver: pub_().resolver }];
const snap = await publishSnapshot(u, 11155111n, 1);
writeFileSync(resolve(ROOT, "deployments/snapshot-sepolia.json"), JSON.stringify(snap, null, 1) + "\n");
console.log("snapshot", snap.root, "expires", new Date(Number(snap.expiry) * 1000).toISOString());

if (!s().funded4337) {
  const w = wallet();
  const hash = await w.sendTransaction({ to: s().account4337, value: parseEther("0.2"), account: w.account!, chain: w.chain });
  await pub.waitForTransactionReceipt({ hash });
  await tx({ address: s().tokenA, abi: ERC20, functionName: "mint", args: [s().account4337, 1_000_000_000_000n] });
  writeS({ funded4337: true });
}

// A native-ETH pool on the official PoolManager: a swap from ETH needs no approval, so nothing outlives the batch (D9).
const PM = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "function initialize(PoolKey key, uint160 sqrtPriceX96) returns (int24)"]);
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
if (!s().poolEth) {
  const usdc = s().tokenA as Address;
  await tx({ address: usdc, abi: ERC20, functionName: "mint", args: [me, parseEther("100000000")] });
  await tx({ address: usdc, abi: ERC20, functionName: "approve", args: [UNI.permit2, (1n << 256n) - 1n] });
  await tx({ address: UNI.permit2, abi: P2, functionName: "approve", args: [usdc, UNI.positionManager, (1n << 160n) - 1n, 2 ** 47] });
  const price = 3000e6 / 1e18;
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(price) * 2 ** 48)) * 2n ** 48n;
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  const tickLower = Math.floor((tick - 6000) / 60) * 60;
  const tickUpper = Math.floor((tick + 6000) / 60) * 60;
  const ZERO = "0x0000000000000000000000000000000000000000" as Address;
  const k = { currency0: ZERO, currency1: usdc, fee: 3000, tickSpacing: 60, hooks: ZERO };
  const init = await tx({ address: UNI.poolManager, abi: PM, functionName: "initialize", args: [k, sqrtPriceX96] });
  const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
  const value = parseEther("0.1");
  const mint = encodeAbiParameters([KEY_T, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }], [k, tickLower, tickUpper, 8_000_000_000_000n, value, 1n << 127n, me, "0x"]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ZERO, usdc]);
  const sweep = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ZERO, me]);
  const unlock = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8", "uint8"], [0x02, 0x0d, 0x14]), [mint, settle, sweep]]);
  const liq = await tx({ address: UNI.positionManager, abi: parseAbi(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]), functionName: "modifyLiquidities", args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)], value });
  console.log("ETH pool", init.transactionHash, "liquidity", liq.transactionHash);
  writeS({ poolEth: { key: k, init: init.transactionHash, liquidity: liq.transactionHash } });
}

const st = s();
writeFileSync(resolve(ROOT, "deployments/sepolia.json"), JSON.stringify({
  network: "sepolia", chainId: 11155111, entryPoint: ENTRY_POINT, account: st.account4337, statelessRenderer: st.statelessRenderer, revocations: st.revocations, ensTrustChecker: st.checker, ensTrustAnchor: st.anchor,
  tokens: { dUSDC: st.tokenA, dWETH: st.tokenB }, pools: { eth: st.poolEth, erc20: st.pool },
  uniswap: { router: UNI.router, poolManager: UNI.poolManager, positionManager: UNI.positionManager, permit2: UNI.permit2 },
  ens: { publisher: NAME, publisherResolver: pub_().resolver, anchor: `${ANCHOR}.eth`, anchorResolver: anc().resolver, attestorsRecordTx: st.attestorsRecord, lookalike: "verbatim-dem0.eth" },
}, null, 2) + "\n");
console.log(JSON.stringify({ account: st.account4337, anchor: st.anchor, renderer: st.statelessRenderer }, null, 1));
void addr; void key;

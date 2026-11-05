// Deploys Leg B against the official Uniswap contracts and Sepolia ENSv2, then attests through both gates.
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, encodePacked, getContractAddress, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { packedUniswap } from "@verbatim/client";
import { packStr } from "@verbatim/displayvm-ts";
import { compileFile } from "@verbatim/vdesc-compiler";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, addr, key } from "./lib/env";
import { artifact } from "./lib/chain";
import { ENS, ENTRY_POINT, KEY, RESOLVER_ABI, UNI, WETH_SEPOLIA, dnsName, me, namedKey, pub, readS, tx, wallet, writeS } from "./lib/sepolia";
import { attest, emptyUpdate, tokenEntry, type TrustUpdate } from "./lib/trust-update";

const LABEL = "verbatim-demo";
const NAME = `${LABEL}.eth`;
const PUBLISHER = packStr(NAME);

async function deploy(file: string, name: string, args: unknown[] = [], value = 0n) {
  const a = artifact(file, name);
  const data = args.length ? encodeDeployData({ abi: a.abi, bytecode: a.creation, args: args as never }) : a.creation;
  const w = wallet();
  const hash = await w.sendTransaction({ data, value, account: w.account!, chain: w.chain, gas: name.startsWith("RendererPaymaster") || name.startsWith("VerbatimAccount") || name.startsWith("TrustAdmin") ? 50_000_000n : 15_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy of ${name} failed: ${hash}`);
  console.log(name, r.contractAddress, hash, "gas", r.gasUsed);
  return { address: r.contractAddress, hash, abi: a.abi };
}

const ens = () => readS()[LABEL];
const council = privateKeyToAccount(namedKey("ens-council")).address;
const owners = ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map(addr);
const attestors = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr);
const chOf = async (a: Address) => keccak256((await pub.getCode({ address: a })) as Hex);

if (!readS().checker) {
  const YEAR = 365n * 24n * 3600n;
  const c = await deploy("EnsTrustChecker.sol", "EnsTrustChecker", [ENS.root, ENS.ethRegistry, ENS.universalResolver, await chOf(ens().resolver), council, YEAR]);
  const m = await deploy("EnsTrustChecker.sol", "TrustAdminEns", [c.address]);
  writeS({ checker: c.address, trustAdmin: m.address, checkerTx: c.hash, trustAdminTx: m.hash });
}
if (!readS().paymaster) {
  const nonce = BigInt(await pub.getTransactionCount({ address: me }));
  const predicted = getContractAddress({ from: me, nonce: nonce + 1n });
  const acc = await deploy("VerbatimAccount4337.sol", "VerbatimAccount4337", [ENTRY_POINT, predicted, 200n, owners, 2]);
  const ch = await chOf(acc.address);
  const pm = await deploy("RendererPaymaster4337.sol", "RendererPaymaster4337", [ENTRY_POINT, ch, me, readS().trustAdmin, UNI.permit2, WETH_SEPOLIA, packedUniswap, attestors, 2]);
  if (pm.address.toLowerCase() !== predicted.toLowerCase()) throw new Error("prediction missed");
  writeS({ account: acc.address, accountCodehash: ch, paymaster: pm.address, accountTx: acc.hash, paymasterTx: pm.hash });
}
const s = () => readS();
const PM_ABI = artifact("RendererPaymaster4337.sol", "RendererPaymaster4337").abi;
if (!s().staked) {
  const a = await tx({ address: s().paymaster, abi: PM_ABI, functionName: "stakeEntryPoint", args: [86400], value: parseEther("0.11") });
  const b = await tx({ address: s().paymaster, abi: PM_ABI, functionName: "fundEntryPoint", args: [], value: parseEther("0.08") });
  console.log("staked", a.transactionHash, "funded", b.transactionHash);
  writeS({ staked: a.transactionHash, fundedEp: b.transactionHash });
}
if (!s().tokenA) {
  const a = await deploy("TestTokens.sol", "TestToken", ["Demo USD", "dUSDC", 6]);
  const b = await deploy("TestTokens.sol", "TestToken", ["Demo Wrapped Ether", "dWETH", 18]);
  writeS({ tokenA: a.address, tokenB: b.address });
}
const ERC20 = artifact("TestTokens.sol", "TestToken").abi;
const ADMIN = artifact("TrustStore.sol", "TrustAdmin").abi;

// Everything the ENS name stands behind, so the record can list it before attestation.
const load = (file: string) => compileFile(JSON.parse(readFileSync(resolve(ROOT, "descriptors", file), "utf8")));
const erc20 = load("erc20.json");
const permit2 = load("permit2.json");

if (!s().textSet) {
  const list = [...erc20, ...permit2].map((d) => d.descHash).join(",");
  const r = await tx({ address: ens().resolver, abi: RESOLVER_ABI, functionName: "setText", args: [dnsName(NAME), "clear-signing", list] }, namedKey("ens-council"));
  console.log("council set the record", r.transactionHash);
  writeS({ textSet: r.transactionHash });
}

if (!s().attested) {
  const u: TrustUpdate = emptyUpdate(1n);
  const tokenCode = await chOf(s().tokenA);
  const p2Code = await chOf(UNI.permit2);
  u.descriptors = [...erc20.map((d) => ({ codehash: tokenCode, selector: d.selector, vdesc: d.vdesc, publisher: PUBLISHER })), ...permit2.map((d) => ({ codehash: p2Code, selector: d.selector, vdesc: d.vdesc, publisher: PUBLISHER }))];
  u.tokens = [tokenEntry(s().tokenA, "dUSDC", 6), tokenEntry(s().tokenB, "dWETH", 18)];
  u.routers = [{ codehash: await chOf(UNI.router), legacy: true }];
  u.names = [{ addr: ens().nameAddress, name: PUBLISHER, resolver: ens().resolver }];
  const r = await attest(s().paymaster, u, 11155111n, async (data: Hex) => {
    const w = wallet();
    const hash = await w.sendTransaction({ to: s().paymaster, data, account: w.account!, chain: w.chain, gas: 6_000_000n });
    return pub.waitForTransactionReceipt({ hash, timeout: 180_000 }) as never;
  });
  if ((r as any).status !== "success") throw new Error(`refreshTrust reverted: ${(r as any).transactionHash}`);
  console.log("refreshTrust with ENS exclusivity", (r as any).transactionHash, "gas", (r as any).gasUsed);
  writeS({ attested: (r as any).transactionHash, refreshGas: String((r as any).gasUsed) });
}

if (!s().feeSet) {
  await tx({ address: s().paymaster, abi: PM_ABI, functionName: "setFeeAsset", args: ["0x0000000000000000000000000000000000000000", 1n, true] });
  await tx({ address: s().paymaster, abi: ADMIN, functionName: "deposit", args: [s().account, "0x0000000000000000000000000000000000000000", 0n], value: parseEther("0.01") });
  await tx({ address: s().tokenA, abi: ERC20, functionName: "mint", args: [s().account, 1_000_000_000_000n] });
  await tx({ address: s().tokenB, abi: ERC20, functionName: "mint", args: [s().account, parseEther("100")] });
  writeS({ feeSet: true });
}

// Demo pool on the official PoolManager, liquidity through the official PositionManager.
const PM = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "function initialize(PoolKey key, uint160 sqrtPriceX96) returns (int24)"]);
const P2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
if (!s().pool) {
  const [c0, c1] = BigInt(s().tokenA) < BigInt(s().tokenB) ? [s().tokenA as Address, s().tokenB as Address] : [s().tokenB as Address, s().tokenA as Address];
  const usdcIs0 = c0.toLowerCase() === s().tokenA.toLowerCase();
  const price = usdcIs0 ? 1e18 / 3000e6 : 3000e6 / 1e18;
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(price) * 2 ** 48)) * 2n ** 48n;
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  const tickLower = Math.floor((tick - 6000) / 60) * 60;
  const tickUpper = Math.floor((tick + 6000) / 60) * 60;
  for (const t of [s().tokenA, s().tokenB] as Address[]) {
    await tx({ address: t, abi: ERC20, functionName: "mint", args: [me, parseEther("100000000")] });
    await tx({ address: t, abi: ERC20, functionName: "approve", args: [UNI.permit2, (1n << 256n) - 1n] });
    await tx({ address: UNI.permit2, abi: P2, functionName: "approve", args: [t, UNI.positionManager, (1n << 160n) - 1n, 2 ** 47] });
  }
  const k = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" as Address };
  const init = await tx({ address: UNI.poolManager, abi: PM, functionName: "initialize", args: [k, sqrtPriceX96] });
  const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
  const mint = encodeAbiParameters([KEY_T, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }], [k, tickLower, tickUpper, 1_000_000_000_000_000n, 1n << 127n, 1n << 127n, me, "0x"]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [c0, c1]);
  const unlock = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8"], [0x02, 0x0d]), [mint, settle]]);
  const liq = await tx({ address: UNI.positionManager, abi: parseAbi(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]), functionName: "modifyLiquidities", args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] });
  console.log("pool", init.transactionHash, "liquidity", liq.transactionHash);
  writeS({ pool: { key: k, init: init.transactionHash, liquidity: liq.transactionHash } });
}
void encodeFunctionData; void KEY; void key;

// The public addresses the demo page and docs read. No keys, by construction.
const st = s();
const dep = {
  network: "sepolia", chainId: 11155111, entryPoint: ENTRY_POINT, account: st.account, paymaster: st.paymaster, accountCodehash: st.accountCodehash, ensTrustChecker: st.checker, trustAdmin: st.trustAdmin,
  tokens: { dUSDC: st.tokenA, dWETH: st.tokenB }, pool: st.pool, refreshTrustTx: st.attested, stakeTx: st.staked,
  uniswap: { router: UNI.router, poolManager: UNI.poolManager, positionManager: UNI.positionManager, permit2: UNI.permit2 },
  ens: { name: NAME, resolver: ens().resolver, registered: ens().registered, lockTxs: ens().locked, lookalike: "verbatim-dem0.eth", lookalikeResolver: st["verbatim-dem0"]?.resolver, recordTx: st.textSet, rootRegistry: ENS.root, ethRegistry: ENS.ethRegistry, universalResolver: ENS.universalResolver },
};
writeFileSync(resolve(ROOT, "deployments/sepolia.json"), JSON.stringify(dep, null, 2) + "\n");
console.log(JSON.stringify({ account: s().account, paymaster: s().paymaster, checker: s().checker, attested: s().attested, pool: s().pool?.init }, null, 1));

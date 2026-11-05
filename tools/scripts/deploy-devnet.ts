// Deploys Verbatim to the frames devnet and attests the demo's descriptors. Idempotent per state key.
import { encodeFunctionData, getContractAddress, keccak256, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STAKING_REGISTRY } from "@verbatim/frames-sdk";
import { PAYMASTER_ABI, packedUniswap } from "@verbatim/client";
import { addr, key, readState, writeState } from "./lib/env";
import { artifact, deploy, faucet, pub, send, waitBalance } from "./lib/chain";
import { REFRESH_ABI, descriptorsFor, emptyUpdate, tokenEntry, updateHash } from "./lib/trust-update";

// Predeployed on the devnet: deployments/devnet.md in forshtat/mempool-workshop-sidecar.
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const WETH9: Address = "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6";
export const ROUTER: Address = "0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be";
export const POOL_MANAGER: Address = "0x6bF9Aa9c04fd001385742d61f6818C3236429848";
export const POSITION_MANAGER: Address = "0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B";

const deployer = key("DEPLOYER_KEY");
const me = addr("DEPLOYER_KEY");
const bal = await pub.getBalance({ address: me });
console.log("deployer", me, "balance", bal);
if (bal < parseEther("0.3")) {
  console.log("faucet", await faucet(me).catch((e) => e.message));
  await waitBalance(me, parseEther("0.2")).catch((e) => console.log(e.message));
}

let s = readState();
if (!s.frameReader) {
  const r = await deploy(deployer, "FrameReader.yul", "FrameReader", { gas: 2_000_000n });
  writeState({ frameReader: r.address });
  s = readState();
}

const attestors = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr);
const owners = ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map(addr);

if (!s.paymaster) {
  const admin = await deploy(deployer, "TrustStore.sol", "TrustAdmin");
  console.log("TrustAdmin", admin.address, "gas", admin.gasUsed);
  // The account pins the paymaster's address and the paymaster pins the account's code hash, so predict.
  const nonce = BigInt(await pub.getTransactionCount({ address: me }));
  const predicted = getContractAddress({ from: me, nonce: nonce + 1n });
  const account = await deploy(deployer, "VerbatimAccount.sol", "VerbatimAccount", { args: [predicted, 200n, owners, 2, s.frameReader], approve: true });
  const code = (await pub.getCode({ address: account.address })) as Hex;
  const ch = keccak256(code);
  console.log("VerbatimAccount", account.address, account.hash, "gas", account.gasUsed, "codehash", ch);
  const pm = await deploy(deployer, "RendererPaymaster.sol", "RendererPaymaster", {
    args: [ch, me, admin.address, PERMIT2, WETH9, packedUniswap, attestors, 2, s.frameReader],
    approve: true,
  });
  if (pm.address.toLowerCase() !== predicted.toLowerCase()) throw new Error(`paymaster at ${pm.address}, expected ${predicted}`);
  console.log("RendererPaymaster", pm.address, pm.hash, "gas", pm.gasUsed);
  writeState({ trustAdmin: admin.address, account: account.address, accountCodehash: ch, paymaster: pm.address, deployTxs: { admin: admin.hash, account: account.hash, paymaster: pm.hash } });
  s = readState();
}

if (!s.staked) {
  const r = await send(deployer, s.paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "stake", args: [STAKING_REGISTRY, 86400] }), parseEther("0.012"));
  console.log("staked", r.transactionHash);
  writeState({ staked: r.transactionHash });
  s = readState();
}

if (!s.tokenA) {
  const a = await deploy(deployer, "TestTokens.sol", "TestToken", { args: ["Demo USD", "dUSDC", 6] });
  const b = await deploy(deployer, "TestTokens.sol", "TestToken", { args: ["Demo Wrapped Ether", "dWETH", 18] });
  writeState({ tokenA: a.address, tokenB: b.address });
  s = readState();
}
if (!s.evilVault) {
  const v = await deploy(deployer, "EvilVault.sol", "EvilVault", { args: [s.tokenA, s.tokenB, addr("ATTACKER_KEY")] });
  writeState({ evilVault: v.address });
  s = readState();
}

const chOf = async (a: Address) => keccak256((await pub.getCode({ address: a })) as Hex);

if (!s.trustEpoch) {
  const u = emptyUpdate(1n);
  u.descriptors = [
    ...descriptorsFor("erc20.json", await chOf(s.tokenA)),
    ...descriptorsFor("permit2.json", await chOf(PERMIT2)),
    ...descriptorsFor("account-admin.json", s.accountCodehash),
    ...descriptorsFor("renderer-paymaster.json", await chOf(s.paymaster)),
    ...descriptorsFor("evil-vault.json", await chOf(s.evilVault), { USDC: s.tokenA }),
  ];
  u.tokens = [tokenEntry(s.tokenA, "dUSDC", 6), tokenEntry(s.tokenB, "dWETH", 18), tokenEntry(WETH9, "WETH", 18)];
  u.routers = [await chOf(ROUTER)];
  const h = updateHash(1337n, s.paymaster, u);
  const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => privateKeyToAccount(key(k)));
  const sorted = signers.sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1)).slice(0, 2);
  const sigs = await Promise.all(sorted.map((x) => x.sign({ hash: h })));
  const r = await send(deployer, s.paymaster, encodeFunctionData({ abi: REFRESH_ABI, functionName: "refreshTrust", args: [u as never, sigs] }), 0n, 20_000_000n);
  console.log("refreshTrust", r.transactionHash, "gas", r.gasUsed);
  writeState({ trustEpoch: 1, refreshTx: r.transactionHash });
  s = readState();
}

if (!s.funded) {
  await send(deployer, s.paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "deposit", args: [s.account, "0x0000000000000000000000000000000000000000", 0n] }), parseEther("0.05"));
  await send(deployer, s.tokenA, encodeFunctionData({ abi: artifact("TestTokens.sol", "TestToken").abi, functionName: "mint", args: [s.account, 1_000_000_000_000n] }));
  await send(deployer, s.tokenB, encodeFunctionData({ abi: artifact("TestTokens.sol", "TestToken").abi, functionName: "mint", args: [s.account, parseEther("100")] }));
  writeState({ funded: true });
  s = readState();
}
console.log(JSON.stringify(s, null, 2));

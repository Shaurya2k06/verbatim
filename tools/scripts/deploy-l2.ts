// The production leg on an L2 mainnet. Real money: it refuses to run unless you say which chain and confirm. Nothing here funds a bounty.
// Usage: CONFIRM_MAINNET=<chain id> L2_RPC_URL=... L2_DEPLOYER_KEY=... tsx deploy-l2.ts base|optimism
import { encodeDeployData, createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, optimism } from "viem/chains";
import { packedUniswap } from "@verbatim/client";
import { addr } from "./lib/env";
import { artifact } from "./lib/chain";

// Uniswap's official deployments, from Uniswap/docs: check these against the docs again before you run this.
const CHAINS = {
  base: { chain: base, permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address, weth: "0x4200000000000000000000000000000000000006" as Address },
  optimism: { chain: optimism, permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address, weth: "0x4200000000000000000000000000000000000006" as Address },
};
const name = process.argv[2] as keyof typeof CHAINS;
const net = CHAINS[name];
if (!net) throw new Error("usage: deploy-l2.ts base|optimism");
if (process.env.CONFIRM_MAINNET !== String(net.chain.id)) throw new Error(`mainnet deployment spends real money. Set CONFIRM_MAINNET=${net.chain.id} to go on.`);
const k = process.env.L2_DEPLOYER_KEY as Hex;
const rpc = process.env.L2_RPC_URL;
if (!k || !rpc) throw new Error("set L2_DEPLOYER_KEY and L2_RPC_URL");
const account = privateKeyToAccount(k);
const pub = createPublicClient({ chain: net.chain, transport: http(rpc) });
const wal = createWalletClient({ account, chain: net.chain, transport: http(rpc) });
const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const owners = ["OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY"].map(addr);
const attestors = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map(addr);

async function deploy(file: string, n: string, args: unknown[]) {
  const a = artifact(file, n);
  const hash = await wal.sendTransaction({ data: encodeDeployData({ abi: a.abi, bytecode: a.creation, args: args as never }), account, chain: net.chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy of ${n} failed: ${hash}`);
  console.log(n, r.contractAddress, hash, "gas", r.gasUsed);
  return r.contractAddress;
}

const sr = await deploy("StatelessRenderer.sol", "StatelessRenderer", [net.permit2, net.weth, packedUniswap]);
const reg = await deploy("RevocationRegistry.sol", "RevocationRegistry", [attestors, 2]);
// No ENS on this chain: the anchor is off, and attestors alone stand behind the snapshot. The sentence says so in `attestStatus`.
const acct = await deploy("VerbatimAccount4337.sol", "VerbatimAccount4337", [ENTRY_POINT, sr, reg, "0x0000000000000000000000000000000000000000", net.permit2, owners, 2, attestors, 2]);
console.log(JSON.stringify({ chain: name, account: acct, renderer: sr, revocations: reg }, null, 1));

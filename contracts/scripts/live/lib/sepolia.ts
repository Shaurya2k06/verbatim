import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ROOT, loadEnv } from "./env";

const env = loadEnv();
export const RPC = env.SEPOLIA_RPC_URL;
export const pub = createPublicClient({ chain: sepolia, transport: http(RPC), pollingInterval: 3000 });
export const KEY = env.SEPOLIA_KEY as Hex;
export const me = privateKeyToAccount(KEY).address;
export const wallet = (k: Hex = KEY) => createWalletClient({ account: privateKeyToAccount(k), chain: sepolia, transport: http(RPC) });

const STATE = resolve(ROOT, "contracts/.state/sepolia.json");
export const readS = (): Record<string, any> => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
export function writeS(patch: Record<string, unknown>) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ ...readS(), ...patch }, null, 2) + "\n");
}
/** A throwaway Sepolia key kept in the state file's sibling, never in git. */
export function namedKey(name: string): Hex {
  const f = resolve(ROOT, `contracts/.state/${name}.key`);
  if (existsSync(f)) return readFileSync(f, "utf8").trim() as Hex;
  const k = generatePrivateKey();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, k + "\n", { mode: 0o600 });
  return k;
}

// ENSv2 on Sepolia: ensdomains/contracts-v2 @ 07e55a05, contracts/deployments/sepolia, as docs.ens.domains/learn/deployments names it.
export const ENS = {
  root: "0xb458d6a3a77919449d03e7a6903c26827c1ec43f" as Address,
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4" as Address,
  registrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3" as Address,
  resolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c" as Address,
  factory: "0xda70306c98e97ece36f997a21368e53298572991" as Address,
  usdc: "0x240b0316df57887dbbe58b586508b19e633a14aa" as Address,
  universalResolver: "0x24e1d8e068620b647ca097f961a61055f4f42d72" as Address,
};

// Uniswap's official Sepolia deployments: Uniswap/docs content/protocols/v4/deployments.mdx.
export const UNI = {
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543" as Address,
  router: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b" as Address,
  positionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
};
export const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const WETH_SEPOLIA: Address = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

export const ROLE = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  LINK: 1n << 28n,
  UPGRADE: 1n << 124n,
  REG_SET_SUBREGISTRY: 1n << 20n,
  REG_SET_RESOLVER: 1n << 24n,
};
export const admin = (r: bigint) => r << 128n;

export const RESOLVER_ABI = parseAbi([
  "function initialize((address account, uint256 roles)[] grants, bytes[] calls)",
  "function grantSetterRoles(bytes setter, address account)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
]);
export const REGISTRY_ABI = parseAbi([
  "struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }",
  "function getResolver(string label) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
  "function getState(uint256 anyId) view returns (State)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
]);
export const REGISTRAR_ABI = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256, uint256)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) view returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
export const FACTORY_ABI = parseAbi(["function deployProxy(address implementation, uint256 salt, bytes data) returns (address)"]);
export const USDC_ABI = parseAbi(["function mint(address to, uint256 amount)", "function approve(address spender, uint256 amount) returns (bool)"]);

export async function tx(args: any, k: Hex = KEY) {
  const w = wallet(k);
  const hash = await w.writeContract({ ...args, account: w.account, chain: sepolia } as never);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`reverted: ${hash} ${args.functionName}`);
  return r;
}

export const dnsName = (name: string): Hex => {
  const parts = name.split(".");
  const out: number[] = [];
  for (const p of parts) out.push(p.length, ...new TextEncoder().encode(p));
  out.push(0);
  return `0x${out.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};

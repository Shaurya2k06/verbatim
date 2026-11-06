import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeDeployData, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEVNET, GATEWAY, rpc } from "@verbatim/frames-sdk";
import { ROOT } from "./env";
import { patchApprove } from "./patch";

export const chain = {
  id: 1337,
  name: "frames-devnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [DEVNET.node] } },
} as const;

export const pub = createPublicClient({ chain, transport: http(DEVNET.node) });
export const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain, transport: http(DEVNET.node) });

// The devnet base fee is 7 wei; state gas makes creations far more expensive than on mainnet.
export const LEGACY_GAS_PRICE = 2_000_000n;
export const DEPLOY_GAS = 50_000_000n;

export function artifact(file: string, name: string) {
  const a = JSON.parse(readFileSync(resolve(ROOT, `contracts/out/${file}/${name}.json`), "utf8"));
  return { abi: a.abi as Abi, creation: a.bytecode.object as Hex, runtime: a.deployedBytecode.object as Hex };
}

export async function faucet(address: Address) {
  // Only the gateway runs the faucet; the miner's sidecar answers that it is disabled.
  return rpc(GATEWAY, "skandha_explorer_faucet", [address]);
}

export async function waitBalance(address: Address, min: bigint, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await pub.getBalance({ address })) >= min) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`balance of ${address} stayed below ${min}`);
}

/** Legacy creation tx. `approve` flips the DevnetFrames sentinel; everything else deploys verbatim. */
export async function deploy(k: Hex, file: string, name: string, opts: { args?: unknown[]; value?: bigint; approve?: boolean; gas?: bigint } = {}) {
  const a = artifact(file, name);
  const creation = opts.approve ? patchApprove(a.creation, a.runtime).creation : a.creation;
  const w = wallet(k);
  const data = opts.args?.length ? encodeDeployData({ abi: a.abi, bytecode: creation, args: opts.args as never }) : creation;
  const hash = await w.sendTransaction({ data, value: opts.value ?? 0n, gas: opts.gas ?? DEPLOY_GAS, gasPrice: LEGACY_GAS_PRICE, type: "legacy" });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy of ${name} failed: ${hash}`);
  return { address: r.contractAddress as Address, hash, gasUsed: r.gasUsed, abi: a.abi };
}

export async function send(k: Hex, to: Address, data: Hex = "0x", value = 0n, gas = 3_000_000n) {
  const w = wallet(k);
  const hash = await w.sendTransaction({ to, data, value, gas, gasPrice: LEGACY_GAS_PRICE, type: "legacy" });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}

export { encodeAbiParameters };

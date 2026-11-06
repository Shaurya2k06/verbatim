// Boots anvil with the Solidity harness and its world, and renders through eth_call.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { RenderIn } from "@verbatim/displayvm-ts";
import { CODE, NAME_RESOLVER, PERMIT2, ROUTER_PUBLISHER, WETH, worldDescriptors, worldHooks, worldLegacyRouterCode, worldNames, worldProxy, worldRouterCode, worldSpenders, worldTokens } from "./world";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil's well-known first key

export async function boot(port = 18545) {
  const url = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn("anvil", ["--port", String(port), "--silent", "--code-size-limit", "100000", "--gas-limit", "1000000000", "--hardfork", "cancun"], { stdio: "ignore" });
  const pub = createPublicClient({ chain: foundry, transport: http(url), pollingInterval: 50 });
  for (let i = 0; ; i++) {
    try {
      await pub.getChainId();
      break;
    } catch (e) {
      if (i > 100) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const art = JSON.parse(readFileSync(resolve(ROOT, "contracts/out/Harness.sol/RenderHarness.json"), "utf8"));
  const abi = art.abi as Abi;
  const w = createWalletClient({ account: privateKeyToAccount(KEY), chain: foundry, transport: http(url) });
  const hash = await w.deployContract({ abi, bytecode: art.bytecode.object, args: [PERMIT2, WETH, ROUTER_PUBLISHER], gas: 500_000_000n });
  const address = (await pub.waitForTransactionReceipt({ hash })).contractAddress as Address;
  const send = async (functionName: string, args: unknown[]) => {
    const h = await w.writeContract({ address, abi, functionName, args: args as never, gas: 30_000_000n });
    await pub.waitForTransactionReceipt({ hash: h });
  };
  for (const [a, ch] of Object.entries(CODE)) await send("setCode", [a, ch]);
  for (const d of worldDescriptors()) await send("setDesc", [d.codehash, d.selector, d.vdesc, d.publisher, d.epoch, d.status]);
  for (const t of worldTokens()) await send("setToken", [t.token, `0x${Buffer.from(t.symbol).toString("hex").padEnd(22, "0")}`, t.len, t.decimals, t.flags]);
  await send("setKind", [worldRouterCode, 1]);
  await send("setKind", [worldLegacyRouterCode, 3]);
  for (const [a, n] of Object.entries(worldNames)) await send("setName", [a, n, NAME_RESOLVER]);
  await send("setProxy", [worldProxy.codehash, worldProxy.upgrader, worldProxy.logic, worldProxy.impl, worldProxy.getter]);
  for (const h of worldHooks) await send("setHook", [h, true]);
  for (const a of worldSpenders) await send("setSpender", [a, true]);
  void createTestClient;

  const render = async (i: RenderIn): Promise<{ tree: Hex; spec: Hex; risk: number } | { error: string }> => {
    try {
      const [tree, spec, risk] = (await pub.readContract({ address, abi, functionName: "render", args: [{ chainId: i.chainId, account: i.account, expiry: i.expiry, snapshotRoot: i.snapshotRoot, policyVersion: i.policyVersion, path: i.path, feeAsset: i.feeAsset, maxFee: i.maxFee, body: i.body, hints: i.hints }] })) as [Hex, Hex, bigint];
      return { tree, spec, risk: Number(risk) };
    } catch (e) {
      return { error: String((e as Error).message).split("\n")[0].slice(0, 160) };
    }
  };
  return { render, stop: () => proc.kill(), address, abi, pub };
}

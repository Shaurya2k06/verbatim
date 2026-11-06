// A dapp pairs with the Verbatim wallet over WalletConnect's real relay, on Sepolia. An honest ETH swap lands; the evil route is refused.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { SignClient } from "@walletconnect/sign-client";
import { createPublicClient, decodeErrorResult, http, parseAbi, parseEther, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { v4SwapCall } from "@verbatim/urrender";
import { artifact } from "../live/lib/chain";
import { record } from "../live/lib/proofs";
import { validationRevert, type Built } from "../live/lib/userop";

const ROOT = resolve(import.meta.dirname, "../../..");
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const s = JSON.parse(readFileSync(resolve(ROOT, "contracts/.state/sepolia.json"), "utf8"));
const account: Address = s.account4337;
const ROUTER: Address = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const ONE = parseEther("0.001");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const pub = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const dUSDC = s.tokenA as Address;
const balance = () => pub.readContract({ address: dUSDC, abi: ERC20, functionName: "balanceOf", args: [account] });
const nonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [account, 0n] });
let failed = 0;
let landed: Hex | undefined;
let refusal = "not asked";
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};
const swap = (key: unknown, min: bigint) => ({ from: account, to: ROUTER, value: `0x${ONE.toString(16)}`, data: v4SwapCall({ key: key as never, zeroForOne: true, amountIn: ONE, amountOutMinimum: min, legacyParams: true }, deadline) });

process.on("unhandledRejection", (e) => console.log("REJECTION", JSON.stringify(e)?.slice(0, 300), String((e as any)?.message ?? "")));
const server = spawn("npx", ["vite", "--port", "5174", "--strictPort"], { cwd: resolve(ROOT, "client/apps/wallet"), env: { ...process.env, VITE_WALLET_CONNECT_PROJECT_ID: env.WALLET_CONNECT_PROJECT_ID, VITE_BUNDLER_URL: env.BUNDLER_URL, VITE_SEPOLIA_RPC_URL: env.SEPOLIA_RPC_URL }, stdio: "ignore", detached: true });
const stop = () => {
  try {
    process.kill(-server.pid!);
  } catch {
    /* gone */
  }
};
try {
  await new Promise((r) => setTimeout(r, 5000));
  const dapp = await SignClient.init({ projectId: env.WALLET_CONNECT_PROJECT_ID, metadata: { name: "Test dapp", description: "", url: "http://localhost", icons: [] } });
  const { uri, approval } = await dapp.connect({ optionalNamespaces: { eip155: { chains: ["eip155:11155111"], methods: ["eth_sendTransaction"], events: [] } } });
  const approved = approval();
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  // Every operation the wallet hands a bundler, so the refusal below is asked of the exact one it signed.
  const sent: Record<string, Hex>[] = [];
  page.on("request", (r) => {
    try {
      const j = r.method() === "POST" ? JSON.parse(r.postData() ?? "{}") : {};
      if (j.method === "eth_sendUserOperation") sent.push(j.params[0]);
    } catch {
      /* not JSON-RPC */
    }
  });
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 180)));
  page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 180)); });
  await page.goto("http://localhost:5174", { timeout: 60000 });
  await page.getByPlaceholder("wc: pairing link").fill(uri!);
  await page.locator("#walletconnect").getByRole("button", { name: "Connect" }).click();
  await page.waitForTimeout(3000);
  console.log("wallet log:", (await page.locator("#walletconnect").innerText()).slice(0, 240).replace(/\n/g, " | "));
  const session = await Promise.race([approved, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no session")), 60000))]);
  console.log("PASS paired over the relay:", session.namespaces.eip155.accounts[0]);
  const request = (tx: unknown) => dapp.request<Hex>({ topic: session.topic, chainId: "eip155:11155111", request: { method: "eth_sendTransaction", params: [tx] } });
  const signTwice = async () => {
    const panel = page.locator("#walletconnect");
    await panel.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 60000 });
    const shown = await panel.innerText();
    for (const k of [env.OWNER1_KEY, env.OWNER2_KEY]) {
      await panel.getByPlaceholder("owner key").fill(k);
      await panel.getByRole("button", { name: "Sign with this key" }).click();
      await page.waitForTimeout(800);
    }
    return shown;
  };
  // Honest.
  const before = await balance();
  const honest = request(swap(s.poolEth.key, 2_000_000n));
  const shown = await signTwice();
  check(/No approval outlives/.test(shown), "guarantees on the page");
  const hash = await honest;
  landed = hash;
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const got = (await balance()) - before;
  check(receipt.status === "success" && got >= 2_000_000n, `honest swap landed, received ${got} (minimum 2000000): ${hash}`);
  // The evil route, as the dapp's tampered calldata would be.
  await page.waitForTimeout(2000);
  await page.locator("#walletconnect").getByRole("button", { name: "Copy request" }).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  const nonceBefore = await nonce();
  const balanceBefore = await balance();
  const sentBefore = sent.length;
  const evil = request(swap(s.poolEthEvil.key, 0n)).then((h) => ({ landed: h as string | null, error: "" }), (e) => ({ landed: null, error: String(e.message ?? e) }));
  const shownEvil = await signTwice();
  for (const risk of ["HOOK CAN TAKE YOUR OUTPUT", "NO MINIMUM OUTPUT", "UNVERIFIED HOOK"]) check(shownEvil.includes(risk), `the page shows ${risk}`);
  const out = await evil;
  check(out.landed === null, out.landed ? `evil route landed: ${out.landed}` : "the dapp is told no");
  check((await nonce()) === nonceBefore && (await balance()) === balanceBefore, "the account did not move");
  // A bundler's error is generic, so ask the account why, with the operation the wallet really signed.
  const op = sent[sentBefore];
  check(!!op, "the wallet sent the signed operation to a bundler");
  if (op) {
    const userOpHash = getUserOperationHash({ chainId: sepolia.id, entryPointAddress: ENTRY_POINT, entryPointVersion: "0.7", userOperation: { sender: op.sender as Address, nonce: BigInt(op.nonce), callData: op.callData, callGasLimit: BigInt(op.callGasLimit), verificationGasLimit: BigInt(op.verificationGasLimit), preVerificationGas: BigInt(op.preVerificationGas), maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas), signature: op.signature } });
    const raw = await validationRevert({ op, hash: userOpHash } as unknown as Built);
    const named = raw ? decodeErrorResult({ abi: artifact("VerbatimAccount4337.sol", "VerbatimAccount4337").abi, data: raw }) : null;
    refusal = named ? `${named.errorName}(${(named.args ?? []).join(",")})` : "validation passes";
    check(named?.errorName === "PolicyRefused", `the account refuses that operation: ${refusal}`);
  }
  await b.close();
  await dapp.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } }).catch(() => {});
} finally {
  stop();
}
record({ id: "WC", title: "A dapp pairs over WalletConnect's relay; honest swap lands; the evil route shows its risks and is refused", expected: "lands; refused by PolicyRefused, with the account unmoved", pass: failed === 0, outcome: "mined", txHash: landed, extra: { chain: "sepolia", rerun: "cd contracts/scripts/e2e && pnpm walletconnect", evilRoute: `${refusal}, asked of the exact operation the wallet signed` } });
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);

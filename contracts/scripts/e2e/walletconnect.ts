// A dapp pairs with the Verbatim wallet over WalletConnect's real relay, on Sepolia. An honest ETH swap lands; the evil route is refused.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { SignClient } from "@walletconnect/sign-client";
import { encodeFunctionData, parseAbi, parseEther, type Address, type Hex } from "viem";
import { v4SwapCall } from "@verbatim/urrender";

const ROOT = resolve(import.meta.dirname, "../../..");
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const s = JSON.parse(readFileSync(resolve(ROOT, "contracts/.state/sepolia.json"), "utf8"));
const account: Address = s.account4337;
const ROUTER: Address = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const ONE = parseEther("0.001");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
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
  const honest = request(swap(s.poolEth.key, 2_000_000n));
  const shown = await signTwice();
  console.log(/No approval outlives/.test(shown) ? "PASS guarantees on the page" : "FAIL guarantees missing");
  console.log("PASS honest swap landed:", await honest);
  // The evil route, as the dapp's tampered calldata would be.
  await page.waitForTimeout(2000);
  await page.locator("#walletconnect").getByRole("button", { name: "Copy request" }).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  const evil = request(swap(s.poolEthEvil.key, 0n)).then((h) => `FAIL landed ${h}`, (e) => `PASS refused: ${String(e.message ?? e).slice(0, 120)}`);
  const shownEvil = await signTwice();
  console.log(/HOOK CAN TAKE YOUR OUTPUT/.test(shownEvil) && /NO MINIMUM OUTPUT/.test(shownEvil) ? "PASS the risks are on the page" : "FAIL no risks shown");
  console.log(await evil);
  await b.close();
  await dapp.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } }).catch(() => {});
  void encodeFunctionData; void parseAbi;
} finally {
  stop();
}
process.exit(0);

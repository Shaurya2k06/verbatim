// The ordinary wallet, in the real UI, under the evil build. Shows what the UI says, then what happened.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ROOT = resolve(import.meta.dirname, "../../../..");
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const out = process.argv[2];
const s = JSON.parse(readFileSync(resolve(ROOT, "contracts/.state/sepolia.json"), "utf8"));
const acct = privateKeyToAccount(env.OWNER3_KEY as Hex);
const transport = http(env.SEPOLIA_RPC_URL);
const pub = createPublicClient({ chain: sepolia, transport });
const wal = createWalletClient({ account: acct, chain: sepolia, transport });
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const bal = (t: `0x${string}`, a: `0x${string}`) => pub.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [a] });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const sent: any[] = [];
const calls: string[] = [];
// The UI's own backends refuse a localhost origin. RPC goes to our provider, the Trading API to its public host with the team's key.
// Anything else fails cleanly, as it would offline: no origin is spoofed, and no other Uniswap service is used.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const TRADING = /\/(check_approval|quote|swap|swappable_tokens|plan|order|orders|indicative_quote|limit_order_quote|send|wrap|unwrap)(\?|$)/;
await page.route(/entry-gateway\.backend-[a-z]+\.api\.uniswap\.org|trade-api\.gateway\.uniswap\.org/, async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  const url = new URL(req.url());
  const rpc = url.pathname.match(/^\/rpc\/(\d+)$/);
  if (rpc) {
    if (rpc[1] !== "11155111") return route.fulfill({ status: 503, headers: CORS, body: "{}" });
    const r = await fetch(env.SEPOLIA_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: req.postData() ?? "" });
    return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body: await r.text() });
  }
  const m = url.pathname.match(TRADING);
  if (m) {
    const r = await fetch(`https://trade-api.gateway.uniswap.org/v1${url.pathname.replace(/^\/v1/, "")}${url.search}`, { method: req.method(), headers: { "content-type": "application/json", "x-api-key": env.UNISWAP_API_KEY, "x-permit2-disabled": "false" }, body: req.method() === "GET" ? undefined : req.postData() ?? "" });
    const body = await r.text();
    calls.push(`TRADING ${r.status} ${url.pathname} ${r.status >= 300 ? body.slice(0, 160) : ""}`);
    return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body });
  }
  return route.fulfill({ status: 503, headers: CORS, body: "{}" });
});
page.on("response", (r) => { const u = r.url(); if (!u.startsWith("http://127.0.0.1") && !/amplitude|statsig|sentry|font|png|svg/.test(u) && r.status() >= 300) calls.push(`${r.status()} ${u.slice(0, 96)}`); });

await page.exposeFunction("__rpc", async (method: string, params: any[]) => {
  if (!/^eth_(call|getBlock|blockNumber|getBalance|chainId|estimate|gasPrice|maxPriority|getCode|getTransactionCount|feeHistory|accounts)/.test(method)) console.log("RPC", method);
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [acct.address];
    case "eth_chainId":
      return "0xaa36a7";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "wallet_getCapabilities":
      return {};
    case "personal_sign":
      return acct.signMessage({ message: { raw: params[0] } });
    case "eth_signTypedData_v4": {
      const t = JSON.parse(params[1]);
      const { EIP712Domain, ...types } = t.types;
      return acct.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message: t.message });
    }
    case "eth_sendTransaction": {
      const tx = params[0];
      sent.push(tx);
      return wal.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0), gas: 2_000_000n });
    }
    default:
      return pub.request({ method, params } as never);
  }
});
await page.addInitScript(`(() => {
  const listeners = {};
  const p = {
    isMetaMask: false,
    request: ({ method, params }) => window.__rpc(method, params ?? []),
    on: (e, f) => { (listeners[e] ??= []).push(f); },
    removeListener: () => {},
  };
  window.ethereum = p;
  const announce = () => dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "00000000-0000-4000-8000-000000000001", name: "Ordinary Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "demo.ordinary" }, provider: p }) }));
  addEventListener("eip6963:requestProvider", announce);
  announce();
})();`);
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 140)));
await page.goto("http://127.0.0.1:5190/swap?chain=sepolia", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(12000);
console.log("evil present", await page.evaluate(() => typeof (window as any).__evilWrap));
await page.screenshot({ path: `${out}/o0.png` });
console.log((await page.locator("body").innerText()).slice(0, 300).replace(/\n+/g, " | "));
const txt = async () => (await page.locator("body").innerText()).replace(/\n+/g, " | ");
const shot = (n: string) => page.screenshot({ path: `${out}/${n}.png` });
await page.getByText(/^Connect$/).first().click({ timeout: 20000 });
await page.waitForTimeout(2500);
await page.waitForTimeout(1500);
{
  let box: any = null;
  for (let i = 0; i < 40 && !box; i++) {
    for (const el of await page.getByText("Ordinary Wallet").all()) {
      const x = await el.boundingBox();
      if (x && x.y > 0 && x.y < 860) box = x;
    }
    if (!box) await page.waitForTimeout(500);
  }
  console.log("box", box);
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
}
await page.waitForTimeout(8000);
await shot("o1a");
console.log("AFTER", (await txt()).slice(0, 300));
await page.goto("http://127.0.0.1:5190/swap?chain=ethereum_sepolia&inputCurrency=ETH&outputCurrency=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(12000);
await page.mouse.click(200, 500);
await page.locator('input[inputmode="decimal"], input[placeholder="0"]').first().fill("0.001");
await page.waitForTimeout(15000);
await page.getByText("Select token").first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(5000);
await shot("o2");
const mod = (await txt());
console.log("MODAL", mod.slice(mod.indexOf("Select a token"), mod.indexOf("Select a token") + 300));
await page.keyboard.type("USDC");
await page.waitForTimeout(5000);
await shot("o2b");
await shot("o3");
console.log("QUOTE", (await txt()).slice(0, 420));
console.log("calls", [...new Set(calls)].slice(-12).join("\n"));
console.log("evil fired", await page.evaluate(() => (window as any).__evilFired ?? 0), "sent", sent.length);
await b.close();

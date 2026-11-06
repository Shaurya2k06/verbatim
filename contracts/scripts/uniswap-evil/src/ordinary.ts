// The ordinary wallet, in the real UI, under the evil build. Shows what the UI says, then what happened.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { decodeErrorResult } from "viem";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { artifact } from "../../live/lib/chain";
import { record } from "../../live/lib/proofs";
import { buildOp, validationRevert } from "../../live/lib/userop";

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

const META = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const tokenMeta = async (address: `0x${string}`) => {
  const [name, symbol, decimals] = await Promise.all(["name", "symbol", "decimals"].map((functionName) => pub.readContract({ address, abi: META, functionName } as never)));
  return { chainId: 11155111, address, name, symbol, decimals: Number(decimals) };
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: out, size: { width: 1280, height: 900 } } });
const page = await ctx.newPage();
const sent: any[] = [];
const hashes: Hex[] = [];
const calls: string[] = [];
// The UI's own backends refuse a localhost origin. RPC goes to our provider, the Trading API to its public host with the team's key.
// Anything else fails cleanly, as it would offline: no origin is spoofed, and no other Uniswap service is used.
// The requests carry credentials, and a browser refuses a wildcard origin on those: the answer names this page's own origin.
const ORIGIN = "http://127.0.0.1:5190";
let CORS: Record<string, string> = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,OPTIONS" };
const TRADING = /\/(check_approval|quote|swap|swappable_tokens|plan|order|orders|indicative_quote|limit_order_quote|send|wrap|unwrap)(\?|$)/;
await page.route(/entry-gateway\.backend-[a-z]+\.api\.uniswap\.org|trade-api\.gateway\.uniswap\.org/, async (route) => {
  const req = route.request();
  CORS = { ...CORS, "access-control-allow-headers": req.headers()["access-control-request-headers"] ?? CORS["access-control-allow-headers"] ?? "content-type" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  const url = new URL(req.url());
  const rpc = url.pathname.match(/^\/rpc\/(\d+)$/);
  if (rpc) {
    if (rpc[1] !== "11155111") { calls.push(`RPC-REFUSED ${rpc[1]}`); return route.fulfill({ status: 503, headers: CORS, body: "{}" }); }
    calls.push("RPC-OK 11155111");
    const r = await fetch(env.SEPOLIA_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: req.postData() ?? "" });
    return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body: await r.text() });
  }
  const m = url.pathname.match(TRADING);
  if (m) {
    const r = await fetch(`https://trade-api.gateway.uniswap.org/v1${url.pathname.replace(/^\/v1/, "")}${url.search}`, { method: req.method(), headers: { "content-type": "application/json", "x-api-key": env.UNISWAP_API_KEY, "x-permit2-disabled": "false" }, body: req.method() === "GET" ? undefined : req.postData() ?? "" });
    const body = await r.text();
    calls.push(`TRADING ${r.status} ${url.pathname} ${/quote/.test(url.pathname) ? (req.postData() ?? "").slice(0, 300) + " => " + body.slice(0, 500) : r.status >= 300 ? body.slice(0, 160) : ""}`);
    return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body });
  }
  // The one stub: token metadata, read from the chain itself, because the data backend refuses this origin. Disclosed in
  // contracts/docs/DECISIONS.md, D-A22. Quotes, calldata and the transaction stay real.
  if (/DataApiService\/GetToken$/.test(url.pathname)) {
    const q = JSON.parse(req.postData() ?? "{}");
    const body = q.chainId === 11155111 && q.address ? { token: await tokenMeta(q.address).catch(() => undefined) } : {};
    calls.push(`STUB GetToken ${q.chainId} ${q.address}`);
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  let op = "";
  try {
    op = JSON.parse(req.postData() ?? "{}").operationName ?? "";
  } catch {
    /* not JSON */
  }
  calls.push(`REFUSED ${url.pathname} ${op} ${(req.postData() ?? "").slice(0, 220)}`);
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
      const h = await wal.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0), gas: 2_000_000n });
      hashes.push(h);
      return h;
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
const failed: Record<string, number> = {};
page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.hostname !== "127.0.0.1") failed[`${u.hostname}${u.pathname} ${r.failure()?.errorText}`] = (failed[`${u.hostname}${u.pathname} ${r.failure()?.errorText}`] ?? 0) + 1; });
const noise: string[] = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.text().slice(0, 240)); });
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
// Testnet mode, set where the app persists it: its toggle only holds until a reload, and a deep link needs a reload.
await page.addInitScript(() => {
  try {
    const k = "redux/persist:interface";
    const v = JSON.parse(localStorage.getItem(k) ?? "null");
    if (v?.userSettings) {
      v.userSettings = { ...v.userSettings, isTestnetModeEnabled: true };
      localStorage.setItem(k, JSON.stringify(v));
    }
  } catch {
    /* first load */
  }
});
await page.waitForTimeout(2000);
console.log("PERSIST", await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("redux/persist:interface") ?? "{}").userSettings)?.slice(0, 200)));
await page.goto("http://127.0.0.1:5190/swap?chain=ethereum_sepolia&inputCurrency=ETH&outputCurrency=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);
console.log("testnet banner", /testnet mode/i.test(await txt()));
await page.mouse.click(200, 500);
await page.locator('input[inputmode="decimal"], input[placeholder="0"]').first().fill("0.001");
await page.waitForTimeout(20000);
await shot("o2");
const quoteText = await txt();
console.log("QUOTE", quoteText.slice(0, 500));
// The review the victim reads, which still describes the honest quote.
const buy = quoteText.match(/Buy \| ([\d.,]+)/)?.[1];
console.log("UI quotes", buy, "USDC for 0.001 ETH");
await page.getByText(/^Review$/).first().click({ timeout: 15000 });
await page.waitForTimeout(3000);
// A small wallet gets a low-balance warning first, on real interfaces too.
await page.getByText(/^Continue$/).first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(6000);
await shot("o3-review");
const review = await txt();
console.log("REVIEW", review.slice(review.indexOf("You"), review.indexOf("You") + 260));
const hook = privateKeyToAccount(env.ATTACKER_KEY as Hex).address; // SkimHook pays out to the attacker
const dUSDC = s.tokenA as `0x${string}`;
const victimBefore = await bal(dUSDC, acct.address);
const hookBefore = await bal(dUSDC, hook);
await page.getByText(/^Swap$/).last().click({ timeout: 15000 });
for (let i = 0; i < 60 && !sent.length; i++) await page.waitForTimeout(1000);
await page.waitForTimeout(25000);
await shot("o4-sent");
console.log("evil fired", await page.evaluate(() => (window as any).__evilFired ?? 0), "sent", sent.length);
if (!sent.length) {
  console.log("NOTHING SENT", (await txt()).slice(0, 500));
  await ctx.close();
  await b.close();
  process.exit(1);
}
const tx = sent[0];
const hash = hashes[0];
// The exact bytes the page produced, kept so they can be handed to Verbatim again on screen (verbatim-half.ts).
writeFileSync(`${out}/sent-tx.json`, JSON.stringify({ to: tx.to, data: tx.data, value: tx.value ?? "0x0", hash, quoted: buy }, null, 1));
const r = await pub.waitForTransactionReceipt({ hash });
const got = (await bal(dUSDC, acct.address)) - victimBefore;
const took = (await bal(dUSDC, hook)) - hookBefore;
console.log("the page showed", buy, "USDC; the wallet was handed", tx.to, tx.data.slice(0, 10), "tx", hash, r.status, "victim got", got, "hook took", took);
record({
  id: "B-UI-eoa",
  title: "Uniswap's real interface, compromised at build: an ordinary wallet signs what the page sends",
  expected: "the page keeps the honest quote; the swap goes through the skim hook",
  pass: r.status === "success" && took > got && !!buy,
  outcome: "mined",
  txHash: hash,
  message: `the page quoted ${buy} USDC; the victim got ${got} dUSDC raw, the hook ${took}`,
  extra: { quotedUsdc: buy, victimGot: got.toString(), hookTook: took.toString(), stubbed: "token metadata only; the quote came from the real Trading API" },
});
// The same bytes, handed to Verbatim instead: the frontend gets no second chance to behave.
const snap = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/snapshot-sepolia.json"), "utf8"));
const built = await buildOp(s.account4337, [{ target: tx.to, value: BigInt(tx.value ?? 0), data: tx.data }], env.BUNDLER_URL, snap);
const lines = formatForDevice(decodeTree(built.tree)).filter((l) => l.risk).map((l) => l.text);
const raw = await validationRevert(built);
const named = raw ? decodeErrorResult({ abi: artifact("VerbatimAccount4337.sol", "VerbatimAccount4337").abi, data: raw }) : null;
console.log("verbatim device shows:", lines.join(" | "), "|", named?.errorName, named?.args);
record({
  id: "B-UI-verbatim",
  title: "The exact calldata that page produced, handed to Verbatim",
  expected: "the device shows the risks; PolicyRefused",
  pass: named?.errorName === "PolicyRefused" && lines.some((l) => /HOOK CAN TAKE YOUR OUTPUT/.test(l)) && lines.some((l) => /NO MINIMUM OUTPUT/.test(l)),
  outcome: "rejected-at-mempool",
  message: `${lines.join(" | ")} || ${named?.errorName}(${(named?.args ?? []).join(",")})`,
});
await ctx.close();
await b.close();
process.exit(0);

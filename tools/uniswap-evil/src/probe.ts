import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const reqs: string[] = [];
page.on("response", (r) => { const u = r.url(); if (/quote|trade-api|\/swap/i.test(u) && !/@fs|src\/|node_modules/.test(u)) reqs.push(`${r.status()} ${u.slice(0, 90)}`); });
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 160)));
await page.goto("http://127.0.0.1:5190/swap?chain=sepolia&inputCurrency=ETH&outputCurrency=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(25000);
await page.screenshot({ path: `${out}/uni1.png` });
const input = page.locator('input[inputmode="decimal"], input[placeholder="0"]').first();
if (await input.count()) { await input.fill("0.001"); await page.waitForTimeout(15000); }
await page.screenshot({ path: `${out}/uni2.png` });
console.log(reqs.slice(-10).join("\n"));
console.log((await page.locator("body").innerText()).slice(0, 700).replace(/\n+/g, " | "));
await b.close();

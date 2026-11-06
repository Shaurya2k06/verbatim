// The recording of the attack on Uniswap's real interface, start to finish: the compromised page and an ordinary wallet (the
// recorded browser session, contracts/docs/demo/uniswap-interface-attack.mp4), the numbers read back from Sepolia for that
// transaction, then the same bytes handed to Verbatim: the offline signer decoding them live, and the account's refusal.
// Needs half.json from verbatim-half.ts, the signer served on :5183, ffmpeg, and OWNER1_KEY in the root .env.
// Usage: tsx src/make-video.ts <half.json> <workdir> <out.mp4>
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../../..");
const [halfFile, work, outFile] = process.argv.slice(2);
mkdirSync(work, { recursive: true });
const half = JSON.parse(readFileSync(halfFile, "utf8"));
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const CLIP = resolve(ROOT, "contracts/docs/demo/uniswap-interface-attack.mp4");
const W = 1280;
const H = 900;
const ff = (...a: string[]) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${a.join(" ")}`);
};
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: W, height: H } });

// ---- cards ----
const base = (body: string) => `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#08090d;color:#e9ecf3;font-family:ui-monospace,'SF Mono',Menlo,monospace"><div style="width:1040px">${body}</div></body>`;
const big = (t: string) => `<div style="font:400 46px/1.15 ui-monospace,Menlo,monospace;letter-spacing:-0.01em">${t}</div>`;
const sub = (t: string) => `<div style="margin-top:22px;font-size:20px;line-height:1.6;color:#8d94a5">${t}</div>`;
const tag = (t: string, c = "#8dffb0") => `<div style="font-size:15px;color:${c};margin-bottom:18px">${t}</div>`;
async function card(name: string, html: string, secs: number) {
  await page.setContent(base(html));
  await page.screenshot({ path: `${work}/${name}.png` });
  ff("-loop", "1", "-framerate", "25", "-t", String(secs), "-i", `${work}/${name}.png`, "-vf", "format=yuv420p", "-c:v", "libx264", `${work}/${name}.mp4`);
}
await card("c0", tag("// sepolia · recorded") + big("Uniswap's real interface,<br/>compromised at build time.") + sub("We built Uniswap/interface from a clean checkout and added one malicious build step. It keeps the quote and rewrites the transaction. Bybit-style."), 5);
const row = (k: string, v: string, c = "#e9ecf3") => `<div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #1f2330;font-size:22px"><span style="color:#8d94a5">${k}</span><span style="color:${c}">${v}</span></div>`;
await card("c1", tag("// what the chain recorded for that swap", "#ff6b5a") + big("The page said it would pay<br/>26.19 USDC.") + `<div style="margin-top:30px">${row("The page quoted", `${Number(half.quoted).toFixed(2)} USDC for 0.001 ETH`)}${row("The victim received", `${half.victimGot} dUSDC`, "#ff6b5a")}${row("The hook took", `${half.hookTook} dUSDC (${half.hookShare}%)`, "#ff6b5a")}${row("Transaction", short(half.hash))}${row("Block", String(half.block))}</div>` + sub("Nothing on chain noticed. The wallet signed calldata it could not read."), 8);
await card("c3", tag("// the same bytes, handed to Verbatim") + big("Refused before it<br/>reaches the mempool.") + `<div style="margin-top:30px">${row("The account says", half.refusal ?? "", "#8dffb0")}${row("Calldata", `${half.calldataBytes.toLocaleString("en-US")} bytes, exactly what the page produced`)}${row("Reached a block?", "No. No transaction exists.")}${row("Fee paid", "None")}</div>` + sub("The sentence was true, and the policy refused it. The three risk lines on the device are the reason."), 8);
await card("c4", tag("// the chain is your wallet's screen") + big("Verbatim") + sub("Even when the page is compromised, the device decodes the bytes itself, and the chain re-renders them before it admits anything."), 3);

// ---- the device, live: the real offline signer, network blocked ----
const rec = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: `${work}/dev`, size: { width: W, height: H } } });
const dev = await rec.newPage();
await dev.goto("http://localhost:5183");
await dev.route("**/*", (r) => r.abort());
await dev.evaluate(() => { (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = "1.5"; }); // a phone-sized column, readable in a video
const cap = (p: Page, t: string) => p.evaluate((x) => { let c = document.getElementById("__c"); if (!c) { c = document.createElement("div"); c.id = "__c"; c.setAttribute("style", "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#111;color:#fff;font:600 21px/1.35 ui-monospace,Menlo,monospace;padding:14px 22px"); document.body.append(c); } c.textContent = x; }, t);
await dev.getByPlaceholder("0x private key").fill(env.OWNER1_KEY);
await dev.getByRole("button", { name: "Import" }).click();
await cap(dev, "The offline signer: no network. It holds an owner key and decodes what it is handed.");
await dev.waitForTimeout(3500);
await dev.getByPlaceholder("Scan the request").fill(await (async () => {
  const { encodeRequest } = await import("../../../../packages/signer/src/core");
  return encodeRequest(half.request);
})());
await cap(dev, "The request carries the exact calldata the compromised page produced, as the laptop would show it.");
await dev.waitForTimeout(3000);
await dev.getByRole("button", { name: "Review" }).click();
await dev.getByRole("button", { name: "Approve and sign" }).waitFor();
await cap(dev, "The device decoded the bytes itself. Guarantees first, then the risk lines the page never mentioned.");
await dev.waitForTimeout(4500);
await dev.evaluate(() => window.scrollTo({ top: 260, behavior: "smooth" }));
await dev.waitForTimeout(3500);
await dev.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await dev.waitForTimeout(2500);
await rec.close();
await b.close();
const webm = readdirSync(`${work}/dev`).filter((f) => f.endsWith(".webm")).sort((x, y) => statSync(`${work}/dev/${y}`).size - statSync(`${work}/dev/${x}`).size)[0]; // the largest: an earlier empty take may be there
ff("-i", `${work}/dev/${webm}`, "-vf", `scale=${W}:${H},fps=25,format=yuv420p`, "-an", "-c:v", "libx264", `${work}/c2.mp4`);

// ---- the recorded page, with captions drawn as images (this ffmpeg has no drawtext) ----
const cb = await chromium.launch();
const cp = await cb.newPage({ viewport: { width: W, height: H } });
const caps: [number, number, string][] = [
  [0, 6, "Uniswap's real interface, built from a clean checkout with one malicious build step added."],
  [6, 13, "An ordinary wallet connects. Sepolia, the real router, the real Trading API."],
  [13, 20, "The page quotes 0.001 ETH for 26.19 USDC and shows its usual review. It looks completely normal."],
  [20, 31, "The wallet signs what the page sends. The page keeps showing the honest quote."],
];
const filters: string[] = [];
let prev = "[base]";
for (const [i, [a, z, t]] of caps.entries()) {
  await cp.setContent(`<body style="margin:0;background:transparent"><div style="position:fixed;left:0;right:0;bottom:0;background:#111;color:#fff;font:600 22px/1.35 ui-monospace,Menlo,monospace;padding:14px 22px">${t}</div></body>`);
  await cp.screenshot({ path: `${work}/cap${i}.png`, omitBackground: true });
  filters.push(`${prev}[${i + 1}:v]overlay=0:0:enable='between(t,${a},${z})'[o${i}]`);
  prev = `[o${i}]`;
}
await cb.close();
ff("-t", "100", "-i", CLIP, ...caps.flatMap((_, i) => ["-i", `${work}/cap${i}.png`]), "-filter_complex", `[0:v]setpts=PTS/3.2,scale=${W}:${H},fps=25,format=yuv420p[base];${filters.join(";")}`, "-map", prev, "-an", "-c:v", "libx264", `${work}/clip.mp4`);

// ---- join ----
writeFileSync(`${work}/list.txt`, ["c0", "clip", "c1", "c2", "c3", "c4"].map((n) => `file '${work}/${n}.mp4'`).join("\n") + "\n");
ff("-f", "concat", "-safe", "0", "-i", `${work}/list.txt`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", outFile);
const d = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:format=size", "-of", "csv=p=0", outFile], { encoding: "utf8" });
console.log("saved", outFile, d.stdout.trim());

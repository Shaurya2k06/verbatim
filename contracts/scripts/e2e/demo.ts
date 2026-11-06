// Walks the §20 demo end to end in real browsers against the live devnet, through the real pages.
// Pass --record to save a captioned fallback video to contracts/docs/demo/verbatim-demo.mp4. The signer is the offline app with
// networking blocked.
// Reads owner keys from the git-ignored .env; types them into the pages' local key fields only.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RECORD = process.argv.includes("--record");
const PACE = RECORD ? 2500 : 300;
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const servers: ChildProcess[] = [];
function serve(filter: string, port: number) {
  const p = spawn("pnpm", ["--filter", filter, "exec", "vite", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore", detached: true });
  servers.push(p);
}
const stop = () => {
  for (const s of servers) {
    try {
      process.kill(-s.pid!);
    } catch {
      /* already gone */
    }
  }
};
process.on("exit", stop);

async function waitFor(url: string) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

serve("@verbatim/signer", 5183);
serve("@verbatim/wallet", 5184);
serve("@verbatim/swap-demo", 5185);
serve("@verbatim/evil-frontend", 5186);
await Promise.all([5183, 5184, 5185, 5186].map((p) => waitFor(`http://localhost:${p}`)));

const browser = await chromium.launch();
const VIDEO = resolve(ROOT, "contracts/scripts/e2e/.video");
rmSync(VIDEO, { recursive: true, force: true });
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });

// Recording follows whichever page is on stage, so the video stays one continuous take across tabs.
let stage: Page | null = null;
let frameNo = 0;
let recording = RECORD;
let captionText = "";
async function recorder() {
  mkdirSync(VIDEO, { recursive: true });
  while (recording) {
    const started = Date.now();
    if (stage) {
      try {
        await stage.screenshot({ path: resolve(VIDEO, `f${String(frameNo++).padStart(6, "0")}.jpg`), type: "jpeg", quality: 80 });
      } catch {
        /* page mid-navigation */
      }
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 200 - (Date.now() - started))));
  }
}
const recorderDone = RECORD ? recorder() : Promise.resolve();

async function caption(page: Page, text: string) {
  captionText = text;
  await page.evaluate((t) => {
    let c = document.getElementById("__caption");
    if (!c) {
      c = document.createElement("div");
      c.id = "__caption";
      c.setAttribute("style", "pointer-events:none;position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#111;color:#fff;font:600 19px/1.35 system-ui;padding:12px 20px");
      document.body.append(c);
    }
    c.textContent = t;
  }, text).catch(() => {});
}

async function show(page: Page, text?: string) {
  await page.bringToFront();
  stage = page;
  await caption(page, text ?? captionText);
}

/** A beat's title card. */
async function say(page: Page, text: string, ms = 4500) {
  await show(page, text);
  if (RECORD) await page.waitForTimeout(ms);
}

// The device: loaded once, then cut off from every network.
const device = await ctx.newPage();
await device.goto("http://localhost:5183");
await device.route("**/*", (r) => r.abort());
await device.getByPlaceholder("0x private key").fill(env.OWNER1_KEY);
await device.getByRole("button", { name: "Import" }).click();

const results: { beat: string; pass: boolean; text: string }[] = [];

/** Takes a page's request to the offline device, reads it there, and brings back the signature. */
async function signFlow(page: Page) {
  await page.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 60_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(PACE);
  const req = await page.locator("textarea[readonly]").inputValue();
  await show(device, "On the offline device: it decodes the sentence itself and signs only what it shows.");
  await device.getByPlaceholder("Scan the request").fill(req);
  await device.getByRole("button", { name: "Review" }).click();
  await device.getByRole("button", { name: "Approve and sign" }).waitFor();
  const shown = await device.locator(".panel").first().innerText();
  await device.waitForTimeout(PACE);
  await device.getByRole("button", { name: "Approve and sign" }).click();
  const sig = await device.locator("textarea[readonly]").inputValue();
  await device.waitForTimeout(PACE / 2);
  await device.getByRole("button", { name: "Done" }).click();
  await show(page, "Second owner signs. Submitting to the ERC-8421 alt mempool.");
  await page.getByPlaceholder("Paste the signature").fill(sig);
  await page.getByRole("button", { name: "Add signature" }).click();
  await page.getByPlaceholder("0x owner key held").fill(env.OWNER2_KEY);
  await page.waitForTimeout(PACE / 2);
  await page.getByRole("button", { name: "Sign with this key" }).click();
  return shown;
}

async function outcome(page: Page, want: RegExp, beat: string) {
  const box = page.locator(".ok, .bad").filter({ hasText: /Rejected|Landed|Mined/ }).first();
  await box.waitFor({ timeout: 120_000 });
  await box.scrollIntoViewIfNeeded();
  const parent = await box.locator("..").innerText();
  const pass = want.test(parent);
  results.push({ beat, pass, text: parent.replace(/\s+/g, " ").slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${beat}: ${parent.replace(/\s+/g, " ").slice(0, 160)}`);
  await caption(page, `${pass ? "" : "UNEXPECTED: "}${beat}`);
  await page.waitForTimeout(PACE * 2);
}

const pause = () => new Promise((r) => setTimeout(r, 9000)); // one block, so each sender nonce is fresh

// Beat 1: the swap lie.
const swap = await ctx.newPage();
await swap.goto("http://localhost:5185");
await say(swap, "Bybit, Feb 2025, $1.5B. Signers approved what a screen told them. Binance was a hacked machine: a different problem, out of scope here.", 7000);
await say(swap, "Verbatim fixes the human case: the chain checks you signed what you read, then checks it actually happened.", 5000);
await swap.locator("select").selectOption("lie");
await say(swap, "Beat 1. An evil frontend says \"swap 0.001 ETH for at least 2 dUSDC\". Its calldata sets minOut = 0 and routes through a hook that skims 99%.", 6000);
await swap.getByRole("button", { name: "Swap", exact: true }).click();
await signFlow(swap);
await outcome(swap, /Rejected.*(TreeMismatch|SpecHashMismatch)/s, "beat 1: lying swap frontend");

await swap.locator("select").selectOption("truth");
await say(swap, "Rejected: that calldata does not render to the sentence signed. So show the truth instead, and sign it anyway.", 5000);
await swap.getByRole("button", { name: "Swap", exact: true }).click();
const truth = await signFlow(swap);
if (!/NO MINIMUM OUTPUT/.test(truth) || !/HOOK CAN TAKE YOUR OUTPUT/.test(truth)) results.push({ beat: "beat 1: device risk lines", pass: false, text: truth });
else console.log("PASS beat 1: device shows NO MINIMUM OUTPUT and HOOK CAN TAKE YOUR OUTPUT");
await outcome(swap, /Rejected.*PolicyRefused/s, "beat 1: true sentence, policy refuses");

await swap.locator("select").selectOption("honest");
await say(swap, "The device warned, and policy refused. Now the honest swap, through the real Universal Router.", 4000);
await swap.getByRole("button", { name: "Swap", exact: true }).click();
await signFlow(swap);
await outcome(swap, /Landed in block/, "beat 1: honest swap lands");
await pause();

// Beat 2 and beat 3 share the attack kit page.
const evil = await ctx.newPage();
await evil.goto("http://localhost:5186");
await say(evil, "Beat 2. The contract tells the truth, then does more. \"Deposit ETH for at least these shares\" is accurate, and the vault keeps the ETH and credits nothing. The chain checks what happened.", 6000);
const kit: [string, RegExp][] = [
  ["The contract tells the truth", /Mined.*AssertionFailed/s],
  ["Swap the recipient", /Rejected.*(TreeMismatch|SpecHashMismatch)/s],
  ["Drop the renderer frame", /Rejected.*BadLayout/s],
  ["Swap the spec for a weaker one", /Rejected.*SpecHashMismatch/s],
  ["Poison a descriptor", /Rejected.*PolicyRefused/s],
  ["Router command that may silently fail", /Rejected.*PolicyRefused/s],
  ["Router command nobody can read", /Rejected.*PolicyRefused/s],
  ["Replay a stale signature", /Rejected/s],
];
for (const [name, want] of kit) {
  if (name === "Swap the recipient") await say(evil, "The chain caught what it did. Beat 3: attack us. Every lie fails live.", 4500);
  await show(evil, name);
  await evil.getByRole("button", { name }).click();
  await signFlow(evil);
  await outcome(evil, want, name.startsWith("The contract") ? `beat 2: ${name}` : `beat 3: ${name}`);
  if (want.source.startsWith("Mined")) await pause();
}

// The device's own clock: a sentence that would stay valid too long never reaches a signature.
await evil.getByRole("button", { name: "A signature that never expires" }).click();
await evil.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 60_000 });
const farReq = await evil.locator("textarea[readonly]").inputValue();
await show(device, "A signature that would stay valid for a day: the device refuses, by its own clock.");
await device.getByPlaceholder("Scan the request").fill(farReq);
await device.getByRole("button", { name: "Review" }).click();
const refused = await device.locator(".err").innerText({ timeout: 10_000 });
results.push({ beat: "beat 3: future-dated sentence refused on the device", pass: /stay valid/.test(refused), text: refused });
console.log(`${/stay valid/.test(refused) ? "PASS" : "FAIL"} beat 3: future-dated sentence refused on the device: ${refused}`);
await device.waitForTimeout(PACE);

// The wallet, honestly.
const wallet = await ctx.newPage();
await wallet.goto("http://localhost:5184");
await wallet.getByRole("button", { name: "Render the sentence" }).click();
await signFlow(wallet);
await outcome(wallet, /Landed in block/, "wallet: honest send lands");

await say(wallet, "Clear signing, enforced by the chain. Runs today on the frame-transaction alt mempool; ships as a Uniswap renderer anyone can use.", 6000);

const failed = results.filter((r) => !r.pass);
recording = false;
await recorderDone;
await ctx.close();
await browser.close();
if (RECORD) {
  mkdirSync(resolve(ROOT, "contracts/docs/demo"), { recursive: true });
  // Most of the raw take is waiting for blocks. Cap every static stretch, then speed up to fit the 3-minute limit.
  const FPS = 5;
  const MAX_STATIC = 5 * FPS;
  const LIMIT_S = 176;
  const names = readdirSync(VIDEO).filter((f) => f.endsWith(".jpg")).sort();
  const kept = resolve(VIDEO, "kept");
  mkdirSync(kept, { recursive: true });
  let last = "";
  let run = 0;
  let n = 0;
  for (const f of names) {
    const h = createHash("md5").update(readFileSync(resolve(VIDEO, f))).digest("hex");
    run = h === last ? run + 1 : 0;
    last = h;
    if (run < MAX_STATIC) copyFileSync(resolve(VIDEO, f), resolve(kept, `k${String(n++).padStart(6, "0")}.jpg`));
  }
  const raw = n / FPS;
  const speed = Math.max(1, raw / LIMIT_S);
  const out = resolve(ROOT, "contracts/docs/demo/verbatim-demo.mp4");
  const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", resolve(kept, "k%06d.jpg"), "-vf", `setpts=PTS/${speed.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", out], { stdio: "inherit" });
  if (ff.status === 0) console.log(`saved ${out}: ${names.length} raw frames, ${Math.round(raw)} s after trimming idle time, ${Math.round(raw / speed)} s at ${speed.toFixed(2)}x`);
  else console.log(`no ffmpeg on PATH: frames are in ${kept}. Encode them with ffmpeg at ${FPS} fps.`);
}
console.log(`${results.length - failed.length}/${results.length} beats passed`);
for (const f of failed) console.log("FAILED", f.beat, f.text);
stop();
process.exit(failed.length ? 1 : 0);

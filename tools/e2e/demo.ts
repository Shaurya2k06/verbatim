// Walks the §20 demo end to end in real browsers against the live devnet, through the real pages.
// Pass --record to save a fallback video to docs/demo/. The signer is the offline app with networking blocked.
// Reads owner keys from the git-ignored .env; types them into the pages' local key fields only.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

serve("@verbatim/signer", 5173);
serve("@verbatim/wallet", 5174);
serve("@verbatim/swap-demo", 5175);
serve("@verbatim/evil-frontend", 5176);
await Promise.all([5173, 5174, 5175, 5176].map((p) => waitFor(`http://localhost:${p}`)));

const browser = await chromium.launch();
const VIDEO = resolve(ROOT, "tools/e2e/.video");
rmSync(VIDEO, { recursive: true, force: true });
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...(RECORD ? { recordVideo: { dir: VIDEO, size: { width: 1280, height: 860 } } } : {}) });

// The device: loaded once, then cut off from every network.
const device = await ctx.newPage();
await device.goto("http://localhost:5173");
await device.route("**/*", (r) => r.abort());
await device.getByPlaceholder("0x private key").fill(env.OWNER1_KEY);
await device.getByRole("button", { name: "Import" }).click();

const results: { beat: string; pass: boolean; text: string }[] = [];

/** Takes a page's request to the offline device, reads it there, and brings back the signature. */
async function signFlow(page: Page) {
  await page.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 60_000 });
  const req = await page.locator("textarea[readonly]").inputValue();
  await device.bringToFront();
  await device.getByPlaceholder("Scan the request").fill(req);
  await device.getByRole("button", { name: "Review" }).click();
  await device.getByRole("button", { name: "Approve and sign" }).waitFor();
  const shown = await device.locator(".panel").first().innerText();
  await device.waitForTimeout(PACE);
  await device.getByRole("button", { name: "Approve and sign" }).click();
  const sig = await device.locator("textarea[readonly]").inputValue();
  await device.waitForTimeout(PACE / 2);
  await device.getByRole("button", { name: "Done" }).click();
  await page.bringToFront();
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
  const parent = await box.locator("..").innerText();
  const pass = want.test(parent);
  results.push({ beat, pass, text: parent.replace(/\s+/g, " ").slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${beat}: ${parent.replace(/\s+/g, " ").slice(0, 160)}`);
  await page.waitForTimeout(PACE * 2);
}

const pause = () => new Promise((r) => setTimeout(r, 9000)); // one block, so each sender nonce is fresh

// Beat 1: the swap lie.
const swap = await ctx.newPage();
await swap.goto("http://localhost:5175");
await swap.locator("select").selectOption("lie");
await swap.waitForTimeout(PACE);
await swap.getByRole("button", { name: "Swap", exact: true }).click();
await signFlow(swap);
await outcome(swap, /Rejected.*TreeMismatch/s, "beat 1: lying swap frontend");

await swap.locator("select").selectOption("truth");
await swap.getByRole("button", { name: "Swap", exact: true }).click();
const truth = await signFlow(swap);
if (!/NO MINIMUM OUTPUT/.test(truth) || !/HOOK CAN TAKE YOUR OUTPUT/.test(truth)) results.push({ beat: "beat 1: device risk lines", pass: false, text: truth });
else console.log("PASS beat 1: device shows NO MINIMUM OUTPUT and HOOK CAN TAKE YOUR OUTPUT");
await outcome(swap, /Rejected.*PolicyRefused/s, "beat 1: true sentence, policy refuses");

await swap.locator("select").selectOption("honest");
await swap.getByRole("button", { name: "Swap", exact: true }).click();
await signFlow(swap);
await outcome(swap, /Landed in block/, "beat 1: honest swap lands");
await pause();

// Beat 2 and beat 3 share the attack kit page. The vault needs the old approvals tools/scripts/attacks.ts A6 made.
const evil = await ctx.newPage();
await evil.goto("http://localhost:5176");
const kit: [string, RegExp][] = [
  ["The contract tells the truth", /Mined.*AssertionFailed/s],
  ["Swap the recipient", /Rejected.*TreeMismatch/s],
  ["Drop the renderer frame", /Rejected.*FrameReadFailed/s],
  ["Swap the spec for a weaker one", /Rejected.*SpecHashMismatch/s],
  ["Poison a descriptor", /Rejected.*PolicyRefused/s],
  ["Replay a stale signature", /Mined.*Expired/s],
];
for (const [name, want] of kit) {
  await evil.getByRole("button", { name }).click();
  await signFlow(evil);
  await outcome(evil, want, name.startsWith("The contract") ? `beat 2: ${name}` : `beat 3: ${name}`);
  if (want.source.startsWith("Mined")) await pause();
}

// The wallet, honestly.
const wallet = await ctx.newPage();
await wallet.goto("http://localhost:5174");
await wallet.getByRole("button", { name: "Render the sentence" }).click();
await signFlow(wallet);
await outcome(wallet, /Landed in block/, "wallet: honest send lands");

const failed = results.filter((r) => !r.pass);
await ctx.close();
await browser.close();
if (RECORD) {
  mkdirSync(resolve(ROOT, "docs/demo"), { recursive: true });
  const videos = readdirSync(VIDEO).filter((f) => f.endsWith(".webm"));
  videos.forEach((f, i) => copyFileSync(resolve(VIDEO, f), resolve(ROOT, `docs/demo/page-${i}.webm`)));
  console.log(`saved ${videos.length} page recordings to docs/demo/`);
}
console.log(`${results.length - failed.length}/${results.length} beats passed`);
for (const f of failed) console.log("FAILED", f.beat, f.text);
stop();
process.exit(failed.length ? 1 : 0);

// Records the 3-minute demo on the current site, live on Sepolia: the laptop (the site, built from this checkout) on the left, the
// phone (the offline signer, every network request blocked) on the right. It opens with the recorded attack on Uniswap's real
// interface (contracts/docs/demo/uniswap-interface-attack.mp4), then runs everything else live.
// Writes contracts/docs/demo/verbatim-demo.mp4. Needs the root .env (OWNER1_KEY on the phone, OWNER2_KEY as the laptop's demo key,
// DEMO_EOA_KEY for the ordinary wallet), ffmpeg on PATH, and Sepolia test ETH in the account. Usage: pnpm record-site
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const WORK = resolve(ROOT, "contracts/scripts/e2e/.video-site");
const OUT = resolve(ROOT, "contracts/docs/demo/verbatim-demo.mp4");
const CLIP = resolve(ROOT, "contracts/docs/demo/uniswap-interface-attack.mp4");
const SITE = "http://localhost:5173";
const W = 1280;
const H = 800;
const PW = 400;
const FPS = 5;

const servers: ChildProcess[] = [];
const start = (cmd: string, args: string[], extra: Record<string, string> = {}) => servers.push(spawn(cmd, args, { cwd: ROOT, stdio: "ignore", detached: true, env: { ...process.env, ...extra } }));
const stop = () => servers.forEach((s) => { try { process.kill(-s.pid!); } catch { /* gone */ } });
process.on("exit", stop);
async function waitFor(url: string) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

start("node", ["server/src/index.js"], { PORT: "8787" });
start("pnpm", ["--filter", "@verbatim/web", "dev", "--port", "5173", "--strictPort"]);
start("pnpm", ["--filter", "@verbatim/signer", "exec", "vite", "--port", "5183", "--strictPort"]);
await Promise.all([waitFor("http://localhost:8787/api/config"), waitFor(SITE), waitFor("http://localhost:5183")]);

rmSync(WORK, { recursive: true, force: true });
for (const d of ["site", "phone", "pair", "caps"]) mkdirSync(resolve(WORK, d), { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, permissions: ["clipboard-read", "clipboard-write"] });
const phoneCtx = await browser.newContext({ viewport: { width: PW, height: H }, deviceScaleFactor: 1 });

// ---- the phone: loaded once, then cut off from every network ----
const phone = await phoneCtx.newPage();
await phone.goto("http://localhost:5183");
await phone.route("**/*", (r) => r.abort());
await phone.getByPlaceholder("0x private key").fill(env.OWNER1_KEY);
await phone.getByRole("button", { name: "Import" }).click();
const badge = () =>
  phone.evaluate(() => {
    if (document.getElementById("__air")) return;
    const b = document.createElement("div");
    b.id = "__air";
    b.textContent = "✈  AIRPLANE MODE · offline signer";
    b.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#111;font:700 15px/1 system-ui;padding:10px 14px;text-align:center");
    document.body.style.paddingTop = "40px";
    document.body.append(b);
  });
await badge();

// ---- recording: both screens every tick, kept as pairs ----
let stage: Page | null = null;
let recording = true;
let n = 0;
async function recorder() {
  while (recording) {
    const t = Date.now();
    if (stage) {
      try {
        const id = String(n).padStart(6, "0");
        await Promise.all([stage.screenshot({ path: resolve(WORK, "site", `${id}.jpg`), type: "jpeg", quality: 82 }), phone.screenshot({ path: resolve(WORK, "phone", `${id}.jpg`), type: "jpeg", quality: 82 })]);
        n++;
      } catch { /* mid-navigation */ }
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 / FPS - (Date.now() - t))));
  }
}

let captionText = "";
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
  stage = page;
  await caption(page, text ?? captionText);
}
const hold = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Title cards on their own page, in the site's dark palette.
const card = await ctx.newPage();
async function titleCard(html: string, ms: number) {
  await card.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f2f4f7;font-family:system-ui"><div style="max-width:980px;padding:40px;text-align:center">${html}</div></body>`);
  stage = card;
  await hold(ms);
}

const site = await ctx.newPage();
const results: { beat: string; pass: boolean; text: string }[] = [];

/** The hand-off: QR on the laptop, review and sign on the phone, then the second owner on the laptop. */
async function sign(scope: Locator, deviceCaption = "On the phone, offline: it decodes the sentence itself and shows the guarantees first.") {
  await scope.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 90_000 });
  await scope.getByRole("button", { name: "Copy request" }).scrollIntoViewIfNeeded();
  await hold(2500);
  await scope.getByRole("button", { name: "Copy request" }).click();
  const req = await site.evaluate(() => navigator.clipboard.readText());
  await caption(site, deviceCaption);
  await phone.getByPlaceholder("Scan the request").fill(req);
  await phone.getByRole("button", { name: "Review" }).click();
  const approve = phone.getByRole("button", { name: "Approve and sign" });
  await approve.waitFor({ timeout: 10_000 });
  const shown = await phone.locator(".panel").first().innerText();
  await hold(6000);
  await approve.click();
  const sig = await phone.locator("textarea[readonly]").inputValue();
  await hold(2000);
  await phone.getByRole("button", { name: "Done" }).click();
  await caption(site, "First owner's signature comes back from the phone. Second owner signs on the laptop. Submitting to Sepolia.");
  await scope.getByPlaceholder("VSG1:0x…:0x…").fill(sig);
  await scope.getByRole("button", { name: "Add signature" }).click();
  await scope.getByPlaceholder("0x… owner key").fill(env.OWNER2_KEY);
  await scope.getByRole("button", { name: "Sign with the demo key" }).click();
  return shown;
}

async function outcome(scope: Locator, want: RegExp, beat: string, after: string) {
  const box = scope.locator(".ok, .bad").filter({ hasText: /Rejected in validation|Mined, and the batch reverted|Landed\./ }).last();
  await box.waitFor({ timeout: 240_000 });
  await box.scrollIntoViewIfNeeded();
  const text = (await box.innerText()).replace(/\s+/g, " ");
  const pass = want.test(text);
  results.push({ beat, pass, text: text.slice(0, 220) });
  console.log(`${pass ? "PASS" : "FAIL"} ${beat}: ${text.slice(0, 180)}`);
  await caption(site, pass ? after : `UNEXPECTED (${beat}): ${text.slice(0, 120)}`);
  await hold(7000);
}

const done = recorder();

// ---- 0:45 the side-by-side, live ----
await site.goto(`${SITE}/demo`);
await show(site, "Now live on Sepolia, against Uniswap's official v4 contracts. Left: an ordinary wallet. Right: Verbatim. Same tampered frontend.");
await site.getByRole("button", { name: "Run from an ordinary wallet" }).waitFor({ timeout: 90_000 });
await hold(5000);
await site.getByRole("button", { name: "Run from an ordinary wallet" }).click();
const eoa = site.locator(".result").first();
await eoa.waitFor({ timeout: 240_000 });
await eoa.scrollIntoViewIfNeeded();
const eoaText = (await eoa.innerText()).replace(/\s+/g, " ");
const skimmed = /The hook took/.test(eoaText);
results.push({ beat: "ordinary wallet is skimmed", pass: skimmed, text: eoaText });
console.log(`${skimmed ? "PASS" : "FAIL"} ordinary wallet: ${eoaText}`);
await caption(site, "The ordinary wallet signed. Same quote on screen; the hook took almost all of the output. Nothing on chain noticed.");
await hold(8000);

const verbatim = site.locator(".panel.col").nth(1);
await verbatim.scrollIntoViewIfNeeded();
await caption(site, "Verbatim gets the same bytes. The owners sign the true sentence anyway, on purpose.");
await site.getByRole("button", { name: "Sign the true sentence anyway" }).click();
await hold(3000);
const truth = await sign(verbatim, "The phone shows what the chain will render: NO MINIMUM OUTPUT, HOOK CAN TAKE YOUR OUTPUT, UNVERIFIED HOOK.");
const risky = /NO MINIMUM OUTPUT/.test(truth) && /HOOK CAN TAKE YOUR OUTPUT/.test(truth);
results.push({ beat: "phone shows the risk lines", pass: risky, text: truth.replace(/\s+/g, " ").slice(0, 220) });
console.log(`${risky ? "PASS" : "FAIL"} phone risk lines`);
await outcome(verbatim, /PolicyRefused/, "true sentence, policy refuses", "Even signed by the owners, the chain refuses a no-minimum route through a hook that can take your output. No transaction, no fee.");

await caption(site, "Now the lie: the frontend shows the honest swap and sends the skim.");
await site.getByRole("button", { name: "Sign what the frontend shows" }).click();
// The runner remounts: wait for the previous outcome to go, so the request copied is the new one.
await verbatim.locator(".ok, .bad").filter({ hasText: /Rejected in validation|Mined, and the batch reverted|Landed\./ }).first().waitFor({ state: "detached", timeout: 60_000 });
await hold(3000);
await sign(verbatim, "The phone shows the frontend's sentence, an honest swap. The calldata underneath is the skim.");
await outcome(verbatim, /TreeMismatch|SpecHashMismatch/, "frontend lies, chain re-renders", "The account re-rendered the real calldata and it isn't what was signed. Refused before the mempool.");

// ---- 1:15 the contract tells the truth, then does more ----
await site.goto(`${SITE}/attack`);
await show(site, "Attack us. Each card is a live attack on the Sepolia account; the scoreboard counts what got through.");
await hold(5000);
async function attack(title: string, intro: string, want: RegExp, after: string, signs = true) {
  const art = site.locator("article.attack", { hasText: title });
  await art.scrollIntoViewIfNeeded();
  await caption(site, intro);
  await hold(2500);
  await art.getByRole("button", { name: "Run live" }).click();
  const sheet = site.locator(".sheet");
  if (signs) {
    await sign(sheet);
    await outcome(sheet, want, title, after);
  }
  return sheet;
}
await attack("Approval left standing", "The contract tells the truth, then does more: a true sentence, but the approval would outlive the transaction.", /AssertionFailed/, "Mined, and the batch reverted with AssertionFailed: the chain checked the effect, not the description. Only the fee was paid.");
await site.locator(".sheet").getByRole("button", { name: "Close" }).click();
await attack("Swap the recipient", "Swap the recipient: the owners approve paying verbatim-demo.eth, the calldata pays the attacker.", /TreeMismatch/, "Refused in validation: TreeMismatch. It never reached a block.");
await site.locator(".sheet").getByRole("button", { name: "Close" }).click();
await attack("Unknown router command", "A Uniswap router command no descriptor explains.", /PolicyRefused/, "Refused: the device can't explain it, so the account won't run it.");
await site.locator(".sheet").getByRole("button", { name: "Close" }).click();

// A signature that would last for hours: the phone refuses by its own clock.
const far = await attack("Future-dated expiry", "A signature that stays valid for six hours: durable authority over the account.", /./, "", false);
await far.getByRole("button", { name: "Copy request" }).waitFor({ timeout: 90_000 });
await far.getByRole("button", { name: "Copy request" }).click();
const farReq = await site.evaluate(() => navigator.clipboard.readText());
await phone.getByPlaceholder("Scan the request").fill(farReq);
await phone.getByRole("button", { name: "Review" }).click();
await badge();
const refused = await phone.locator(".err").innerText({ timeout: 10_000 }).catch(() => "");
results.push({ beat: "phone refuses a future-dated sentence", pass: /valid/.test(refused), text: refused });
console.log(`${/valid/.test(refused) ? "PASS" : "FAIL"} phone refuses future expiry: ${refused}`);
await caption(site, "The phone refuses it by its own clock. Signed anyway, the account's policy reverts it with TtlTooLong.");
await hold(7000);
await far.getByRole("button", { name: "Close" }).click();
await site.evaluate(() => window.scrollTo(0, 0));
await caption(site, "Every lie about the sentence dies before the mempool. Every lie about effects reverts. $0 stolen.");
await hold(7000);

// ---- 2:30 why it's deep ----
const big = (v: string, l: string) => `<div><div style="font:800 64px/1 system-ui;color:#8bd3ff">${v}</div><div style="font:500 18px/1.4 system-ui;color:#aab3c0;margin-top:10px">${l}</div></div>`;
await titleCard(
  `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:44px">${big("50 → 0", "pending transactions stopped by a snapshot rotation: paymaster path vs stateless path")}${big("85k / 90k", "transfer gas on the paymaster and stateless paths, under the 100k cap")}${big("4 + 2", "findings on the alt mempool, and two ERC drafts")}</div>`,
  9000,
);
await titleCard(`<div style="font:600 30px/1.45 system-ui">No stake and no global state on the stateless path. ENS is the trust root. URRender is a Uniswap renderer anyone can use.</div>`, 6000);

// ---- at the table: /suites, no wallet needed ----
await site.goto(`${SITE}/suites`);
await show(site, "At the table: the suites. No wallet, no keys in the browser. Press Run and it happens on Sepolia.");
const unattested = site.locator("li.lp-case", { hasText: "Call an unattested contract" });
await unattested.getByRole("button", { name: "Run" }).waitFor({ timeout: 120_000 });
await unattested.scrollIntoViewIfNeeded();
await hold(3000);
await unattested.getByRole("button", { name: "Run" }).click();
await unattested.getByRole("button", { name: "Run again" }).waitFor({ timeout: 240_000 });
await unattested.locator(".lp-run").scrollIntoViewIfNeeded();
const suiteText = (await unattested.innerText()).replace(/\s+/g, " ");
const suiteOk = /PolicyRefused/.test(suiteText);
results.push({ beat: "suites: unattested contract", pass: suiteOk, text: suiteText.slice(-220) });
console.log(`${suiteOk ? "PASS" : "FAIL"} suites unattested`);
await caption(site, "Refused with the account's own error name: PolicyRefused.");
await hold(7000);
await titleCard(`<div style="font:800 46px/1.2 system-ui">The chain is your wallet's screen.</div><div style="font:500 20px/1.5 system-ui;color:#aab3c0;margin-top:18px">verbatim-wallet.vercel.app · every run above is on Sepolia</div>`, 5000);

recording = false;
await done;
await browser.close();
stop();

// ---- assemble ----
// Pairs side by side, idle stretches capped (most raw time is waiting for blocks).
const ids = readdirSync(resolve(WORK, "site")).filter((f) => f.endsWith(".jpg")).sort();
const MAX_STATIC = 6 * FPS;
let last = "";
let run = 0;
let k = 0;
const keep: string[] = [];
for (const f of ids) {
  const h = createHash("md5").update(readFileSync(resolve(WORK, "site", f))).update(readFileSync(resolve(WORK, "phone", f))).digest("hex");
  run = h === last ? run + 1 : 0;
  last = h;
  if (run < MAX_STATIC) keep.push(f);
}
for (const f of keep) {
  copyFileSync(resolve(WORK, "site", f), resolve(WORK, "pair", `s${String(k).padStart(6, "0")}.jpg`));
  copyFileSync(resolve(WORK, "phone", f), resolve(WORK, "pair", `p${String(k++).padStart(6, "0")}.jpg`));
}
const ff = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
};
const LIVE_LIMIT = 150;
const speed = Math.max(1, k / FPS / LIVE_LIMIT);
const live = resolve(WORK, "live.mp4");
ff(["-framerate", String(FPS), "-i", resolve(WORK, "pair", "s%06d.jpg"), "-framerate", String(FPS), "-i", resolve(WORK, "pair", "p%06d.jpg"), "-filter_complex", `[0:v][1:v]hstack=inputs=2,setpts=PTS/${speed.toFixed(3)},fps=25,format=yuv420p[v]`, "-map", "[v]", "-c:v", "libx264", live]);

// The opening: the recorded Uniswap interface attack, sped up, with captions drawn as images (this ffmpeg has no drawtext).
const capBrowser = await chromium.launch();
const capPage = await capBrowser.newPage({ viewport: { width: W + PW, height: H } });
const caps: [number, number, string][] = [
  [0, 7, "Bybit lost $1.5B because signers approved what a tampered screen showed them."],
  [7, 15, "This is Uniswap's real interface, built with a malicious build step. Sepolia, Trading API quote, real router."],
  [15, 24, "The page quotes 0.001 ETH → 26.19 USDC. It looks completely normal. An ordinary wallet signs."],
  [24, 32, "Recorded result (B-UI-eoa): the victim got 0.026, the hook took 2.55. 99% gone. Nothing on chain noticed."],
];
const filters: string[] = [];
let prev = "[base]";
for (const [i, [a, b, t]] of caps.entries()) {
  await capPage.setContent(`<body style="margin:0;background:transparent"><div style="position:fixed;left:0;right:0;bottom:0;background:#111;color:#fff;font:600 21px/1.35 system-ui;padding:14px 22px">${t}</div></body>`);
  await capPage.screenshot({ path: resolve(WORK, "caps", `c${i}.png`), omitBackground: true });
  filters.push(`${prev}[${i + 1}:v]overlay=0:0:enable='between(t,${a},${b})'[o${i}]`);
  prev = `[o${i}]`;
}
await capBrowser.close();
const opening = resolve(WORK, "opening.mp4");
// The clip's useful part is its first ~100 s (connect, quote, review, sign); 3.2x brings it to ~32 s.
ff(["-t", "100", "-i", CLIP, ...caps.flatMap((_, i) => ["-i", resolve(WORK, "caps", `c${i}.png`)]), "-filter_complex", `[0:v]setpts=PTS/3.2,scale=-2:${H},pad=${W + PW}:${H}:(ow-iw)/2:0:white,fps=25,format=yuv420p[base];${filters.join(";")}`, "-map", `${prev}`, "-an", "-c:v", "libx264", opening]);

writeFileSync(resolve(WORK, "list.txt"), `file '${opening}'\nfile '${live}'\n`);
ff(["-f", "concat", "-safe", "0", "-i", resolve(WORK, "list.txt"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT]);
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT], { encoding: "utf8" });
console.log(`saved ${OUT}: ${Number(probe.stdout).toFixed(0)} s (live part ${Math.round(k / FPS)} s after trimming, at ${speed.toFixed(2)}x)`);

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} beats passed`);
for (const f of failed) console.log("FAILED", f.beat, f.text);
process.exit(failed.length ? 1 : 0);

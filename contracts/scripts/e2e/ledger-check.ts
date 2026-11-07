// Runs every runnable row of the proof ledger on the live site, through its own Run buttons, one at a time: devnet rows send their
// frame transaction through the real alt-mempool, Sepolia rows run through ERC-4337. Prints each row's verdict and a summary.
//
//   SITE=https://verbatim-wallet.vercel.app pnpm exec tsx ledger-check.ts            (the default; every runnable row)
//   ... ledger-check.ts A1 B14 S-HONEST                                              (just those rows)
//
// Exit code 1 if any row is not as expected. It spends Sepolia gas from the server's accounts, and takes 30 to 50 minutes.
import { chromium } from "playwright";

const SITE = (process.env.SITE ?? "https://verbatim-wallet.vercel.app").replace(/\/$/, "");
const want = new Set(process.argv.slice(2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60_000);
await page.goto(`${SITE}/demo?runnable=yes#proofs`, { waitUntil: "domcontentloaded" });
await page.locator("#proof-ledger li.proof").first().waitFor({ timeout: 120_000 });
// The Run buttons appear once the server has said what it can run; it may need a minute to wake.
// It asks for the devnet and the Sepolia lists separately, so wait until the count stops growing.
let seen = -1;
for (let i = 0, still = 0; i < 180 && still < 8; i++) {
  const n = await page.locator("#proof-ledger .proof-run").count();
  still = n === seen && n > 0 ? still + 1 : 0;
  seen = n;
  await sleep(1000);
}

const ids = (await page.locator("#proof-ledger li.proof", { has: page.locator(".proof-run") }).locator(".pid").allInnerTexts()).map((s) => s.trim());
const todo = want.size ? ids.filter((id) => want.has(id)) : ids;
console.log(`${ids.length} runnable rows on ${SITE}; running ${todo.length}`);

const results: { id: string; ok: boolean; text: string; secs: number }[] = [];
for (const id of todo) {
  const row = page.locator(`#proof-${id.replace(/[^A-Za-z0-9_-]/g, "\\$&")}`);
  const btn = row.locator(".proof-run");
  await btn.scrollIntoViewIfNeeded();
  for (let i = 0; i < 600 && (await btn.isDisabled()); i++) await sleep(1000); // a Sepolia row waits for the server to be ready
  const t0 = Date.now();
  await btn.click();
  // Done when the verdict shows, or the run reports an error.
  const verdict = row.locator(".lp-verdict-box");
  const failed = row.locator(".lp-run-error");
  await Promise.race([verdict.waitFor({ timeout: 900_000 }), failed.waitFor({ timeout: 900_000 })]).catch(() => {});
  await sleep(500);
  const text = ((await verdict.innerText().catch(() => "")) || (await failed.innerText().catch(() => "")) || "no result").replace(/\s+/g, " ");
  const ok = /as expected/.test(text) && !/not as expected/.test(text);
  const secs = Math.round((Date.now() - t0) / 1000);
  results.push({ id, ok, text, secs });
  console.log(`${ok ? "PASS" : "FAIL"} ${id.padEnd(20)} ${String(secs).padStart(4)}s  ${text.slice(0, 160)}`);
  await sleep(5500); // under the per-minute limits
}
await b.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} rows as expected on ${SITE}`);
for (const r of bad) console.log(`  not as expected: ${r.id}: ${r.text.slice(0, 200)}`);
process.exit(bad.length ? 1 : 0);

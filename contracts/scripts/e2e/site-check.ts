// Drives the site in a real browser, page by page, and runs every live case through its own buttons: what a visitor would do.
// Nothing is mocked: each Run is a real operation on Sepolia through the site's server.
//
//   SITE=https://verbatim-wallet.vercel.app pnpm exec tsx site-check.ts      (the default)
//   SITE=http://localhost:5173 pnpm exec tsx site-check.ts                   (a local build, with the server on :8787)
//   ... site-check.ts --no-runs                                              (pages and checks only, nothing sent)
//
// It runs 13 cases and the 5-step full demo, one after another: about 18 operations and 8 minutes. Exit code 1 if anything fails.
import { chromium, type Locator, type Page } from "playwright";

const SITE = (process.env.SITE ?? "https://verbatim-wallet.vercel.app").replace(/\/$/, "");
const RUNS = !process.argv.includes("--no-runs");
const tty = process.stdout.isTTY;
const c = (n: number) => (s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const green = c(32), red = c(31), dim = c(2), bold = c(1);
const results: { what: string; ok: boolean; note: string }[] = [];
const check = (what: string, ok: boolean, note = "") => {
  results.push({ what, ok, note });
  console.log(`  ${ok ? green("✓") : red("✗")} ${what}${note ? dim(`  ${note}`) : ""}`);
};
/** The site draws "[" and "]" around button labels, and browsers count them in the accessible name. */
const RUN = /^\W*Run\W*$/;
const section = (t: string) => console.log(`\n${bold(t)}`);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 2500) => page.waitForTimeout(ms);
const text = async (l: Locator | Page) => ((await (l === page ? page.locator("body") : (l as Locator)).innerText()) ?? "").replace(/\s+/g, " ");

// ---- every page loads, with one nav bar and four links ----
section("Pages");
for (const path of ["/", "/demo", "/uniswap", "/ens", "/proofs", "/proofs?view=history", "/proofs?id=B-A1"]) {
  errors.length = 0;
  await page.goto(SITE + path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await settle(3500);
  const body = await text(page);
  const nav = await page.locator("header.lp-nav").count();
  const links = path === "/" ? 4 : await page.locator("header.lp-nav .lp-nav-links a").count();
  const failed = /This page failed|Not found/.test(body);
  check(`${path} loads`, !failed && nav === 1 && links === 4 && errors.length === 0, failed ? "the page reports a failure" : errors.length ? `page error: ${errors[0].slice(0, 100)}` : nav !== 1 ? `${nav} nav bars` : links !== 4 ? `${links} nav links` : "");
}
await page.goto(`${SITE}/proofs?id=B-A1`);
await settle(3000);
check("a proof deep link opens its record", /TreeMismatch/.test(await text(page)));
await page.goto(`${SITE}/proofs`);
await settle(2000);
await page.getByRole("tab", { name: "Test history" }).click();
await settle(2500);
check("History & proofs: the history tab", /Test history/.test(await page.locator("h1").first().innerText()));
await page.goto(`${SITE}/suites#skim`);
await settle(2000);
check("old /suites#skim link lands on /uniswap", page.url().includes("/uniswap"));

// ---- ENS: the live checks against Sepolia ----
section("ENS, live on Sepolia");
await page.goto(`${SITE}/ens`);
const pub = page.locator("section", { has: page.getByRole("heading", { name: /Publishers/ }) }).first();
await page.getByText(/is an exclusive publisher/).first().waitFor({ timeout: 90_000 }).catch(() => {});
check("verbatim-demo.eth passes the exclusivity proof", /is an exclusive publisher/.test(await text(page)));
await page.getByRole("button", { name: "verbatim-dem0.eth", exact: true }).first().click();
await page.getByText(/fails:/).first().waitFor({ timeout: 90_000 }).catch(() => {});
const lookalike = await text(page);
check("the lookalike verbatim-dem0.eth is refused", /verbatim-dem0\.eth fails/.test(lookalike) && /WrongResolverCode|RootRolesHeld|NoResolver/.test(lookalike));
await page.getByRole("button", { name: "verbatim-demo.eth", exact: true }).last().click();
await settle(8000);
check("verbatim-demo.eth resolves to its address", /0x3aC4CAf4b6727FdB58A7784630E4689A4331c616/i.test(await text(page)));
void pub;

// ---- every live case, through the page's Run button ----
async function runCases(path: string, label: string) {
  section(`${label}: every case, run for real`);
  await page.goto(SITE + path);
  const cases = page.locator("li.lp-case");
  await cases.first().waitFor({ timeout: 120_000 });
  const ready = page.locator("li.lp-case").first().getByRole("button", { name: RUN });
  await ready.waitFor({ timeout: 120_000 });
  for (let i = 0; i < 120 && (await ready.isDisabled()); i++) await settle(1000); // the server wakes
  const n = await cases.count();
  for (let i = 0; i < n; i++) {
    const li = cases.nth(i);
    const title = (await li.locator("h3").innerText()).trim();
    await li.scrollIntoViewIfNeeded();
    await li.getByRole("button", { name: RUN }).click();
    const done = li.getByRole("button", { name: "Run again" });
    const err = li.locator(".lp-run-error");
    await Promise.race([done.waitFor({ timeout: 300_000 }), err.waitFor({ timeout: 300_000 })]).catch(() => {});
    const t = await text(li);
    const asExpected = /as expected/.test(t) && !/not as expected/.test(t);
    const tx = t.match(/0x[0-9a-f]{6,}…[0-9a-f]{6,} on Etherscan/)?.[0] ?? "no transaction";
    const answer = t.match(/The account’s answer: (\w+)/)?.[1] ?? "";
    check(`${title}`, asExpected, [answer, tx].filter(Boolean).join(" · ") || (await err.count() ? (await err.innerText()).slice(0, 120) : ""));
    await settle(5000); // stays under the server's per-address limit
  }
}
if (RUNS) {
  await runCases("/demo", "Live demo");
  await runCases("/uniswap", "Uniswap");

  section("Live demo: the full demo, in order");
  await page.goto(`${SITE}/demo`);
  const full = page.getByRole("button", { name: "Run the full demo" });
  await full.waitFor({ timeout: 120_000 });
  for (let i = 0; i < 120 && (await full.isDisabled()); i++) await settle(1000);
  await full.scrollIntoViewIfNeeded();
  await full.click();
  await page.getByText(/Full demo finished/).waitFor({ timeout: 900_000 }).catch(() => {});
  const log = page.locator("details.txlog");
  if (!(await log.evaluate((d: HTMLDetailsElement) => d.open))) await log.locator("summary").click();
  const rows = (await log.locator("tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " "));
  const want: [RegExp, RegExp][] = [
    [/Ordinary wallet/, /hook took the output/],
    [/An honest swap/, /landed/],
    [/The frontend lies/, /refused before the mempool.*TreeMismatch/],
    [/A dangerous hook/, /refused before the mempool.*PolicyRefused/],
    [/It does more than it said/, /mined, batch reverted.*AssertionFailed/],
  ];
  for (const [who, what] of want) {
    const row = rows.find((r) => who.test(r)) ?? "";
    check(`full demo · ${who.source.replace(/\\/g, "")}`, what.test(row), row.replace(/^\d\d:\d\d:\d\d /, "").slice(0, 120));
  }
  check("the dropdown lists every run of the full demo", rows.length >= 5, `${rows.length} rows`);
}

await b.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length ? red(bold(`${bad.length} of ${results.length} checks failed`)) : green(bold(`All ${results.length} checks passed`))}  ${dim(SITE)}`);
process.exit(bad.length ? 1 : 0);

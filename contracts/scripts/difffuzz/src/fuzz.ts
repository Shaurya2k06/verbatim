// I8: the Solidity and TypeScript renderers agree on every random case: same bytes, or both refuse.
// Usage: tsx src/fuzz.ts [cases] [firstSeed]
import { render } from "@verbatim/displayvm-ts";
import { boot } from "./harness";
import { makeCase, tsTrust } from "./world";

const N = Number(process.argv[2] ?? 10_000);
const FIRST = Number(process.argv[3] ?? 1);
const CONCURRENCY = 16;

const h = await boot();
const trust = tsTrust();
let agreeOk = 0;
let agreeReject = 0;
const mismatches: { seed: number; ts: string; sol: string }[] = [];

async function one(seed: number) {
  const input = makeCase(seed);
  let ts: { tree: string; spec: string; risk: number } | { error: string };
  try {
    const o = render(input, trust);
    ts = { tree: o.tree, spec: o.spec, risk: o.risk };
  } catch (e) {
    ts = { error: (e as Error).message };
  }
  const sol = await h.render(input);
  if ("error" in ts && "error" in sol) {
    agreeReject++;
  } else if (!("error" in ts) && !("error" in sol) && ts.tree === sol.tree && ts.spec === sol.spec && ts.risk === sol.risk) {
    agreeOk++;
  } else {
    mismatches.push({ seed, ts: JSON.stringify(ts).slice(0, 400), sol: JSON.stringify(sol).slice(0, 400) });
  }
}

let next = FIRST;
const end = FIRST + N;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < end && mismatches.length < 5) await one(next++);
  }),
);
h.stop();
console.log(`cases=${next - FIRST} identical=${agreeOk} bothRefused=${agreeReject} mismatches=${mismatches.length}`);
for (const m of mismatches) console.log(`seed ${m.seed}\n  ts : ${m.ts}\n  sol: ${m.sol}`);
if (agreeOk < (next - FIRST) * 0.2) {
  console.log("too few cases rendered successfully for this run to mean anything");
  process.exit(1);
}
process.exit(mismatches.length ? 1 : 0);

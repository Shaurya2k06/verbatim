// Golden vectors for test/vectors: renders named cases with the TypeScript twin. The Solidity suite must reproduce them.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@verbatim/displayvm-ts";
import { makeCase, tsTrust } from "./world";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/vectors");
mkdirSync(OUT, { recursive: true });
const trust = tsTrust();
const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
const vectors = [];
for (const seed of seeds) {
  const input = makeCase(seed);
  try {
    const o = render(input, trust);
    vectors.push({ seed, input: { ...input, chainId: String(input.chainId), signedAtBlock: String(input.signedAtBlock), ttl: String(input.ttl), feeAmount: String(input.feeAmount), gasLimitTotal: String(input.gasLimitTotal) }, tree: o.tree, spec: o.spec, risk: o.risk });
  } catch {
    continue;
  }
  if (vectors.length === 25) break;
}
writeFileSync(resolve(OUT, "render.json"), JSON.stringify({ vectors }, null, 1) + "\n");
console.log(`wrote ${vectors.length} vectors`);

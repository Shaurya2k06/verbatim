// Golden vectors for test/vectors: renders named cases with the TypeScript twin. The Solidity suite must reproduce them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@verbatim/displayvm-ts";
import { compileFile } from "@verbatim/vdesc-compiler";
import { makeCase, namedCases, tsTrust } from "./world";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/vectors");
mkdirSync(OUT, { recursive: true });
const trust = tsTrust();
const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
const vectors: any[] = [];
const ser = (input: any) => ({ ...input, chainId: String(input.chainId), validUntil: String(input.validUntil), feeAmount: String(input.feeAmount), gasLimitTotal: String(input.gasLimitTotal) });
// One named vector per supported selector and router command.
for (const [name, input] of namedCases()) {
  const o = render(input, trust);
  vectors.push({ name, input: ser(input), tree: o.tree, spec: o.spec, risk: o.risk });
}
for (const seed of seeds) {
  const input = makeCase(seed);
  try {
    const o = render(input, trust);
    vectors.push({ seed, input: ser(input), tree: o.tree, spec: o.spec, risk: o.risk });
  } catch {
    continue;
  }
  if (vectors.length === namedCases().length + 25) break;
}
writeFileSync(resolve(OUT, "render.json"), JSON.stringify({ vectors }, null, 1) + "\n");
// Compiled descriptors for the Solidity coverage tests. $ASSET is resolved to the address those tests expect.
const compiled: Record<string, Record<string, string>> = {};
const ASSET = "0x00000000000000000000000000000000000a55e7";
for (const f of ["weth", "erc4626", "aave-v3-pool", "erc20"]) {
  const text = readFileSync(resolve(OUT, `../../descriptors/${f}.json`), "utf8").replaceAll("$ASSET", ASSET);
  compiled[f.replaceAll("-", "_")] = Object.fromEntries(compileFile(JSON.parse(text)).map((d) => [d.selector, d.vdesc]));
}
writeFileSync(resolve(OUT, "descriptors.json"), JSON.stringify(compiled, null, 1) + "\n");
console.log(`wrote ${vectors.length} vectors`);

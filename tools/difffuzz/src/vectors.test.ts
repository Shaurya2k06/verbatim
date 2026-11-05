import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeTree, formatForDevice, render } from "@verbatim/displayvm-ts";
import { boot } from "./harness";
import { tsTrust } from "./world";

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/vectors/render.json");
const { vectors } = JSON.parse(readFileSync(file, "utf8"));
const revive = (i: any) => ({ ...i, chainId: BigInt(i.chainId), signedAtBlock: BigInt(i.signedAtBlock), ttl: BigInt(i.ttl), feeAmount: BigInt(i.feeAmount), gasLimitTotal: BigInt(i.gasLimitTotal) });

describe("golden vectors", () => {
  it("the TypeScript renderer reproduces them", () => {
    expect(vectors.length).toBeGreaterThan(10);
    for (const v of vectors) {
      const o = render(revive(v.input), tsTrust());
      expect(o.tree).toBe(v.tree);
      expect(o.spec).toBe(v.spec);
    }
  });
  it("the Solidity renderer reproduces them", async () => {
    const h = await boot(18546);
    try {
      for (const v of vectors) {
        const o = await h.render(revive(v.input));
        expect(o).toMatchObject({ tree: v.tree, spec: v.spec, risk: v.risk });
      }
    } finally {
      h.stop();
    }
  }, 120_000);
  it("every rendered tree decodes strictly and displays", () => {
    for (const v of vectors) {
      const t = decodeTree(v.tree);
      expect(t.nodes.length).toBeGreaterThan(0);
      expect(formatForDevice(t).length).toBeGreaterThan(0);
    }
  });
});

// contracts/vectors/snapshot.json: one fixed tree, checked from both sides.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTree, leafHash, spenderLeaf } from "@verbatim/snapshot-cli";
import { ROOT } from "./lib/env";

const leaf = spenderLeaf(1337n, "0x00000000000000000000000000000000000000a1");
const t = buildTree([leaf]);
writeFileSync(resolve(ROOT, "contracts/vectors/snapshot.json"), JSON.stringify({ root: t.root, leafHash: leafHash(leaf), depth: t.depth }, null, 1) + "\n");
console.log(t.root, t.depth);

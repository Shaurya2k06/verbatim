#!/usr/bin/env -S npx tsx
// patch-approve <forge artifact.json>: prints the patched creation code and the patched runtime's hash. Fails unless the runtime holds exactly one LOG1.
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { patchApprove } from "./index";

const path = process.argv[2];
if (!path) {
  console.error("usage: patch-approve <forge artifact.json>");
  process.exit(2);
}
const a = JSON.parse(readFileSync(path, "utf8"));
const p = patchApprove(a.bytecode.object, a.deployedBytecode.object);
console.log(JSON.stringify({ creation: p.creation, runtimeHash: keccak256(p.runtime) }));

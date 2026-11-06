// CI: the account and paymaster must each hold exactly one LOG1 (the one patched into APPROVE), and no DELEGATECALL in the
// account. Prints the patched runtime hashes, which contracts/docs/GAS.md records. Exits non-zero otherwise.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256 } from "viem";
import { findOpcode, patchApprove, toBytes } from "./lib/patch";
import { ROOT } from "./lib/env";

const art = (f: string, n: string) => {
  const j = JSON.parse(readFileSync(resolve(ROOT, `contracts/out/${f}/${n}.json`), "utf8"));
  return { creation: j.bytecode.object, runtime: j.deployedBytecode.object };
};
let bad = false;
for (const [f, n, noDelegate] of [["VerbatimAccount.sol", "VerbatimAccount", true], ["RendererPaymaster.sol", "RendererPaymaster", false]] as const) {
  const a = art(f, n);
  const code = toBytes(a.runtime);
  const log1 = findOpcode(code, 0xa1).length;
  const delegate = findOpcode(code, 0xf4).length;
  const patched = patchApprove(a.creation, a.runtime); // throws unless exactly one LOG1
  const ok = log1 === 1 && (!noDelegate || delegate === 0);
  if (!ok) bad = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${n}: LOG1 ${log1}, DELEGATECALL ${delegate}, patched runtime ${keccak256(patched.runtime)}`);
}
process.exit(bad ? 1 : 0);

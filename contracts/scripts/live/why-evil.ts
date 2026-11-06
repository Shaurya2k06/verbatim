// Why the evil route is refused, from the account itself and not the bundler's generic error. Sepolia, no transaction sent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeErrorResult, parseEther, type Hex } from "viem";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import type { PublishedSnapshot } from "@verbatim/snapshot-cli";
import { v4SwapCall } from "@verbatim/urrender";
import { ROOT, loadEnv } from "./lib/env";
import { artifact } from "./lib/chain";
import { UNI, readS } from "./lib/sepolia";
import { buildOp, validationRevert } from "./lib/userop";

const env = loadEnv();
const s = readS();
const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/snapshot-sepolia.json"), "utf8"));
const ONE = parseEther("0.001");
const swap = (key: unknown, min: bigint) => ({ target: UNI.router, value: ONE, data: v4SwapCall({ key: key as never, zeroForOne: true, amountIn: ONE, amountOutMinimum: min, legacyParams: true }, BigInt(Math.floor(Date.now() / 1000) + 3600)) as Hex });
const abi = artifact("VerbatimAccount4337.sol", "VerbatimAccount4337").abi;
for (const [name, key, min] of [["honest", s.poolEth.key, 2_000_000n], ["evil", s.poolEthEvil.key, 0n]] as const) {
  const b = await buildOp(s.account4337, [swap(key, min)], env.BUNDLER_URL, snap);
  const lines = formatForDevice(decodeTree(b.tree)).filter((l) => l.risk).map((l) => l.text);
  const raw = await validationRevert(b);
  let why = raw === null ? "validation passes" : raw;
  if (raw) {
    try {
      const d = decodeErrorResult({ abi, data: raw });
      why = `${d.errorName}(${(d.args ?? []).join(",")})`;
    } catch {
      /* show raw */
    }
  }
  console.log(name, "| risk", b.risk, "|", lines.join("; ") || "no warnings", "|", why);
}

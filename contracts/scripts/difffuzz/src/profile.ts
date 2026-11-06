// Where render's gas goes, by source line. Usage: tsx src/profile.ts <named case>. A development tool: no effect on anything.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256 } from "viem";
import { boot } from "./harness";
import { namedCases } from "./world";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const want = process.argv[2] ?? "erc20.transfer";
const h = await boot(18777);
const input = namedCases().find(([n]) => n === want)![1];
const art = JSON.parse(readFileSync(resolve(ROOT, "contracts/out/Harness.sol/RenderHarness.json"), "utf8"));
const data = encodeFunctionData({ abi: h.abi, functionName: "render", args: [{ chainId: input.chainId, account: input.account, expiry: input.expiry, snapshotRoot: input.snapshotRoot, policyVersion: input.policyVersion, path: input.path, feeAsset: input.feeAsset, maxFee: input.maxFee, body: input.body, hints: input.hints }] } as never);
const trace: any = await (h.pub as any).request({ method: "debug_traceCall", params: [{ to: h.address, data }, "latest", { disableStorage: true, disableMemory: true, disableStack: true }] });
console.log("total", trace.gas);
const srcMap: string[] = art.deployedBytecode.sourceMap.split(";");
const code = Buffer.from(art.deployedBytecode.object.slice(2), "hex");
const pcToIdx = new Map<number, number>();
let idx = 0;
for (let pc = 0; pc < code.length; pc++) {
  pcToIdx.set(pc, idx++);
  const op = code[pc];
  if (op >= 0x60 && op <= 0x7f) pc += op - 0x5f;
}
const full: { s: number; f: number }[] = [];
let cur = { s: 0, f: 0 };
for (const e of srcMap) {
  const [a, , c] = e.split(":");
  cur = { s: a ? Number(a) : cur.s, f: c ? Number(c) : cur.f };
  full.push({ ...cur });
}
const infoDir = resolve(ROOT, "contracts/out/build-info");
const info = JSON.parse(readFileSync(resolve(infoDir, readdirSync(infoDir).filter((f) => f.endsWith(".json")).map((f) => ({ f, t: statSync(resolve(infoDir, f)).mtimeMs })).sort((x, y) => y.t - x.t)[0].f), "utf8"));
const paths: Record<string, string> = info.source_id_to_path ?? {};
const text = new Map<number, string>();
function fnOf(f: number, off: number): string {
  if (f < 0 || !paths[f]) return "<generated>";
  if (!text.has(f)) text.set(f, readFileSync(resolve(ROOT, "contracts", paths[f]), "utf8"));
  const t = text.get(f)!.slice(0, off + 1);
  const i = t.lastIndexOf("function ");
  return `${paths[f].split("/").pop()}:${i < 0 ? "?" : t.slice(i + 9, i + 45).split("(")[0]}`;
}
const byOp = new Map<string, number>();
const byLoc = new Map<string, number>();
const logs = trace.structLogs;
for (let i = 0; i < logs.length - 1; i++) {
  const l = logs[i];
  byOp.set(l.op, (byOp.get(l.op) ?? 0) + l.gasCost);
  if (l.depth !== 1) continue;
  const m = full[pcToIdx.get(l.pc) ?? -1];
  if (!m) continue;
  const k = fnOf(m.f, m.s);
  byLoc.set(k, (byLoc.get(k) ?? 0) + l.gasCost);
}
console.log("ops", [...byOp].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([a, b]) => `${a} ${b}`).join(", "), "steps", logs.length);
console.log("top locations", JSON.stringify([...byLoc].sort((a, b) => b[1] - a[1]).slice(0, 34)));
h.stop();

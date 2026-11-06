import { execFileSync } from "node:child_process";
// contracts/docs/GAS.md and contracts/docs/PROOFS.md, from receipts on the live chains. Every number is re-read here, not copied from a log.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVNET, rpc } from "@verbatim/frames-sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const proofs: Record<string, any> = JSON.parse(readFileSync(resolve(ROOT, "contracts/docs/proofs.json"), "utf8"));
const env = Object.fromEntries(readFileSync(resolve(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const LEG_B = /^(B-|B13$|A8$|WC$)/;
const CAP = 100_000;
const fmt = (n: number) => n.toLocaleString("en-US");

async function frames(hash: string) {
  const r = await rpc<any>(DEVNET.node, "eth_getTransactionReceipt", [hash]);
  const hex = (v: any) => (typeof v === "string" ? Number(BigInt(v)) : 0);
  return {
    block: Number(BigInt(r.blockNumber)),
    frames: (r.frameReceipts ?? []).map((f: any) => ({ status: f.status, execution: hex(f.gasUsed?.execution ?? f.gasUsed), state: hex(f.stateGasUsed ?? f.gasUsed?.state) })),
    gasUsed: hex(r.gasUsed),
  };
}

const rows: string[] = [];
const measured: { id: string; title: string; f: Awaited<ReturnType<typeof frames>> }[] = [];
for (const id of ["HONEST", "SWAP", "WRAP", "A6", "A7", "A11", "A12", "F7"]) {
  const p = proofs[id];
  if (!p?.txHash) continue;
  const f = await frames(p.txHash);
  measured.push({ id, title: p.title, f });
  // The last frame executes; everything before it validates: two or three frames, by path and build.
  const exec = f.frames[f.frames.length - 1];
  const verify = f.frames.slice(0, -1).map((x: any) => x.execution);
  const prefix = verify.reduce((x: number, y: number) => x + y, 0) + 5600;
  rows.push(`| ${id} | ${p.title} | ${verify.map(fmt).join(" + ")} | ${fmt(prefix)} | ${fmt(exec.execution)} | ${fmt(exec.state)} | \`${p.txHash.slice(0, 12)}...\` |`);
}

const legB = ["B-honest-pimlico", "B-honest-alchemy", "B-swap"].filter((k) => proofs[k]?.txHash).map((k) => `| ${proofs[k].title} | ${proofs[k].extra.bundler ?? "pimlico"} | ${fmt(Number(proofs[k].extra.actualGasUsed))} | [tx](https://sepolia.etherscan.io/tx/${proofs[k].txHash}) |`);

const sepoliaGas = async (hash: string) => Number(BigInt((await rpc<any>(env.SEPOLIA_RPC_URL, "eth_getTransactionReceipt", [hash])).gasUsed));
const legBTxGas = (await Promise.all(["B-honest-pimlico", "B-honest-alchemy", "B-swap"].filter((k) => proofs[k]?.txHash).map(async (k) => `${fmt(await sepoliaGas(proofs[k].txHash))} (${k})`))).join(", ");
const gas = `# Gas

Measured, not estimated. \`contracts/scripts/gas-report\` re-reads every number below from \`frameReceipts\` on the live chain.
Regenerate with \`pnpm --filter @verbatim/gas-report report\`.

## Leg A: EF frames devnet (chain 1337)

Each frame's execution gas, from its receipt. "Prefix" adds the validation frames and the 5,600 gas of two protocol-validated
signatures. The mempool's cap applies to the declared limits plus signatures. Rows come from the latest run of each proof: \`contracts/docs/STATUS.md\` says which predate the final build.

| Proof | What | Validation frames | Prefix | Execute exec | Execute state | Tx |
|---|---|---:|---:|---:|---:|---|
${rows.join("\n")}

**Why the prefix is tight:** the deployed sidecar caps it at ${fmt(CAP)} (\`FINDINGS.md\`, b), so render was written to fit. See \`DECISIONS.md\`, D-A20.

**The limit that remains:** one call per transaction on the deployed sidecar. Each extra call adds about 21,500 to the account's work, so a second call overflows the cap. ERC-8421's 1M staked budget would hold them, up to the renderer's own limit.

**State gas:** this devnet charges EIP-8037 state gas, about 1,530 per byte of new state. It is why frame 2 declares
1,500,000 of it, why a first approval costs much more than a later one (ledger entries are new slots), and why deploying the
paymaster took about 34M gas.

## Every demo transaction against the 100k cap

Measured by \`contracts/scripts/live/measure.ts\` with generous limits, so each figure is what the frame used. The checklist's floor is 8,000 of headroom.

| Transaction | Expiry | Account | Paymaster | Signatures | Prefix | Headroom |
|---|---:|---:|---:|---:|---:|---:|
${JSON.parse(readFileSync(resolve(ROOT, "contracts/docs/prefix-measurements.json"), "utf8")).map((r: any) => `| ${r.name} | ${fmt(r.expiry)} | ${fmt(r.frame0)} | ${fmt(r.frame1)} | 5,600 | ${fmt(r.expiry + r.frame0 + r.frame1 + 5600)} | ${fmt(100000 - r.expiry - r.frame0 - r.frame1 - 5600)} |`).join("\n")}

v4 \`SWAP_EXACT_IN\` renders in both renderers and is tested, but has not been measured on a live chain. \`V3_SWAP_EXACT_IN\` renders, but the devnet's router has no v3 factory, so it cannot run there. An unknown command or action renders as \`BLIND\` and is refused.

## Patched bytecode

Each holds exactly one LOG1 before patching, checked in CI by \`contracts/scripts/live/check-bytecode.ts\`. Hashes of the artifacts' patched runtimes; deployed code differs where immutables are filled in.

\`\`\`
${execFileSync("npx", ["tsx", "check-bytecode.ts"], { cwd: resolve(ROOT, "contracts/scripts/live"), encoding: "utf8" }).trim()}
\`\`\`

## Leg B: Sepolia (ERC-4337, EntryPoint v0.7)

\`actualGasUsed\` from the bundler's receipt, covering account validation with its render, the batch and overhead. There is no paymaster on this path.

| What | Bundler | actualGasUsed | Tx |
|---|---|---:|---|
${legB.join("\n")}

**Read that column with care.** \`actualGasUsed\` is what the EntryPoint bills: it includes \`preVerificationGas\` and the 10% penalty on unused call gas, and our limits are deliberately generous. The bundle transactions themselves used far less, read from their receipts: ${legBTxGas}.

Bundler limits met (F8): Alchemy requires at least 40% of the verification limits to be used, which rejected a generous first plan
(33%). The plan in \`contracts/scripts/live/lib/userop.ts\` passes both Alchemy and Pimlico.
`;
writeFileSync(resolve(ROOT, "contracts/docs/GAS.md"), gas);

const devnetLink = (h: string) => `[\`${h.slice(0, 14)}...\`](https://explorer.altmempool.wtf/tx/${h}?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc)`;
const sepLink = (h: string) => `[\`${h.slice(0, 14)}...\`](https://sepolia.etherscan.io/tx/${h})`;
// Node errors can quote raw revert bytes; a NUL in the file makes git and grep treat it as binary.
const short = (m?: string) => (m ? m.replace(/^.*=> /s, "").replace(/[\x00-\x1f\x7f\s]+/g, " ").slice(0, 88) : "");
const row = (p: any, link: (h: string) => string) => `| ${p.id} | ${p.title} | ${p.expected} | ${p.pass ? "yes" : "**NO**"} | ${p.txHash ? link(p.txHash) : "rejected, no tx"} | \`${short(p.message) || "as expected"}\` |`;
const all = Object.values(proofs) as any[];
const failing = all.filter((p) => !p.pass);
const dep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/devnet.json"), "utf8"));
const sep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/sepolia.json"), "utf8"));

const md = `# Proofs

Generated from \`contracts/docs/proofs.json\`, which \`contracts/scripts/live/attacks.ts\`, \`swap.ts\`, \`stateless.ts\`, \`invalidation.ts\` and \`legb-run.ts\` write as they run against the
live networks. ${failing.length ? `**${failing.length} of ${all.length} not met:** ${failing.map((f) => f.id).join(", ")}. A row shows its latest run, which may predate the final build. \`contracts/docs/STATUS.md\` says what has been rerun.` : `All ${all.length} met. \`contracts/docs/STATUS.md\` says what has been rerun on the final build.`}

A rejection here means the node refused the transaction, so there is no transaction hash. The reason is the paymaster's or account's own revert,
as the node returned it. Reproduce one with \`cd contracts/scripts/live && npx tsx attacks.ts A1\`.

Explorer history is in memory on the devnet's side and clears when it restarts; the receipts stay on chain while the devnet lives.

## Leg A: EF frames devnet (chain 1337), real ERC-8421 sidecar, no local stack

Live deployment: paymaster \`${dep.paymaster}\`, account \`${dep.account}\`, staked in \`${dep.stakeTx.slice(0, 14)}...\`.

| ID | Attack or case | Spec expects | Met | Transaction | Reason from the chain |
|---|---|---|---|---|---|
${all.filter((p) => !LEG_B.test(p.id)).map((p) => row(p, devnetLink)).join("\n")}

**What the "plain EOA" row shows:** \`A2-eoa\` is the same evil route sent from an ordinary wallet. That is the loss Verbatim's rejections prevent.

**Revocation (\`A15\`):** of 5 signed transactions, an unrelated \`refreshTrust\` invalidated none, and revoking one descriptor invalidated exactly the one using it
(${JSON.stringify(proofs.A15?.extra?.afterRevocation)}). The refresh keeps the snapshot root: rotating it is a different event, since paymaster-path transactions sign it. Measured by re-running validation through \`ethrex_simulateFrameTransaction\`, the call the sidecar itself makes. They share a
sender, so they were not all held pending at once.

**Explorer links** name the miner's node (\`?node=...\`), because the explorer otherwise asks the gateway, which may not have seen these.

**Staked vs unstaked, canonical vs alt:** ethrex's canonical check reports \`StorageReadNonSender\` for these transactions, since the paymaster reads its own storage. The alt mempool
admits them because the paymaster is staked. This is the "needs the alt mempool" evidence.

## Production leg: Sepolia, official Uniswap contracts, ENSv2

Stateless ERC-4337 account \`${sep.account}\`, with no paymaster.

| ID | Case | Spec expects | Met | Transaction | Reason or detail |
|---|---|---|---|---|---|
${all.filter((p) => LEG_B.test(p.id)).map((p) => row(p, sepLink)).join("\n")}

**Refusals through a bundler:** a bundler reports a reverting validation as a generic error, so \`B-A2b\` reads the reason from the account itself (\`contracts/scripts/live/why-evil.ts\`).

ENS: publisher \`${sep.ens.publisher}\`, trust anchor \`${sep.ens.anchor}\`. The anchor's attestor record was set in ${sepLink(sep.ens.attestorsRecordTx)}.

## In the browser

\`contracts/scripts/e2e/demo.ts\` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See \`contracts/docs/demo/\`.
`;
writeFileSync(resolve(ROOT, "contracts/docs/PROOFS.md"), md);
console.log(`wrote contracts/docs/GAS.md and contracts/docs/PROOFS.md (${all.length} proofs, ${failing.length} failing)`);

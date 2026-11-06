// Publishes the repo's evidence with the build: deployments, proofs, render vectors and registry coverage are copied
// into public/data, so the site reads them at runtime and never carries an address of its own.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../public/data");
mkdirSync(join(out, "deployments"), { recursive: true });

const deployments = readdirSync(join(repo, "deployments")).filter((f) => f.endsWith(".json"));
for (const f of deployments) copyFileSync(join(repo, "deployments", f), join(out, "deployments", f));

const files = { "docs/proofs.json": "proofs.json", "docs/registry-failures.json": "registry-failures.json", "test/vectors/render.json": "render-vectors.json" };
for (const [from, to] of Object.entries(files)) copyFileSync(join(repo, from), join(out, to));

// Documents the site renders: the standards page, the mempool lab and the bounty terms.
mkdirSync(join(out, "docs"), { recursive: true });
const docs = {
  "docs/GAS.md": "GAS.md", "docs/ALTMEMPOOL.md": "ALTMEMPOOL.md", "docs/FINDINGS.md": "FINDINGS.md", "docs/UPSTREAM.md": "UPSTREAM.md", "docs/BOUNTY.md": "BOUNTY.md",
  "docs/prefix-measurements.json": "prefix-measurements.json", "docs/erc/sentence-bound-frame-transactions.md": "erc-sentence-bound-frame-transactions.md",
  "docs/erc/signed-attestation-snapshots.md": "erc-signed-attestation-snapshots.md", "packages/frame-tools/README.md": "frame-tools.md", "packages/urrender/README.md": "urrender.md",
};
for (const [from, to] of Object.entries(docs)) if (existsSync(join(repo, from))) copyFileSync(join(repo, from), join(out, "docs", to));

// Which descriptors carry hand-written effects (an x-verbatim section), the part ERC-7730 cannot express.
const descriptors = readdirSync(join(repo, "descriptors")).filter((f) => f.endsWith(".json")).map((f) => {
  const j = JSON.parse(readFileSync(join(repo, "descriptors", f), "utf8"));
  const formats = Object.entries(j.display?.formats ?? {});
  return { file: f, owner: j.metadata?.owner ?? null, functions: formats.map(([sig, v]) => ({ sig, intent: v.intent ?? null, effects: !!v["x-verbatim"]?.effects })) };
});
writeFileSync(join(out, "descriptors.json"), JSON.stringify(descriptors, null, 1) + "\n");

const registryMd = readFileSync(join(repo, "docs/REGISTRY.md"), "utf8");
const m = registryMd.match(/\*\*(\d+) of (\d+) function descriptors compile/);
const failures = JSON.parse(readFileSync(join(repo, "docs/registry-failures.json"), "utf8"));

let commit = "unknown";
let dirty = false;
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim();
  dirty = execSync("git status --porcelain -- docs/proofs.json deployments", { cwd: repo }).toString().trim() !== "";
} catch {
  // Not a git checkout: hosted builds name the commit in the environment instead.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.COMMIT_REF;
  if (sha) commit = sha.slice(0, 7);
}

writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    {
      commit,
      dirty,
      builtAt: new Date().toISOString(),
      deployments: deployments.filter((f) => !f.startsWith("snapshot-")),
      snapshots: deployments.filter((f) => f.startsWith("snapshot-")),
      registry: m ? { compiled: Number(m[1]), total: Number(m[2]), failures: failures.length } : null,
    },
    null,
    1,
  ) + "\n",
);
console.log(`sync-data: ${deployments.length} deployment files, proofs, vectors, commit ${commit}${dirty ? " (evidence files modified)" : ""}`);
if (!existsSync(join(out, "proofs.json"))) process.exit(1);

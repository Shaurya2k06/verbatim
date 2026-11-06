// The audit's honesty rule (P0-4): every claim says what kind of evidence stands behind it.
//
// proofs.json does not yet record a leg or a build per row, so both are derived here, from what docs/STATUS.md and the README
// state: Sepolia rows ran on the final code; the frames devnet stopped during the final build, so its rows are from older builds.
// A row that carries its own `leg` or `evidence` field wins over this table. Have the proof scripts write those fields, then
// delete the table.

export const EVIDENCE = {
  final: { label: "LIVE · final build", tone: "ok", note: "Ran on a live network, on the code this site describes." },
  older: { label: "LIVE · older build", tone: "warn", note: "Ran on a live network, on an earlier build. Pending a rerun." },
  foundry: { label: "FOUNDRY", tone: "info", note: "Proven in the Foundry test suite, not on a live network." },
  local: { label: "LOCAL DEVNET", tone: "info", note: "Ran on a local devnet, not a public one." },
};

const SEPOLIA_ROWS = new Set(["A8", "B13", "WC"]);
const DEVNET_B_ROWS = new Set(["B12", "B14"]); // stateless-path cases on the frames devnet, despite the B prefix

export function legOf(row) {
  if (row.leg) return row.leg;
  if (SEPOLIA_ROWS.has(row.id)) return "sepolia";
  if (row.id.startsWith("B") && !DEVNET_B_ROWS.has(row.id)) return "sepolia";
  return "devnet";
}

export function evidenceOf(row) {
  if (row.evidence && EVIDENCE[row.evidence]) return row.evidence;
  return legOf(row) === "sepolia" ? "final" : "older";
}

export const OUTCOME = {
  mined: "mined",
  "reverted-in-batch": "mined; batch reverted",
  "rejected-at-mempool": "rejected before the mempool",
  "not-run": "not run",
};

/** Is this row an attack (something Verbatim must stop) rather than an honest baseline or a probe? */
export const isAttack = (row) => groupOf(row.id) !== "baseline" && groupOf(row.id) !== "probes";

export const GROUPS = {
  sentence: "Sentence lies",
  trust: "Trust lies",
  freshness: "Freshness and replay",
  effects: "Effects",
  fees: "Fees and griefing",
  baseline: "Honest baselines",
  probes: "Probes",
};

const GROUP_OF = {
  sentence: ["A1", "A2", "A2b", "A3", "A3b", "A4", "A4b", "A16", "A17", "A17b", "B-A1", "B-A2b"],
  trust: ["A5", "A8", "A10", "A15", "INVALIDATION", "B13", "B-ens-revoked", "B3", "B5", "B7", "B9"],
  freshness: ["A7", "A7b", "A13", "B12"],
  effects: ["A6", "A11", "A12", "A18", "B14"],
  fees: ["A9", "A14", "F7"],
  baseline: ["HONEST", "SWAP", "WRAP", "A2-eoa", "B-A2-eoa", "B-honest-pimlico", "B-honest-alchemy", "B-swap", "B-multihop", "WC"],
};
const GROUP_INDEX = Object.fromEntries(Object.entries(GROUP_OF).flatMap(([g, ids]) => ids.map((id) => [id, g])));

export function groupOf(id) {
  if (GROUP_INDEX[id]) return GROUP_INDEX[id];
  if (id.startsWith("G0") || id.startsWith("CANONICAL")) return "probes";
  return "trust";
}

/** The rows of proofs.json as an array, with derived fields attached. */
export function rows(proofs) {
  return Object.values(proofs).map((r) => ({ ...r, leg: legOf(r), evidence: evidenceOf(r), group: groupOf(r.id) }));
}

export function summary(list) {
  const s = { total: list.length, met: 0, notMet: 0, notRun: 0, attacksMetByEvidence: {}, attacks: 0, attacksMet: 0, admitted: 0, rejected: 0 };
  for (const r of list) {
    if (r.outcome === "not-run") s.notRun++;
    else if (r.pass) s.met++;
    else s.notMet++;
    if (isAttack(r)) {
      s.attacks++;
      if (r.pass) {
        s.attacksMet++;
        s.attacksMetByEvidence[r.evidence] = (s.attacksMetByEvidence[r.evidence] ?? 0) + 1;
      }
    }
    if (r.outcome === "mined" || r.outcome === "reverted-in-batch") s.admitted++;
    if (r.outcome === "rejected-at-mempool") s.rejected++;
  }
  return s;
}

/** The decoded error name in a proof message, when there is one. */
export function errorName(message = "") {
  const m = message.match(/\b([A-Z][A-Za-z0-9]+)\(/g);
  if (!m) return null;
  const skip = new Set(["Error", "Internal"]);
  const names = m.map((x) => x.slice(0, -1)).filter((x) => !skip.has(x));
  return names.at(-1) ?? null;
}

// One swap, followed from the click to the block. The server really runs the case on Sepolia (the same runner as /suites); this
// component lays what comes back along the six phases of the design. Nothing here is sample data: every hash is computed from the
// tree bytes the run returned, every sentence is decoded from them by displayvm-ts, and every number is read from the chain.
import { useEffect, useRef, useState } from "react";
import { keccak256 } from "viem";
import { decodeTree, specOf } from "@verbatim/displayvm-ts";
import { apiGet, apiPost } from "../lib/api";
import { Pill } from "./Badge";
import { Sentence, linesOf } from "./Sentence";
import "./lifecycle.css";

const SCENARIOS = [
  { key: "honest", case: "honest-swap", label: "An honest swap", blurb: "Nothing is wrong. This is the path every guarantee is built to let through." },
  { key: "lie", case: "tampered-swap", label: "The frontend lies", blurb: "The page shows an honest swap and sends a minimum output of 0 through a hook that takes the output." },
  { key: "hook", case: "skim-true", label: "A dangerous hook", blurb: "The sentence is true: it says exactly what the route does. The policy is what says no." },
  { key: "effects", case: "standing-approval", label: "It does more than it said", blurb: "The sentence is accurate and admitted. The transaction leaves an approval standing, so the chain checks the effect and undoes it." },
];

const PHASES = [
  { id: "A", name: "Preparation", note: "Decode the bytes, build the sentence, derive the guarantees." },
  { id: "B", name: "Authorization", note: "The owners sign a digest that commits to both." },
  { id: "C", name: "Packaging", note: "The signed operation is built for the chain." },
  { id: "D", name: "Validation", note: "Before admission, the chain re-renders the real calldata and compares." },
  { id: "E", name: "Execution", note: "The protected call runs, then the guarantees are measured." },
  { id: "F", name: "Result", note: "Which checkpoint decided." },
];

const short = (h, n = 10) => (h && h.length > 2 * n + 4 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const safe = (f, fallback = null) => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

/** Everything derivable from the sentence bytes alone. */
function facts(tree) {
  if (!tree) return null;
  return safe(() => {
    const decoded = decodeTree(tree);
    const spec = specOf(decoded);
    return {
      bytes: (tree.length - 2) / 2,
      treeHash: keccak256(tree),
      specBytes: (spec.length - 2) / 2,
      specHash: keccak256(spec),
      guarantees: linesOf(tree).filter((l) => l.guarantee).map((l) => l.text),
      risks: linesOf(tree).filter((l) => l.risk).map((l) => l.text),
      expiry: decoded.expiry,
    };
  });
}

/** Where in the design the run stopped, from the account's own answer. */
function checkpoint(run) {
  const o = run?.outcome;
  if (!o) return null;
  if (o.kind === "landed") return { n: 0, text: "All three checkpoints passed. The user received what they signed, with every guarantee measured." };
  if (o.kind === "rejected" && /TreeMismatch|SpecHashMismatch|SignersNotSortedOrUnknown/.test(o.name ?? o.raw ?? "")) return { n: 1, text: "Checkpoint 1: did the user sign the correct meaning? The chain re-rendered the real calldata, got a different sentence than the one signed, and refused before admission." };
  if (o.kind === "rejected") return { n: 2, text: "Checkpoint 2: are the interpretation and trust rules satisfied? The sentence is accurate, and the policy refused it before admission." };
  if (o.kind === "reverted") return { n: 3, text: "Checkpoint 3: did it deliver what it promised? The transaction was admitted and mined, the guarantee failed, and the protected effects were rolled back." };
  if (o.kind === "device-refused") return { n: 2, text: "The offline device refused to sign, so nothing was sent." };
  return { n: -1, text: "The run did not reach a result." };
}

/** pending | active | done | stopped, per phase, from how far the run got. */
function statuses(run) {
  const s = Object.fromEntries(PHASES.map((p) => [p.id, "pending"]));
  if (!run) return s;
  const o = run.outcome;
  const set = (ids, v) => ids.forEach((i) => (s[i] = v));
  if (run.status === "queued") return s;
  set(["A"], run.claimed ? "done" : "active");
  if (run.claimed) set(["B"], run.signers?.length || o?.kind === "device-refused" ? "done" : "active");
  if (run.signers?.length) set(["C"], "done");
  if (run.signers?.length) set(["D"], run.userOpHash || o?.kind === "rejected" || run.status === "done" ? (o?.kind === "rejected" ? "stopped" : "done") : "active");
  if (run.userOpHash) set(["E"], run.status === "done" ? (o?.kind === "reverted" ? "stopped" : "done") : "active");
  if (run.status === "done") set(["F"], o?.kind === "landed" ? "done" : "stopped");
  if (o?.kind === "device-refused") set(["B"], "stopped");
  return s;
}

function Card({ phase, status, children }) {
  return (
    <section className={`lc-phase is-${status}`} aria-label={`Phase ${phase.id}: ${phase.name}`}>
      <header>
        <span className="lc-id">{phase.id}</span>
        <div>
          <h3>{phase.name}</h3>
          <p className="muted small">{phase.note}</p>
        </div>
        <Pill tone={status === "done" ? "ok" : status === "stopped" ? "bad" : status === "active" ? "warn" : undefined}>{{ pending: "waiting", active: "now", done: "done", stopped: "stopped here" }[status]}</Pill>
      </header>
      {status === "pending" ? null : <div className="lc-body">{children}</div>}
    </section>
  );
}

const Row = ({ k, children }) => (
  <>
    <span>{k}</span>
    <span>{children}</span>
  </>
);

export function Lifecycle({ onTx }) {
  const [which, setWhich] = useState("honest");
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const scenario = SCENARIOS.find((s) => s.key === which);

  useEffect(() => {
    alive.current = true;
    apiGet("/suites")
      .then((x) => alive.current && setInfo(x))
      .catch((e) => alive.current && setErr(e.message));
    return () => {
      alive.current = false;
    };
  }, []);

  const pick = (k) => {
    if (busy) return;
    setWhich(k);
    setRun(null);
    setErr(null);
  };

  /** Runs one server case to the end and returns the final run. `show` puts it on the phase cards as it goes. */
  const runCase = async (caseId, show, label) => {
    let r = await apiPost("/suites/run", { case: caseId });
    if (show) setRun(r);
    let failures = 0;
    while (alive.current && r.status !== "done") {
      await new Promise((res) => setTimeout(res, 1500));
      try {
        r = await apiGet(`/suites/run/${r.id}`);
        failures = 0;
        if (show) setRun(r);
      } catch (e) {
        if (++failures >= 5) throw new Error(`lost contact with the server: ${e.message}. The operation may still have run, so check the account on Etherscan`, { cause: e });
      }
    }
    const k = r.outcome?.kind;
    onTx?.({ label, kind: k, txHash: r.txHash ?? undefined, userOpHash: r.userOpHash, block: r.block ?? undefined, gas: r.gasUsed ?? undefined, error: k === "rejected" ? r.outcome.name ?? undefined : k === "reverted" ? r.outcome.name ?? undefined : undefined });
    return r;
  };

  const go = async () => {
    setBusy(true);
    setErr(null);
    setRun(null);
    try {
      await runCase(scenario.case, true, scenario.label);
    } catch (e) {
      setErr(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  /** The whole demo in order: the ordinary wallet first, then each way it can go wrong, and the honest swap that lands. */
  const FULL = [
    { case: "ordinary-wallet", label: "Ordinary wallet, tampered frontend" },
    ...SCENARIOS.map((s) => ({ case: s.case, label: s.label, key: s.key })),
  ];
  const [full, setFull] = useState(null);
  const goFull = async () => {
    setBusy(true);
    setErr(null);
    try {
      for (const [i, step] of FULL.entries()) {
        setFull({ at: i, of: FULL.length, label: step.label });
        if (step.key) {
          setWhich(step.key);
          setRun(null);
        }
        await runCase(step.case, Boolean(step.key), step.label);
        if (!alive.current) return;
        await new Promise((res) => setTimeout(res, 4000)); // the server's per-address limit, and a breath between runs
      }
      setFull({ at: FULL.length, of: FULL.length, label: "done" });
    } catch (e) {
      setErr(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const st = statuses(run);
  const signed = facts(run?.claimed);
  const real = facts(run?.actual ?? run?.claimed);
  const lied = run?.actual && run.actual !== run.claimed;
  const cp = run?.status === "done" ? checkpoint(run) : null;
  const o = run?.outcome;
  const explorer = info?.explorer ?? "https://sepolia.etherscan.io";

  return (
    <section className="panel lifecycle" id="lifecycle">
      <h2>Follow one swap, from the click to the block</h2>
      <p className="lede">
        Pick what goes wrong, and run it. The server builds a real swap through Uniswap’s official router on Sepolia, the owners sign, and the chain decides. Each phase below fills in from what actually happened.
      </p>
      <div className="lc-tabs" role="tablist">
        {SCENARIOS.map((s) => (
          <button key={s.key} role="tab" aria-selected={s.key === which} className={s.key === which ? "primary" : ""} onClick={() => pick(s.key)} disabled={busy}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="small">{scenario.blurb}</p>
      <div className="row">
        <button className="primary" onClick={go} disabled={busy || !info?.ready}>
          {busy ? "Running on Sepolia…" : run ? "Run it again" : "Run this on Sepolia"}
        </button>
        <button onClick={goFull} disabled={busy || !info?.ready} title="Runs the ordinary wallet and all four scenarios, one after another, and lists every transaction in the dropdown at the top">
          Run the full demo
        </button>
        {full && busy ? (
          <span className="muted small">
            Full demo, step {full.at + 1} of {full.of}: {full.label}
          </span>
        ) : full?.label === "done" ? (
          <span className="small ok">Full demo finished. Every transaction is in “All transactions from this demo” at the top of the page.</span>
        ) : null}
        {info && !info.ready ? <span className="muted small">Runs are off: {info.why}.</span> : null}
        {!info && !err ? <span className="muted small">Waking the server (the first request after a quiet spell can take a minute)…</span> : null}
        {run?.status === "queued" ? <span className="muted small">Waiting for the account, position {run.position} in line.</span> : null}
      </div>
      {err ? <div className="bad">{err}</div> : null}

      <div className="lc-flow">
        <Card phase={PHASES[0]} status={st.A}>
          <ol className="lc-steps">
            <li>
              <strong>The frontend builds Universal Router calldata.</strong> It is untrusted: it may show one thing and encode another.
            </li>
            <li>
              <strong>URRender decodes the bytes</strong>, not the frontend’s description of them. This is what the calldata really does:
              {real ? <Sentence tree={run.actual ?? run.claimed} /> : null}
            </li>
            <li>
              <strong>VTREE, then its hash.</strong>
              {signed ? (
                <div className="kv">
                  <Row k="Sentence the owners were shown">{signed.bytes} bytes</Row>
                  <Row k="treeHash">
                    <code>{signed.treeHash}</code>
                  </Row>
                  {lied && real ? (
                    <>
                      <Row k="What the calldata really renders to">
                        <code>{real.treeHash}</code>
                      </Row>
                      <Row k="Equal?">
                        <span className="neg">No. This is exactly what the chain compares.</span>
                      </Row>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
            <li>
              <strong>VSPEC is derived from the tree.</strong> It is the tree’s GUARANTEE section, byte for byte, so a host cannot show strong guarantees and send weaker ones.
              {signed ? (
                <>
                  <ul className="lc-guarantees">
                    {signed.guarantees.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                  <div className="kv">
                    <Row k="specHash">
                      <code>{signed.specHash}</code>
                    </Row>
                  </div>
                </>
              ) : null}
              {real?.risks.length ? (
                <div className="lc-risks">
                  <p className="muted small">Risks found in the calldata itself:</p>
                  {real.risks.map((r) => (
                    <div key={r} className="s-risk">
                      {r}
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          </ol>
        </Card>

        <Card phase={PHASES[1]} status={st.B}>
          {run?.deviceRefused ? <div className="bad">The offline device refused: {run.deviceRefused}.</div> : null}
          <p className="small">
            The owner’s device decodes the sentence itself and signs an EIP-712 digest committing to <code>treeHash</code>, <code>specHash</code>, the expiry, the snapshot root, the path and <code>txCommit</code> (which pins the transaction’s whole structure, so no frame can be added).
          </p>
          {run?.signers?.length ? (
            <div className="kv">
              <Row k="Signed by">
                {run.signers.map((a) => (
                  <a key={a} href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer">
                    {short(a, 6)} ↗{" "}
                  </a>
                ))}
              </Row>
              <Row k="Threshold">2 of 3 owners</Row>
              {signed?.expiry ? <Row k="Valid until">{new Date(Number(signed.expiry) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC</Row> : null}
            </div>
          ) : null}
        </Card>

        <Card phase={PHASES[2]} status={st.C}>
          <p className="small">
            On Sepolia this is an ERC-4337 user operation through the EntryPoint. The same sentence and guarantees ride in an EIP-8141 frame transaction on the devnet, with the layout locked so nothing can be inserted.
          </p>
          <div className="kv">
            {run?.nonce ? <Row k="Account nonce">{run.nonce}</Row> : null}
            <Row k="Account">
              <a href={`${explorer}/address/${info?.account}`} target="_blank" rel="noreferrer">
                {short(info?.account, 6)} ↗
              </a>
            </Row>
          </div>
        </Card>

        <Card phase={PHASES[3]} status={st.D}>
          <p className="small">
            Validation runs before anything is paid for. The account reads the real calldata, renders it again, recomputes both hashes and the owner digest, and compares them with what was signed. Then the policy is applied.
          </p>
          {o?.kind === "rejected" ? (
            <div className="bad">
              Refused before the mempool{o.name ? <>: the account says <code>{o.name}</code></> : null}
              {o.human ? `. ${o.human.replace(/\.$/, "")}` : ""}. It never reached a block.
            </div>
          ) : run?.userOpHash ? (
            <div className="ok">
              Admitted by the bundler. <code>{short(run.userOpHash, 12)}</code>
            </div>
          ) : o?.kind === "device-refused" ? null : (
            <div className="muted">Checking…</div>
          )}
        </Card>

        <Card phase={PHASES[4]} status={st.E}>
          <p className="small">
            The account snapshots the balances the guarantees name, runs the router call, then asserts each guarantee against the real result. If one fails, the protected call is rolled back and only the fee stays paid.
          </p>
          {run?.deltas?.length ? (
            <table className="lc-table">
              <thead>
                <tr>
                  <th>Measured</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {run.deltas.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    <td>
                      {d.before} {d.unit}
                    </td>
                    <td className={d.changed ? "neg" : ""}>
                      {d.after} {d.unit} {d.changed ? "" : "(unchanged)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {o?.kind === "landed" ? <div className="ok">Mined. Every guarantee held.</div> : null}
          {o?.kind === "reverted" ? (
            <div className="bad">
              Mined, and the batch reverted{o.name ? <>: <code>{o.name}</code></> : null}. Everything was undone.
            </div>
          ) : null}
          {run?.txUrl ? (
            <p className="small">
              <a href={run.txUrl} target="_blank" rel="noreferrer">
                Transaction {short(run.txHash, 8)} on Etherscan ↗
              </a>
              {run.block ? ` · block ${run.block}` : ""}
              {run.gasUsed ? ` · ${Number(run.gasUsed).toLocaleString("en-US")} gas` : ""}
            </p>
          ) : null}
        </Card>

        <Card phase={PHASES[5]} status={st.F}>
          {cp ? <div className={cp.n === 0 ? "ok" : "callout"}>{cp.text}</div> : null}
          {run?.status === "done" && run.asExpected === false ? <div className="bad">This did not behave as expected for this scenario.</div> : null}
          {run?.steps?.length ? (
            <details>
              <summary>The server’s log of this run</summary>
              <ol className="lc-log">
                {run.steps.map((s, i) => (
                  <li key={i} className={s.tone ? `is-${s.tone}` : undefined}>
                    <span>{(((s.at ?? 0) - (run.startedAt ?? run.createdAt)) / 1000).toFixed(1)}s</span> {s.text}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </Card>
      </div>
      <p className="small muted">
        The one thing to hold on to: the sentence protects what the user authorizes, and the guarantees protect what actually happens. The chain enforces the first before execution and the second after it.
      </p>
    </section>
  );
}

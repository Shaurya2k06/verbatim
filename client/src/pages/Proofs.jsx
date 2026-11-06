import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { explainRevert } from "@verbatim/app-kit/errors";
import { Evidence, Pill } from "../components/Badge";
import { Failed, Loading } from "../components/States";
import { TxLink } from "../components/TxLink";
import { useData } from "../lib/data";
import { EVIDENCE, GROUPS, OUTCOME, errorName, rows, summary } from "../lib/evidence";

const History = lazy(() => import("./History"));

const LEGS = { devnet: "Frames devnet", sepolia: "Sepolia" };
const fmtGas = (n) => n.toLocaleString();

function Verdict({ r }) {
  if (r.outcome === "not-run") return <Pill tone="mute">not run</Pill>;
  return r.pass ? <Pill tone="ok">expected met</Pill> : <Pill tone="bad">expected not met</Pill>;
}

function Detail({ r }) {
  const x = r.message ? explainRevert(r.message) : null;
  return (
    <div className="detail">
      {r.message ? (
        <>
          <div className="label">Message from the chain</div>
          <pre className="mono-block">{r.message}</pre>
        </>
      ) : null}
      {x?.name ? (
        <>
          <div className="label">Decoded</div>
          <div>
            <code>{x.raw}</code>: {x.human}
          </div>
        </>
      ) : null}
      {r.frameGas?.length ? (
        <>
          <div className="label">Frame gas</div>
          <table className="plain num">
            <thead>
              <tr>
                <th>Frame</th>
                <th>Execution</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {r.frameGas.map((f, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{fmtGas(f.execution)}</td>
                  <td>{fmtGas(f.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {r.extra ? (
        <>
          <div className="label">Extra</div>
          <pre className="mono-block">{JSON.stringify(r.extra, null, 2)}</pre>
        </>
      ) : null}
      <div className="label">Recorded</div>
      <div className="mono">
        {r.at}
        {r.block ? ` · block ${r.block}` : ""}
      </div>
    </div>
  );
}

function Row({ r, open, toggle }) {
  const gas = r.frameGas?.reduce((a, f) => a + f.execution, 0);
  const err = errorName(r.message);
  return (
    <li className={`proof${open ? " open" : ""}`}>
      <button className="proof-head" aria-expanded={open} onClick={toggle}>
        <span className="pid mono">{r.id}</span>
        <span className="ptitle">
          <strong>{r.title}</strong>
          <span className="muted">expects: {r.expected}</span>
        </span>
        <span className="pmeta">
          <Verdict r={r} />
          <Evidence kind={r.evidence} />
          <Pill tone="mute">{LEGS[r.leg] ?? r.leg}</Pill>
        </span>
        <span className="pout">
          {OUTCOME[r.outcome] ?? r.outcome}
          {err ? (
            <>
              {" · "}
              <code>{err}</code>
            </>
          ) : null}
          {gas ? <span className="muted"> · {fmtGas(gas)} gas</span> : null}
        </span>
      </button>
      <div className="plink">{r.txHash ? <TxLink hash={r.txHash} leg={r.leg} /> : <span className="muted">no transaction: refused before the mempool</span>}</div>
      {open ? <Detail r={r} /> : null}
    </li>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProofLedger() {
  const d = useData(["proofs.json", "manifest.json"]);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => new Set(params.get("id") ? [params.get("id")] : []));
  const f = { leg: params.get("leg") ?? "", outcome: params.get("outcome") ?? "", evidence: params.get("evidence") ?? "", group: params.get("group") ?? "", result: params.get("result") ?? "" };
  const set = (k) => (v) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const all = useMemo(() => (d.data ? rows(d.data[0]) : []), [d.data]);
  if (d.loading) return <Loading what="Loading proofs" />;
  if (d.error) return <Failed what="proofs.json" error={d.error} />;
  const [, manifest] = d.data;
  const s = summary(all);
  const passOf = (r) => (r.outcome === "not-run" ? "notrun" : r.pass ? "met" : "notmet");
  const shown = all.filter((r) => (!f.leg || r.leg === f.leg) && (!f.outcome || r.outcome === f.outcome) && (!f.evidence || r.evidence === f.evidence) && (!f.group || r.group === f.group) && (!f.result || passOf(r) === f.result));
  const finalMet = all.filter((r) => r.evidence === "final" && r.pass).length;
  const olderMet = all.filter((r) => r.evidence === "older" && r.pass).length;
  const foundry = all.filter((r) => r.evidence === "foundry").length;

  return (
    <>
      <h1>Proof ledger</h1>
      <p className="lede">
        Every claim, checkable. Each row is what a live network returned when the proof scripts ran. Earlier runs of each row are in <Link to="/proofs?view=history">the test history</Link>.
      </p>
      <div className="counters">
        <div className="counter">
          <div className="big">{finalMet}</div>
          <Evidence kind="final" />
          <div>met their expected result</div>
        </div>
        <div className="counter">
          <div className="big">{olderMet}</div>
          <Evidence kind="older" />
          <div>met their expected result</div>
        </div>
        <div className="counter">
          <div className="big">{foundry}</div>
          <Evidence kind="foundry" />
          <div>Foundry-only rows in this file</div>
        </div>
        <div className={`counter${s.notMet ? " warn" : ""}`}>
          <div className="big">
            {s.notMet} + {s.notRun}
          </div>
          <div>rows miss their expected result, plus rows not run</div>
        </div>
      </div>
      {olderMet ? (
        <div className="callout">
          <strong>Older rows, stated plainly.</strong> The public frames devnet was reset to genesis on 6 November 2026, and Leg A was rerun on the final build after that. A row marked {EVIDENCE.older.label} predates the reset, so its transaction is no longer on the chain.
        </div>
      ) : null}

      <div className="filters">
        <Select label="Leg" value={f.leg} onChange={set("leg")} options={LEGS} />
        <Select label="Outcome" value={f.outcome} onChange={set("outcome")} options={OUTCOME} />
        <Select label="Result" value={f.result} onChange={set("result")} options={{ met: "expected met", notmet: "expected not met", notrun: "not run" }} />
        <Select label="Evidence" value={f.evidence} onChange={set("evidence")} options={Object.fromEntries(Object.entries(EVIDENCE).map(([k, v]) => [k, v.label]))} />
        <Select label="Group" value={f.group} onChange={set("group")} options={GROUPS} />
      </div>
      <div className="muted small">
        {shown.length} of {all.length} rows ·{" "}
        <a href="/data/proofs.json" download>
          proofs.json
        </a>{" "}
        as of commit <code>{manifest.commit}</code>
        {manifest.dirty ? " (with uncommitted evidence changes)" : ""}, built {manifest.builtAt.slice(0, 16).replace("T", " ")} UTC
      </div>
      <ul className="proofs">
        {shown.map((r) => (
          <Row
            key={r.id}
            r={r}
            open={open.has(r.id)}
            toggle={() =>
              setOpen((o) => {
                const n = new Set(o);
                n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                return n;
              })
            }
          />
        ))}
      </ul>
    </>
  );
}

/** One page, two views: the ledger (one run per claim) and the history (every run on record). Each view keeps its own filters. */
export default function Proofs() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "history" || params.get("run") || params.get("tx") ? "history" : "ledger";
  const pick = (v) => setParams(v === "history" ? { view: "history" } : {});
  return (
    <>
      <div className="viewtabs" role="tablist" aria-label="History and proofs">
        <button role="tab" aria-selected={view === "ledger"} className={view === "ledger" ? "primary" : ""} onClick={() => pick("ledger")}>
          Proof ledger
        </button>
        <button role="tab" aria-selected={view === "history"} className={view === "history" ? "primary" : ""} onClick={() => pick("history")}>
          Test history
        </button>
      </div>
      {view === "history" ? (
        <Suspense fallback={<Loading what="Loading the history" />}>
          <History />
        </Suspense>
      ) : (
        <ProofLedger />
      )}
    </>
  );
}

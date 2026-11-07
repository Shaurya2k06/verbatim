// The proof ledger: one row per claim, each with what a live network returned when the proof scripts ran. Rows the server can
// run again have a Run button: the general and Uniswap cases run on Sepolia through ERC-4337, and the honest frame transfers run on
// the EF frames devnet, down both frame paths. Everything else shows its recorded transaction or revert.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { explainRevert } from "@verbatim/app-kit/errors";
import { Evidence, Pill } from "./Badge";
import { RunView } from "./SuiteRunner";
import { Failed, Loading } from "./States";
import { TxLink } from "./TxLink";
import { apiGet, apiPost } from "../lib/api";
import { useData } from "../lib/data";
import { EVIDENCE, GROUPS, OUTCOME, errorName, rows } from "../lib/evidence";

const LEGS = { devnet: "Frames devnet", sepolia: "Sepolia" };
const fmtGas = (n) => Number(n).toLocaleString("en-US");
const short = (h, n = 8) => (h && h.length > 2 * n + 4 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const POLL_MS = 1500;
const MAX_POLL_FAILURES = 5;

/** The honest frame transfers: one run sends both, down the path each row names. */
const FRAME_ROWS = { HONEST: "paymaster", "S-HONEST": "stateless" };

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

/** One frame path's live result: the transaction, and each frame's status and gas from its receipt. */
function FramePathView({ run, path }) {
  const p = run[path];
  const t0 = run.startedAt;
  return (
    <div className="lp-run" aria-live="polite">
      {run.steps?.length ? (
        <ol className="lp-steplog">
          {run.steps.map((s, i) => (
            <li key={i}>
              <span>{((s.at - t0) / 1000).toFixed(1)}s</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {run.status === "queued" || run.status === "running" ? <p className="lp-caret-line">Running on the EF frames devnet</p> : null}
      {run.status === "failed" ? <p className="lp-run-error">{run.error}</p> : null}
      {p ? (
        <>
          <div className={`lp-verdict-box is-${p.ok ? "ok" : "bad"}`}>
            <p>{p.ok ? "Admitted by the alt mempool and mined. The account reports that every guarantee held." : "Mined, but the account did not report success."}</p>
            <Pill tone={p.ok ? "ok" : "bad"}>{p.ok ? "as expected" : "not as expected"}</Pill>
          </div>
          <table className="plain num lp-frame-receipt">
            <thead>
              <tr>
                <th>Frame</th>
                <th>Mode</th>
                <th>Target</th>
                <th>Status</th>
                <th>Gas</th>
              </tr>
            </thead>
            <tbody>
              {p.frames.map((f, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{f.mode}</td>
                  <td>{f.target}</td>
                  <td>{f.status ?? "?"}</td>
                  <td>{f.gas == null ? "?" : fmtGas(f.gas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="lp-evidence">
            <div>
              <dt>Transaction</dt>
              <dd>
                <a className="lp-txlink" href={p.txUrl} target="_blank" rel="noreferrer">
                  {short(p.txHash)} on the alt-mempool explorer ↗
                </a>
              </dd>
            </div>
            <div>
              <dt>Block</dt>
              <dd>{p.block}</dd>
            </div>
            <div>
              <dt>Validation gas</dt>
              <dd>
                {fmtGas(p.validationGas)} across the VERIFY frames, with {p.signatures} protocol-checked signatures
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </div>
  );
}

function Row({ r, open, toggle, runner, live, info, onRun }) {
  const gas = r.frameGas?.reduce((a, f) => a + f.execution, 0);
  const err = errorName(r.message);
  const busy = live?.run && !["done", "failed"].includes(live.run.status);
  return (
    <li className={`proof${open ? " open" : ""}`} id={`proof-${r.id}`}>
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
      <div className="plink">
        {r.txHash ? <TxLink hash={r.txHash} leg={r.leg} /> : <span className="muted">no transaction: refused before the mempool</span>}
        {runner ? (
          <button type="button" className="lp-btn lp-btn-outline lp-btn-small proof-run" disabled={busy || (runner.kind === "suite" && !info?.ready)} onClick={() => onRun(r.id)}>
            {busy ? "Running" : live?.run ? "Run again" : runner.kind === "frames" ? "Run on the frames devnet" : "Run on Sepolia"}
          </button>
        ) : null}
      </div>
      {live?.error ? <p className="lp-run-error">{live.error}</p> : null}
      {live?.run ? runner.kind === "frames" ? <FramePathView run={live.run} path={runner.path} /> : <RunView run={live.run} info={info} /> : null}
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

/** Starts a run and polls it until the server says it has finished, reporting every update. */
async function follow(start, poll, set, alive) {
  let run;
  try {
    run = await start();
  } catch (e) {
    set({ error: `Could not start: ${e.message}.` });
    return null;
  }
  set({ run });
  let failures = 0;
  while (alive.current && !["done", "failed"].includes(run.status)) {
    await new Promise((res) => setTimeout(res, POLL_MS));
    try {
      run = await poll(run.id);
      failures = 0;
      set({ run });
    } catch (e) {
      if (++failures >= MAX_POLL_FAILURES) {
        set({ run: null, error: `Lost contact with the server: ${e.message}. The transaction may still have been sent.` });
        return null;
      }
    }
  }
  return run;
}

export function ProofLedger({ onTx }) {
  const d = useData(["proofs.json", "manifest.json"]);
  const [params, setParams] = useSearchParams();
  const deep = params.get("id");
  const [open, setOpen] = useState(() => new Set(deep ? [deep] : []));
  const [info, setInfo] = useState(null);
  const [live, setLive] = useState({});
  const alive = useRef(true);
  const f = { leg: params.get("leg") ?? "", outcome: params.get("outcome") ?? "", evidence: params.get("evidence") ?? "", group: params.get("group") ?? "", result: params.get("result") ?? "", runnable: params.get("runnable") ?? "" };
  const set = (k) => (v) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true, preventScrollReset: true });
  };

  useEffect(() => {
    alive.current = true;
    apiGet("/suites")
      .then((x) => alive.current && setInfo(x))
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, []);

  // A deep link opens its row and brings it into view.
  const loaded = Boolean(d.data);
  useEffect(() => {
    if (!loaded || !deep) return;
    setOpen((o) => new Set(o).add(deep));
    requestAnimationFrame(() => document.getElementById(`proof-${deep}`)?.scrollIntoView({ block: "start" }));
  }, [loaded, deep]);

  /** Which rows the server can run now, and how. */
  const runners = useMemo(() => {
    const m = { ...Object.fromEntries(Object.entries(FRAME_ROWS).map(([id, path]) => [id, { kind: "frames", path }])) };
    for (const s of info?.suites ?? []) for (const c of s.cases) if (c.proof && !m[c.proof]) m[c.proof] = { kind: "suite", caseId: c.id, title: c.title };
    return m;
  }, [info]);

  const all = useMemo(() => (d.data ? rows(d.data[0]) : []), [d.data]);
  if (d.loading) return <Loading what="Loading proofs" />;
  if (d.error) return <Failed what="proofs.json" error={d.error} />;
  const [, manifest] = d.data;

  const runRow = async (id) => {
    const runner = runners[id];
    if (!runner) return;
    if (runner.kind === "frames") {
      // One frames run sends both paths, so both rows follow it.
      const ids = Object.keys(FRAME_ROWS);
      const put = (v) => alive.current && setLive((s) => ({ ...s, ...Object.fromEntries(ids.map((x) => [x, v])) }));
      const run = await follow(() => apiPost("/frames/run"), (rid) => apiGet(`/frames/run/${rid}`), put, alive);
      for (const path of ["stateless", "paymaster"]) if (run?.[path]) onTx?.({ label: `Frames, ${path} path: honest transfer`, kind: run[path].ok ? "landed" : "error", txHash: run[path].txHash, block: run[path].block, leg: "devnet", gas: run[path].validationGas });
      return;
    }
    const put = (v) => alive.current && setLive((s) => ({ ...s, [id]: v }));
    const run = await follow(() => apiPost("/suites/run", { case: runner.caseId }), (rid) => apiGet(`/suites/run/${rid}`), put, alive);
    const k = run?.outcome?.kind;
    if (run) onTx?.({ label: run.title, kind: k, txHash: run.txHash ?? undefined, userOpHash: run.userOpHash, block: run.block ?? undefined, gas: run.gasUsed ?? undefined, error: k === "rejected" || k === "reverted" ? run.outcome.name ?? undefined : undefined });
  };

  const passOf = (r) => (r.outcome === "not-run" ? "notrun" : r.pass ? "met" : "notmet");
  const shown = all.filter((r) => (!f.leg || r.leg === f.leg) && (!f.outcome || r.outcome === f.outcome) && (!f.evidence || r.evidence === f.evidence) && (!f.group || r.group === f.group) && (!f.result || passOf(r) === f.result) && (!f.runnable || Boolean(runners[r.id])));
  const olderMet = all.filter((r) => r.evidence === "older" && r.pass).length;
  const runnable = all.filter((r) => runners[r.id]).length;

  return (
    <>
      <p className="muted small">
        Each row is what a live network returned when the proof scripts ran. {runnable} of them can run again from here: the Sepolia ones through ERC-4337, the honest frame transfers on the EF frames devnet. The rest need the proof scripts, so they show their recorded transaction or revert.
      </p>
      {olderMet ? (
        <div className="callout">
          <strong>Older rows, stated plainly.</strong> The public frames devnet was reset to genesis on 6 November 2026, and Leg A was rerun on the final build after that. A row marked {EVIDENCE.older.label} predates the reset, so its transaction is no longer on the chain.
        </div>
      ) : null}

      <div className="filters">
        <Select label="Run it" value={f.runnable} onChange={set("runnable")} options={{ yes: "only rows you can run" }} />
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
            runner={runners[r.id]}
            live={live[r.id]}
            info={info}
            onRun={runRow}
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

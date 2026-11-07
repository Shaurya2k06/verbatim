// The proof ledger: one row per claim, each with what a live network returned when the proof scripts ran. Rows the server can
// run again have a Run button: a frames-devnet row sends its EIP-8141 transaction through the real alt-mempool again, and a Sepolia
// row runs its ERC-4337 case. The few that would change shared trust state show their recorded transaction or revert.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

/** The rows that do not run from a button, and why. Each still shows its recorded transaction or revert. */
const NOT_RUNNABLE = {
  A15: { why: "It revokes a descriptor on the shared devnet. Run by a visitor, it would stop every other pending transaction that uses that descriptor." },
  B10: { why: "It revokes a snapshot leaf on the shared devnet, which would break the leaf for everyone after it." },
  "BENCH-N50": { why: "It rotates the devnet's trust snapshot under 50 pending transactions. Run by a visitor, it would invalidate everyone else's paymaster-path transactions." },
  B13: { why: "It removes an attestor from the ENS anchor on Sepolia, which every later run depends on." },
  "B-ens-revoked": { why: "It writes a revocation into the ENS anchor on Sepolia, which every later run depends on." },
  A8: { why: "The live part, the exclusivity proof refusing the lookalike name, runs on the ENS page.", to: "/ens", more: "Run it on the ENS page" },
  WC: { why: "It pairs a dapp with the wallet over WalletConnect's public relay, which needs both ends running; contracts/scripts/e2e/walletconnect.ts runs it." },
  "B-UI-eoa": { why: "It needs Uniswap's real interface built with the malicious step. The recording and the chain's numbers are on the Uniswap page.", to: "/uniswap", more: "Watch it" },
  "B-UI-verbatim": { why: "The same bytes as the real-interface attack. The same refusal runs live as “Verbatim, on the true sentence”.", to: "/uniswap", more: "Run that case" },
};

const KIND_TEXT = {
  landed: "Admitted by the alt mempool and mined. The account reports that every guarantee held.",
  rejected: "Refused before the mempool. There is no transaction, because it never reached a block.",
  reverted: "Mined, and the batch reverted. Everything it did was undone; only the fee was paid.",
  skimmed: "Landed, and the hook took the output. Nothing checked what the route did.",
  "fee-failed": "Mined, and the execute frame failed on the fee, so no protected call ran.",
  checked: "Read from the chain.",
  "probe-landed": "Admitted by the alt mempool and mined. This is the probe account, which checks what the protocol does, not Verbatim's account.",
};

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

/** A devnet case's live result: what the mempool or the account said, and each frame's status and gas from the receipt. */
function DevnetCaseView({ run }) {
  const r = run.result;
  const t0 = run.startedAt ?? Date.now();
  return (
    <div className="lp-run" aria-live="polite">
      {run.status === "queued" ? <p className="lp-caret-line">Waiting for the devnet account, position {run.position} in line</p> : null}
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
      {run.status === "running" ? <p className="lp-caret-line">Running on the EF frames devnet</p> : null}
      {run.status === "failed" ? <p className="lp-run-error">The run failed before it reached a result: {run.error}</p> : null}
      {r ? (
        <>
          <div className={`lp-verdict-box is-${!r.asExpected ? "bad" : r.kind === "landed" || r.kind === "probe-landed" || r.kind === "checked" ? "ok" : "stop"}`}>
            <p>{KIND_TEXT[r.kind] ?? r.kind}</p>
            {r.name ? (
              <p>
                The answer: <code>{r.name}</code>
                {r.human ? `. ${r.human}` : ""}
              </p>
            ) : null}
            {r.note ? <p>{r.note}</p> : null}
            <Pill tone={r.asExpected ? "ok" : "bad"}>{r.asExpected ? "as expected" : "not as expected"}</Pill>
          </div>
          {r.frames?.length ? (
            <table className="plain num lp-frame-receipt">
              <thead>
                <tr>
                  <th>Frame</th>
                  <th>Status</th>
                  <th>Gas</th>
                </tr>
              </thead>
              <tbody>
                {r.frames.map((f, i) => (
                  <tr key={i}>
                    <td>{i}</td>
                    <td>{f.status}</td>
                    <td>{f.gas == null ? "?" : fmtGas(f.gas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <dl className="lp-evidence">
            <div>
              <dt>Transaction</dt>
              <dd>
                {r.txUrl ? (
                  <a className="lp-txlink" href={r.txUrl} target="_blank" rel="noreferrer">
                    {short(r.txHash)} on the alt-mempool explorer ↗
                  </a>
                ) : (
                  "None: it never reached a block."
                )}
              </dd>
            </div>
            {r.block ? (
              <div>
                <dt>Block</dt>
                <dd>{r.block}</dd>
              </div>
            ) : null}
            {r.raw && r.raw !== r.name ? (
              <div>
                <dt>Full answer</dt>
                <dd className="lp-raw">{r.raw}</dd>
              </div>
            ) : null}
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
  const where = runner?.kind === "devnet" ? "Run on the frames devnet" : "Run on Sepolia";
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
        {!runner && NOT_RUNNABLE[r.id] ? (
          <span className="muted small proof-norun">
            Not run from here: {NOT_RUNNABLE[r.id].why}
            {NOT_RUNNABLE[r.id].to ? (
              <>
                {" "}
                <Link to={NOT_RUNNABLE[r.id].to}>{NOT_RUNNABLE[r.id].more} →</Link>
              </>
            ) : null}
          </span>
        ) : null}
        {runner ? (
          <button type="button" className="lp-btn lp-btn-outline lp-btn-small proof-run" disabled={busy || (runner.kind === "suite" && !info?.ready)} onClick={() => onRun(r.id)}>
            {busy ? "Running" : live?.run ? "Run again" : where}
          </button>
        ) : null}
      </div>
      {live?.error ? <p className="lp-run-error">{live.error}</p> : null}
      {live?.run ? runner.kind === "devnet" ? <DevnetCaseView run={live.run} /> : <RunView run={live.run} info={info} /> : null}
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
  const [devnet, setDevnet] = useState(null);
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
    apiGet("/frames/cases")
      .then((x) => alive.current && setDevnet(x.cases))
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

  /** Which rows the server can run now, and how: a devnet row on the devnet, a Sepolia row on Sepolia. */
  const runners = useMemo(() => {
    const m = {};
    for (const c of devnet ?? []) m[c.id] = { kind: "devnet", path: c.path };
    for (const s of info?.suites ?? []) for (const c of s.cases) if (c.proof && !m[c.proof]) m[c.proof] = { kind: "suite", caseId: c.id, title: c.title };
    return m;
  }, [info, devnet]);

  const all = useMemo(() => (d.data ? rows(d.data[0]) : []), [d.data]);
  if (d.loading) return <Loading what="Loading proofs" />;
  if (d.error) return <Failed what="proofs.json" error={d.error} />;
  const [, manifest] = d.data;

  const runRow = async (id) => {
    const runner = runners[id];
    if (!runner) return;
    if (runner.kind === "devnet") {
      const put = (v) => alive.current && setLive((s) => ({ ...s, [id]: v }));
      const run = await follow(() => apiPost("/frames/case", { id }), (rid) => apiGet(`/frames/case/${rid}`), put, alive);
      const r = run?.result;
      if (r) onTx?.({ label: `${id}: ${run.title}`, kind: r.kind === "fee-failed" ? "reverted" : r.kind === "probe-landed" ? "landed" : r.kind, txHash: r.txHash, block: r.block, leg: "devnet", error: r.kind === "rejected" || r.kind === "reverted" ? r.name ?? undefined : undefined });
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
        Each row is what a live network returned when the proof scripts ran. {runnable} of them can run again from here: a frames-devnet row sends its EIP-8141 transaction through the real alt-mempool, and a Sepolia row runs through ERC-4337. The others say why they do not run from here: most would change trust state everyone else depends on.
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

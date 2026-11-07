import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import "./frames-run.css";

const CAP = 100_000;
const fmt = (n) => n.toLocaleString("en-US");
const PATHS = [
  ["stateless", "Stateless", "no paymaster, no stake: the account renders from proofs it carries"],
  ["paymaster", "Paymaster", "a staked paymaster renders from its cache, through the ERC-8421 alt mempool"],
];

/** One path's result: each frame as the node's receipt reported it, and the validation gas against the cap. */
function Result({ name, note, r, pending }) {
  return (
    <article className={`lp-frun-path${r ? (r.ok ? " is-ok" : " is-bad") : ""}`}>
      <header>
        <h4>{name}</h4>
        <span className="lp-frun-state">{r ? (r.ok ? "landed · every promise held" : "landed · batch reverted") : pending ? "waiting" : "not run"}</span>
      </header>
      <p className="lp-frun-note">{note}</p>
      {r ? (
        <>
          <ol className="lp-frun-frames">
            {r.frames.map((f, i) => (
              <li key={i}>
                <span className="lp-frame-i">{i}</span>
                <span className={`lp-frame-mode lp-frame-${f.mode.toLowerCase()}`}>{f.mode}</span>
                <span className="lp-frun-target">{f.target}</span>
                <span className={`lp-frun-gas${f.status === 1 ? "" : " bad"}`}>
                  {f.status === 1 ? "✓" : "✗"} {f.gas == null ? "–" : fmt(f.gas)}
                </span>
              </li>
            ))}
          </ol>
          <div className="lp-frun-cap" role="img" aria-label={`Validation used ${fmt(r.validationGas)} of ${fmt(CAP)} gas, before the ${r.signatures} signatures`}>
            <span style={{ width: `${Math.min(100, (r.validationGas / CAP) * 100)}%` }} />
          </div>
          <p className="lp-frun-sum">
            Validation frames: <b>{fmt(r.validationGas)}</b> of {fmt(CAP)} gas, plus {r.signatures} signatures checked by the protocol
          </p>
          <p className="lp-frun-sum">
            Block {fmt(r.block)} ·{" "}
            <a href={r.txUrl} target="_blank" rel="noreferrer">
              {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)} on the alt-mempool explorer ↗
            </a>
          </p>
        </>
      ) : null}
    </article>
  );
}

/** One button: the same honest 1 dUSDC transfer, sent as a real frame transaction down both paths on the EF frames devnet. */
export function FramesRun() {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(0);
  const timer = useRef(null);
  const busy = run && (run.status === "queued" || run.status === "running");

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const poll = (id) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await apiGet(`/frames/run/${id}`);
        setRun(r);
        if (r.status === "queued" || r.status === "running") poll(id);
      } catch (e) {
        setErr(e.message);
      }
    }, 2500);
  };
  const start = async () => {
    setErr(null);
    try {
      const r = await apiPost("/frames/run");
      setRun(r);
      if (r.status === "queued" || r.status === "running") poll(r.id);
    } catch (e) {
      setErr(e.message);
    }
  };

  const last = run?.steps?.[run.steps.length - 1]?.text;
  const secs = run ? Math.max(0, Math.round(((run.finishedAt ?? now) - run.startedAt) / 1000)) : 0;
  return (
    <div className="lp-frun" aria-live="polite">
      <div className="lp-frun-head">
        <div>
          <h3>Run both, live</h3>
          <p>
            One touch sends the same honest 1 dUSDC transfer twice on the EF frames devnet, once down each path, through the real alt mempool. Nothing is simulated: the gas below is each frame’s receipt. It takes a minute or two, mostly waiting for blocks.
          </p>
        </div>
        <button type="button" className="lp-btn lp-btn-primary" onClick={start} disabled={busy}>
          {busy ? `Running… ${secs}s` : run ? "Run both again" : "Run both, live"}
        </button>
      </div>
      {busy && last ? <p className="lp-caret-line">{last}</p> : null}
      {run?.status === "done" ? <p className="lp-frun-done">Both landed in {secs}s. Same sentence, same guarantees, two ways to validate it.</p> : null}
      {run?.status === "failed" ? <p className="lp-run-error">The run stopped: {run.error}</p> : null}
      {err ? <p className="lp-run-error">{err}</p> : null}
      {run ? (
        <div className="lp-frun-grid">
          {PATHS.map(([k, name, note]) => (
            <Result key={k} name={name} note={note} r={run[k]} pending={busy} />
          ))}
        </div>
      ) : null}
      <p className="lp-frun-fine">The demo server signs as two of the devnet account’s owners, for this fixed transfer only. If the trust snapshot has expired, the attestors renew it on chain first.</p>
    </div>
  );
}

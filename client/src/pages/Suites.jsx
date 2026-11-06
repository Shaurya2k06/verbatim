// The public demo. Every case is run by the server for real, on Sepolia, and this page only shows what comes back: there is no
// sample data and no fallback result, so when the server is unreachable nothing here can run.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Pill } from "../components/Badge";
import { SentenceDiff } from "../components/SentenceDiff";
import { Footer } from "../landing/Footer";
import { HexField } from "../landing/HexField";
import { LandingNav } from "../landing/LandingNav";
import "../landing/landing.css";
import { apiGet, apiPost } from "../lib/api";

const POLL_MS = 1500;
const MAX_POLL_FAILURES = 5;

const short = (h, n = 8) => (h && h.length > 2 * n + 4 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const expected = (e) => ({ landed: "Lands", rejected: "Refused before the mempool", reverted: "Mined, batch reverts", skimmed: "Lands, and the hook takes the output" })[e.kind] ?? e.kind;

function Verdict({ run }) {
  const o = run.outcome;
  const text = {
    landed: "Landed. The account reports that every guarantee in the sentence held.",
    rejected: "Refused before the mempool. No transaction exists, because this never reached a block.",
    reverted: "Mined, and the batch reverted. Everything was undone, and only the fee was paid.",
    skimmed: `Landed, and the hook took ${run.skim?.share ?? "most"}% of the output. Nothing stood in its way.`,
    "device-refused": "The device refused to sign, so nothing was sent.",
    error: "The run failed before it reached a result.",
  }[o.kind];
  const tone = o.kind === "error" || run.asExpected === false ? "bad" : o.kind === "landed" ? "ok" : o.kind === "skimmed" ? "bad" : "stop";
  return (
    <div className={`lp-verdict-box is-${tone}`}>
      <p>{text}</p>
      {o.name ? (
        <p>
          The account’s answer: <code>{o.name}</code>
          {o.human ? `. ${o.human}` : ""}
        </p>
      ) : null}
      {o.kind === "error" ? <p className="lp-raw">{o.raw}</p> : null}
      {run.asExpected ? <Pill tone="ok">as expected</Pill> : <Pill tone="bad">not as expected</Pill>}
    </div>
  );
}

function Evidence({ run, info }) {
  const o = run.outcome;
  return (
    <dl className="lp-evidence">
      <div>
        <dt>Transaction</dt>
        <dd>
          {run.txUrl ? (
            <a className="lp-txlink" href={run.txUrl} target="_blank" rel="noreferrer">
              {short(run.txHash)} on Etherscan ↗
            </a>
          ) : (
            <>
              None, it never reached a block.{" "}
              <a href={`${info.explorer}/address/${info.account}`} target="_blank" rel="noreferrer">
                See the account’s history ↗
              </a>
            </>
          )}
        </dd>
      </div>
      {o.bundler ? (
        <div>
          <dt>The bundler said</dt>
          <dd className="lp-raw">{o.bundler}</dd>
        </div>
      ) : null}
      {o.raw && o.kind !== "error" ? (
        <div>
          <dt>Full revert</dt>
          <dd className="lp-raw">{o.raw}</dd>
        </div>
      ) : null}
      {run.block ? (
        <div>
          <dt>Block</dt>
          <dd>{run.block}</dd>
        </div>
      ) : null}
      {run.gasUsed ? (
        <div>
          <dt>Gas</dt>
          <dd>{Number(run.gasUsed).toLocaleString("en-US")}</dd>
        </div>
      ) : null}
      {run.userOpHash ? (
        <div>
          <dt>User operation</dt>
          <dd className="lp-raw">{run.userOpHash}</dd>
        </div>
      ) : null}
      {run.signers?.length ? (
        <div>
          <dt>Signed by</dt>
          <dd>
            {run.signers.map((s) => (
              <a key={s} href={`${info.explorer}/address/${s}`} target="_blank" rel="noreferrer">
                {short(s, 6)} ↗
              </a>
            ))}
          </dd>
        </div>
      ) : null}
      {run.from ? (
        <div>
          <dt>Sent from</dt>
          <dd>
            <a href={`${info.explorer}/address/${run.from}`} target="_blank" rel="noreferrer">
              {short(run.from, 6)} ↗
            </a>
          </dd>
        </div>
      ) : null}
      {run.skim ? (
        <div>
          <dt>Output</dt>
          <dd>
            The wallet got {run.skim.received} dUSDC. The hook took {run.skim.took} dUSDC.
          </dd>
        </div>
      ) : null}
      {run.deltas?.map((d) => (
        <div key={d.label}>
          <dt>{d.label}</dt>
          <dd>
            {d.before} → {d.after} {d.unit} {d.changed ? null : <span className="lp-unchanged">unchanged</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RunView({ run, info }) {
  const t0 = run.startedAt ?? run.createdAt;
  return (
    <div className="lp-run" aria-live="polite">
      {run.status === "queued" ? <p className="lp-caret-line">Waiting for the account, position {run.position} in line</p> : null}
      {run.steps?.length ? (
        <ol className="lp-steplog">
          {run.steps.map((s, i) => (
            <li key={i} className={s.tone ? `is-${s.tone}` : undefined}>
              <span>{((s.at - t0) / 1000).toFixed(1)}s</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {run.status === "running" ? <p className="lp-caret-line">Running on Sepolia</p> : null}
      {run.claimed ? (
        <div className="lp-run-sentence">
          <SentenceDiff claimed={run.claimed} actual={run.actual} claimedTitle="The owners signed" actualTitle="What the calldata really does" />
        </div>
      ) : null}
      {run.status === "done" ? (
        <>
          <Verdict run={run} />
          <Evidence run={run} info={info} />
        </>
      ) : null}
    </div>
  );
}

function Case({ c, state, info, onRun }) {
  const busy = state?.run && state.run.status !== "done";
  return (
    <li className="lp-case">
      <div className="lp-case-head">
        <div>
          <h3>{c.title}</h3>
          <p>{c.plain}</p>
          <p className="lp-case-expect">
            Expected: {expected(c.expect)}
            {c.expect.name ? (
              <>
                {" "}
                with <code>{c.expect.name}</code>
              </>
            ) : null}
            . <Link to={`/proofs?id=${encodeURIComponent(c.proof)}`}>Earlier recorded run →</Link>
          </p>
        </div>
        <button type="button" className="lp-btn lp-btn-outline lp-case-run" disabled={busy || !info.ready} onClick={() => onRun(c.id)}>
          {busy ? "Running" : state?.run ? "Run again" : "Run"}
        </button>
      </div>
      {state?.error ? <p className="lp-run-error">{state.error}</p> : null}
      {state?.run ? <RunView run={state.run} info={info} /> : null}
    </li>
  );
}

export default function Suites() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [state, setState] = useState({});
  const alive = useRef(true);
  const { hash } = useLocation();

  const refresh = () =>
    apiGet("/suites")
      .then((x) => {
        if (!alive.current) return;
        setInfo(x);
        setLoadError(null);
      })
      .catch((e) => alive.current && setLoadError(e.message));

  useEffect(() => {
    alive.current = true;
    if (!hash) window.scrollTo({ top: 0, behavior: "instant" });
    refresh();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loaded = Boolean(info);
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** Starts one case and follows it until the server says it is done. */
  const runCase = async (id) => {
    const set = (v) => alive.current && setState((s) => ({ ...s, [id]: v }));
    let run;
    try {
      run = await apiPost("/suites/run", { case: id });
    } catch (e) {
      set({ error: `Could not start: ${e.message}.` });
      return;
    }
    set({ run });
    let failures = 0;
    while (alive.current && run.status !== "done") {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        run = await apiGet(`/suites/run/${run.id}`);
        failures = 0;
        set({ run });
      } catch (e) {
        if (++failures >= MAX_POLL_FAILURES) {
          set({ run: null, error: `Lost contact with the server: ${e.message}. The operation may still have run, so check the account on Etherscan.` });
          return;
        }
      }
    }
    refresh();
  };

  const runSuite = async (s) => {
    for (const c of s.cases) await runCase(c.id);
  };

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <HexField />
      <LandingNav base="/" />
      <main id="main">
        <section className="lp-section lp-suites-head">
          <p className="lp-eyebrow">Live demo</p>
          <h1>
            Pick a suite.
            <br />
            Watch it happen.
          </h1>
          <p className="lp-copy">Every case below runs on Sepolia when you press Run, against the deployed account and Uniswap’s official contracts. Nothing is simulated or replayed, and you don’t need a wallet.</p>
          {loadError && !info ? (
            <p className="lp-run-error">
              The demo server is not reachable: {loadError}. Nothing here can run without it, because nothing here is simulated. <Link to="/proofs">Earlier recorded runs →</Link>
            </p>
          ) : null}
          {!info && !loadError ? <p className="lp-caret-line">Reaching the demo server. It can take up to a minute to wake</p> : null}
          {info ? (
            <dl className="lp-facts">
              <div>
                <dt>Network</dt>
                <dd>{info.network}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>
                  <a href={`${info.explorer}/address/${info.account}`} target="_blank" rel="noreferrer">
                    {short(info.account, 6)} ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt>Funds for gas</dt>
                <dd>{info.funds ? `${Number(info.funds.accountEth).toFixed(4)} Sepolia ETH` : "Could not read"}</dd>
              </div>
              <div>
                <dt>In line now</dt>
                <dd>{info.queued}</dd>
              </div>
            </dl>
          ) : null}
          {info && !info.ready ? <p className="lp-run-error">Runs are off: {info.why}.</p> : null}
          <div className="lp-notes">
            <p>
              <b>Who signs.</b> You have no owner keys, so the demo server signs as two of the account’s three owners. It only signs the fixed cases on this page, on a testnet account. In real use nobody’s server signs: the owners read the sentence and sign on an offline device.
            </p>
            <p>
              <b>Why some have no transaction.</b> A refused operation never reaches a block, so there is no transaction to link. You get the bundler’s answer, the account’s own revert, and the balances and nonce before and after. Anything that reaches a block links to Etherscan.
            </p>
          </div>
        </section>
        {info?.suites.map((s) => (
          <section className="lp-section lp-suite" id={s.id} key={s.id} aria-labelledby={`${s.id}-title`}>
            <div className="lp-suite-head">
              <div>
                <h2 id={`${s.id}-title`}>{s.title}</h2>
                <p className="lp-copy">{s.summary}</p>
              </div>
              {s.cases.length > 1 ? (
                <button type="button" className="lp-btn lp-btn-primary" disabled={!info.ready || s.cases.some((c) => state[c.id]?.run && state[c.id].run.status !== "done")} onClick={() => runSuite(s)}>
                  Run this suite
                </button>
              ) : null}
            </div>
            <ol className="lp-cases">
              {s.cases.map((c) => (
                <Case key={c.id} c={c} state={state[c.id]} info={info} onRun={runCase} />
              ))}
            </ol>
          </section>
        ))}
        {info?.recent.length ? (
          <section className="lp-section" aria-labelledby="recent-title">
            <h2 id="recent-title">Recent runs</h2>
            <p className="lp-copy">From anyone on this server since it last started.</p>
            <ul className="lp-recent">
              {info.recent.map((r) => (
                <li key={r.id}>
                  <span>{r.title}</span>
                  <span>
                    {r.kind}
                    {r.name ? ` · ${r.name}` : ""}
                  </span>
                  {r.txUrl ? (
                    <a href={r.txUrl} target="_blank" rel="noreferrer">
                      Transaction ↗
                    </a>
                  ) : (
                    <span className="lp-unchanged">no transaction</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

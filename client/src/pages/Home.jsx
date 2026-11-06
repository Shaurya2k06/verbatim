import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Evidence } from "../components/Badge";
import { Sentence, linesOf } from "../components/Sentence";
import { Failed, Loading } from "../components/States";
import { useData } from "../lib/data";
import { rows, summary } from "../lib/evidence";

// Two recorded render vectors, decoded by displayvm-ts: the honest swap, then the same swap through the skim hook.
const HONEST = "ur.v4_swap";
const EVIL = "ur.v4_swap skim hook, no minimum";

function SentenceWidget({ vectors }) {
  const honest = vectors.find((v) => v.name === HONEST);
  const evil = vectors.find((v) => v.name === EVIL);
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [view, setView] = useState({ which: 0, reveal: still ? Infinity : 0 });
  const tree = (view.which === 0 ? honest : evil)?.tree;
  const total = tree ? linesOf(tree).length : 0;
  // One line at a time; a pause on the full sentence, then the other route.
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setView((v) => (v.reveal >= total + 8 ? { which: 1 - v.which, reveal: 0 } : { ...v, reveal: v.reveal + 1 })), 380);
    return () => clearInterval(t);
  }, [still, total]);
  const which = view.which;
  const reveal = view.reveal;
  const setWhich = (w) => setView({ which: w, reveal: still ? Infinity : 0 });
  if (!honest || !evil) return null;
  return (
    <div className="device">
      <div className="device-head">
        <span>{which === 0 ? "The honest route" : "The same swap, through a skim hook"}</span>
        <div className="seg">
          <button className={which === 0 ? "on" : ""} onClick={() => setWhich(0)}>
            Honest
          </button>
          <button className={which === 1 ? "on" : ""} onClick={() => setWhich(1)}>
            Risk
          </button>
        </div>
      </div>
      <Sentence tree={tree} reveal={reveal} />
      <div className="device-foot muted">
        Decoded by <code>displayvm-ts</code> from <code>test/vectors/render.json</code>, the bytes the on-chain renderer must match.
      </div>
    </div>
  );
}

function Counters({ proofs, manifest }) {
  const s = summary(rows(proofs));
  const reg = manifest.registry;
  return (
    <div className="counters">
      <div className="counter">
        <div className="big">{s.attacksMet}</div>
        <div>attacks stopped as expected, of {s.attacks} recorded</div>
        <div className="badges">
          {s.attacksMetByEvidence.final ? <Evidence kind="final" detail={s.attacksMetByEvidence.final} /> : null}
          {s.attacksMetByEvidence.older ? <Evidence kind="older" detail={s.attacksMetByEvidence.older} /> : null}
        </div>
      </div>
      <div className="counter">
        <div className="big">
          {s.admitted} / {s.rejected}
        </div>
        <div>transactions admitted / rejected before the mempool</div>
      </div>
      {reg ? (
        <div className="counter">
          <div className="big">
            {reg.compiled.toLocaleString()} / {reg.total.toLocaleString()}
          </div>
          <div>ERC-7730 registry functions that compile to descriptors</div>
        </div>
      ) : null}
      <Link className="counter link" to="/proofs">
        <div className="big">→</div>
        <div>
          Every row, with its evidence. {s.notMet ? `${s.notMet} rows currently miss their expected result, and say so.` : ""}
        </div>
      </Link>
    </div>
  );
}

const STEPS = [
  ["The frontend builds the transaction.", "/demo", "It may be honest. It may be tampered with. Verbatim assumes nothing."],
  ["The offline signer shows the sentence, and the owner signs it.", "/wallet", "The device decodes the sentence itself and signs its hash, not calldata."],
  ["The chain re-renders the sentence during validation.", "/mempool", "If it differs from what was signed, the transaction is rejected and never reaches the mempool."],
  ["Execution asserts the guarantees.", "/sentences", "Any effect the sentence did not promise reverts the whole batch."],
];

export default function Home() {
  const d = useData(["proofs.json", "manifest.json", "render-vectors.json"]);
  return (
    <>
      <section className="hero">
        <div>
          <h1 className="display">The chain is your wallet's screen.</h1>
          <p className="lede">Ethereum checks that you signed the sentence you read, then checks that what it guaranteed happened.</p>
          <div className="row">
            <Link className="button primary" to="/demo">
              See the attack
            </Link>
            <Link className="button" to="/attack">
              Attack us
            </Link>
            <Link className="button" to="/proofs">
              Read the proofs
            </Link>
          </div>
        </div>
        {d.data ? <SentenceWidget vectors={d.data[2].vectors} /> : d.error ? <Failed what="the example sentence" error={d.error} /> : <Loading what="Decoding" />}
      </section>

      <section className="panel problem">
        <h2>The problem</h2>
        <p>
          <strong>Bybit lost $1.5B</strong> because its signers approved what a tampered interface showed them. Clear signing in the wallet alone doesn't fix that: the wallet can show the right sentence, but nothing on chain checks that the transaction which runs is the one that was shown.
        </p>
      </section>

      <section>
        <h2 className="section">How it works</h2>
        <ol className="steps">
          {STEPS.map(([t, to, more], i) => (
            <li key={i}>
              <Link to={to}>
                <span className="n">{i + 1}</span>
                <strong>{t}</strong>
                <span className="muted">{more}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid2">
        <div className="panel">
          <h2>Two paths</h2>
          <table className="plain">
            <tbody>
              <tr>
                <th>Stateless</th>
                <td>Runs in the public mempool with no stake. The sentence's trust comes as snapshot proofs inside the transaction.</td>
              </tr>
              <tr>
                <th>Paymaster</th>
                <td>A staked paymaster renders from its own cached trust: the alternative mempool's heavy-render path.</td>
              </tr>
            </tbody>
          </table>
          <Link to="/mempool">Measured comparison →</Link>
        </div>
        <details className="panel scope">
          <summary>
            <h2>Scope</h2>
          </summary>
          <p>
            <strong>In scope:</strong>
          </p>
          <ul>
            <li>A human reading a sentence on a device, with a host or frontend that tampers with the transaction (the Bybit class).</li>
            <li>A contract that describes itself truthfully but has hidden effects on tracked assets.</li>
            <li>Swap frontends that lie about the minimum output, route, recipient, or hook risk.</li>
            <li>Stale pre-signed transactions, killed by a mandatory absolute expiry.</li>
          </ul>
          <p>
            <strong>Out of scope:</strong>
          </p>
          <ul>
            <li>
              Compromised <strong>machine</strong> signers (Binance, Oct 2026), stolen keys, and sentences that are accurate but misunderstood.
            </li>
            <li>Admin-parameter semantics and protocol-internal ledgers beyond what descriptors render.</li>
            <li>
              <strong>Unattested contracts.</strong> They are refused, and there is no "effects-only" mode.
            </li>
            <li>
              <strong>A captured attestor quorum.</strong> It <em>can</em> mislabel spenders, tokens or names. The amounts in the signed guarantees, the no-standing-approvals rule, and execution-time revocation still hold.
            </li>
            <li>
              <strong>Drift</strong> (Apr 2026) is a footnote only. A truthful sentence would have described those admin calls accurately; expiry is the only mitigation that applies.
            </li>
          </ul>
        </details>
      </section>

      <section>
        <h2 className="section">Live counters</h2>
        {d.data ? <Counters proofs={d.data[0]} manifest={d.data[1]} /> : d.error ? <Failed what="proofs.json" error={d.error} /> : <Loading />}
      </section>
    </>
  );
}

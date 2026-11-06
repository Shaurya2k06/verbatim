import { useEffect, useState } from "react";
import { Pill } from "../components/Badge";
import { ProofRef } from "../components/ProofRef";
import { Loading } from "../components/States";
import { TxLink, short } from "../components/TxLink";
import { attestors, config, publisherProof, resolveName, revocations } from "../lib/ens";
import { useNetwork } from "../lib/network-context";
import { addressUrl } from "../lib/networks";

const Addr = ({ a }) => {
  const { deployments } = useNetwork();
  return (
    <a className="mono" href={addressUrl("sepolia", a, deployments)} target="_blank" rel="noreferrer">
      {a}
    </a>
  );
};

/** Runs `fn` whenever `key` changes; `rerun` repeats it. Results from a stale key read as loading. */
function useAsync(fn, key) {
  const [nonce, setNonce] = useState(0);
  const [s, set] = useState({ for: null });
  useEffect(() => {
    let live = true;
    const tag = { key, nonce };
    fn()
      .then((data) => live && set({ for: tag, data }))
      .catch((error) => live && set({ for: tag, error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  const current = s.for && s.for.key === key && s.for.nonce === nonce;
  return [current ? s : { loading: true }, () => setNonce((n) => n + 1)];
}

const Verdict = ({ v, pass, fail }) =>
  v === null ? (
    <div className="ok">✅ {pass}</div>
  ) : (
    <div className="bad">
      ❌ {fail} <code>{v.name}</code>
      {v.args?.length ? <span className="mono"> ({v.args.join(", ")})</span> : null}
    </div>
  );

function Step({ s }) {
  return (
    <div className="check">
      <span className={`mark ${s.ok === null ? "" : s.ok ? "pass" : "fail"}`}>{s.ok === null ? "·" : s.ok ? "✓" : "✗"}</span>
      <div>
        <div>{s.label}</div>
        <pre className="mono-block">{s.detail}</pre>
      </div>
    </div>
  );
}

function Attestors({ cfg, dep }) {
  const [s] = useAsync(() => attestors(cfg, dep), cfg);
  if (s.loading) return <Loading what="Reading the attestors record" />;
  if (s.error) return <div className="bad">{s.error.shortMessage ?? s.error.message}</div>;
  const a = s.data;
  return (
    <>
      <div className="kv">
        <span>Record</span>
        <span>
          <code>attestors</code> on <strong>{a.name}</strong>
          {dep.ens.attestorsRecordTx ? (
            <>
              {" · set in "}
              <TxLink hash={dep.ens.attestorsRecordTx} leg="sepolia" />
            </>
          ) : null}
        </span>
        <span>Attestors</span>
        <span>{a.list.length ? a.list.map((x) => <Addr key={x} a={x} />).reduce((acc, x) => [...acc, acc.length ? <br key={`b${acc.length}`} /> : null, x], []) : <em>empty</em>}</span>
        <span>Threshold</span>
        <span>{a.threshold === null ? "not readable from the account" : `${a.threshold} of ${a.list.length}, read from the account`}</span>
        <span>Who may write it</span>
        <span>
          {a.setters.toString()} holder(s) of the argument-scoped <code>SET_TEXT</code> role on key <code>attestors</code>, {a.adminSetters.toString()} admin(s)
        </span>
        <span>Role holder</span>
        <span>
          <Addr a={a.governance} /> {a.governanceHolds ? "" : "(does not hold it!) "}
          {a.governanceIsContract ? <Pill tone="ok">contract (Safe)</Pill> : <Pill tone="warn">EOA (demo)</Pill>}
        </span>
      </div>
      <ProofRef id="B13" />
    </>
  );
}

function Publishers({ cfg, dep }) {
  const [name, setName] = useState(dep.ens.publisher);
  const [s, run] = useAsync(() => publisherProof(cfg, name), name);
  const [draft, setDraft] = useState(name);
  return (
    <>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          draft === name ? run() : setName(draft.trim());
        }}
      >
        <input aria-label="Publisher name" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="primary">Check</button>
      </form>
      <div className="row">
        {[dep.ens.publisher, dep.ens.lookalike].map((n) => (
          <button
            key={n}
            className="chip"
            onClick={() => {
              setDraft(n);
              setName(n);
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {s.loading ? (
        <Loading what="Running the exclusivity proof on Sepolia" />
      ) : s.error ? (
        <div className="bad">{s.error.shortMessage ?? s.error.message}</div>
      ) : (
        <>
          {s.data.steps.map((x, i) => (
            <Step key={i} s={x} />
          ))}
          <div className="label">The deployed checker's verdict</div>
          <Verdict v={s.data.verdict} pass={`${s.data.name} is an exclusive publisher. Its name can appear in signed sentences.`} fail={`${s.data.name} fails:`} />
        </>
      )}
    </>
  );
}

function Names({ cfg, dep }) {
  const [q, setQ] = useState(dep.ens.publisher);
  const [s, setS] = useState(null);
  const go = (v) => {
    setQ(v);
    setS({ loading: true });
    resolveName(cfg, v)
      .then((data) => setS({ data }))
      .catch((error) => setS({ error }));
  };
  return (
    <>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <input aria-label="Name or address" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name.eth or 0x…" />
        <button className="primary">Resolve</button>
      </form>
      <div className="row">
        <button className="chip" onClick={() => go(dep.ens.publisher)}>
          {dep.ens.publisher}
        </button>
        <button className="chip" onClick={() => go(dep.ens.lookalike)}>
          Lookalike: {dep.ens.lookalike}
        </button>
      </div>
      {!s ? null : s.loading ? (
        <Loading what="Resolving" />
      ) : s.error ? (
        <div className="bad">{s.error.message}</div>
      ) : (
        <>
          <div className="kv">
            <span>Name</span>
            <span>{s.data.name ?? <em>no primary name</em>}</span>
            <span>Forward</span>
            <span>{s.data.forward ? <Addr a={s.data.forward} /> : <em>does not resolve</em>}</span>
            <span>Reverse</span>
            <span>{s.data.reverse ?? <em>no primary name</em>}</span>
          </div>
          <Verdict
            v={s.data.verdict}
            pass="Forward and reverse agree, through a pinned resolver: a sentence may show this name next to the address."
            fail="A sentence shows the raw address, not the name:"
          />
        </>
      )}
      <ProofRef id="A8" />
    </>
  );
}

function Revocations({ cfg, dep }) {
  const [s] = useAsync(() => revocations(cfg, dep), cfg);
  const [leaf, setLeaf] = useState("");
  const l = leaf.trim().toLowerCase();
  return (
    <>
      {s.loading ? (
        <Loading what="Reading the revoked record" />
      ) : s.error ? (
        <div className="bad">{s.error.message}</div>
      ) : (
        <>
          <div className="small">
            <code>revoked</code> on <strong>{s.data.name}</strong>: {s.data.list.length} leaf hash(es)
          </div>
          <ul className="mono-list">
            {s.data.list.map((h) => (
              <li key={h} className="mono">
                {h}
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Is this leaf revoked?</span>
            <input value={leaf} onChange={(e) => setLeaf(e.target.value)} placeholder="0x… leaf hash" />
          </label>
          {/^0x[0-9a-f]{64}$/.test(l) ? s.data.list.includes(l) ? <div className="bad">Revoked: any transaction relying on it reverts with LeafRevokedInEns.</div> : <div className="ok">Not revoked.</div> : null}
        </>
      )}
      <ProofRef id="B-ens-revoked" />
    </>
  );
}

const DECIDES = [
  ["names", "Who you're paying", "A name appears in a sentence only if it resolves forward and reverse through a pinned resolver."],
  ["publishers", "Who published each descriptor", "A publisher's claim stands only if nobody but its council can change it."],
  ["attestors", "Who may attest", "Every snapshot signer must be listed in the attestors record."],
  ["revocations", "What's revoked", "A leaf listed in the revoked record fails at execution."],
];

export default function Ens() {
  const { deployments, stateOf } = useNetwork();
  const dep = deployments?.sepolia;
  const [cfg] = useAsync(() => (dep ? config(dep) : new Promise(() => {})), dep);
  const degraded = cfg.error || stateOf("sepolia") === "degraded";
  return (
    <>
      <h1>ENS trust root</h1>
      <p className="lede">
        On chains with ENS, ENSv2 decides what Verbatim trusts. Everything below is read live from Sepolia at page load, through the anchor and checker contracts in the published deployment. Nothing is hard-coded.
      </p>

      <div className="grid4">
        {DECIDES.map(([id, t, d]) => (
          <a key={id} href={`#${id}`} className="panel box">
            <strong>{t}</strong>
            <span className="muted small">{d}</span>
          </a>
        ))}
      </div>

      {!dep ? (
        <Loading what="Loading the Sepolia deployment" />
      ) : degraded ? (
        <div className="panel">
          <div className="bad">Sepolia is unreachable from this browser{cfg.error ? `: ${cfg.error.shortMessage ?? cfg.error.message}` : ""}. Recorded proofs are shown.</div>
          <ProofRef id="B13" />
          <ProofRef id="B-ens-revoked" />
          <ProofRef id="A8" />
        </div>
      ) : cfg.loading ? (
        <Loading what="Reading the trust anchor" />
      ) : (
        <>
          <section className="panel" id="attestors">
            <h2>Attestors</h2>
            <Attestors cfg={cfg.data} dep={dep} />
          </section>
          <section className="panel" id="publishers">
            <h2>Publishers: the exclusivity proof</h2>
            <Publishers cfg={cfg.data} dep={dep} />
          </section>
          <section className="panel" id="names">
            <h2>Names</h2>
            <Names cfg={cfg.data} dep={dep} />
          </section>
          <section className="panel" id="revocations">
            <h2>Revocations</h2>
            <Revocations cfg={cfg.data} dep={dep} />
          </section>
          <section className="panel">
            <h2>Contracts read</h2>
            <div className="kv small">
              <span>Trust anchor</span>
              <Addr a={cfg.data.anchor} />
              <span>Trust checker</span>
              <Addr a={cfg.data.checker} />
              <span>Root registry</span>
              <Addr a={cfg.data.rootRegistry} />
              <span>.eth registry</span>
              <Addr a={cfg.data.ethRegistry} />
              <span>Universal resolver</span>
              <Addr a={cfg.data.universalResolver} />
              <span>Pinned resolver code</span>
              <code>{short(cfg.data.publisherCodehash, 10)}</code>
            </div>
          </section>
        </>
      )}

      <div className="callout">
        <strong>Disclosure.</strong> ENS itself is upstream trust. The ENS DAO and whoever controls the root and <code>.eth</code> registries keep admin roles that no name can renounce; the checks above prove that nobody else can change these records.
      </div>
    </>
  );
}

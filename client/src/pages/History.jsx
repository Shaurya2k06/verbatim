// Every test run there is a record of: each proof run git has ever held for proofs.json (history.json, built by
// scripts/sync-data.mjs), and the live demo runs the server still holds in memory. A run with a transaction is looked up on its
// chain when opened, so the page shows what the chain says now, next to what was recorded at the time.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatEther, formatGwei } from "viem";
import { explainRevert } from "@verbatim/app-kit/errors";
import { Evidence, Pill } from "../components/Badge";
import { REPO } from "../components/Layout";
import { Failed, Loading } from "../components/States";
import { short } from "../components/TxLink";
import { apiGet } from "../lib/api";
import { useData } from "../lib/data";
import { EVIDENCE, GROUPS, OUTCOME, errorName, evidenceOf, groupOf, legOf } from "../lib/evidence";
import { useNetwork } from "../lib/network-context";
import { addressUrl, rpc, txUrl } from "../lib/networks";
import { RunView } from "../components/SuiteRunner";

const LEGS = { devnet: "Frames devnet", sepolia: "Sepolia" };
const RESULTS = { met: "expected met", notmet: "expected not met", notrun: "not run" };
const KINDS = { landed: "landed", rejected: "refused before the mempool", reverted: "mined; batch reverted", skimmed: "landed; hook skimmed", "device-refused": "device refused", error: "error" };
const big = (h) => (h === null || h === undefined ? null : BigInt(h));
const num = (n) => Number(n).toLocaleString("en-US");
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const resultOf = (r) => (r.outcome === "not-run" ? "notrun" : r.pass ? "met" : "notmet");
const keyOf = (r) => `${r.id}@${r.at}`;

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chip"
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          })
          .catch(() => {})
      }
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Addr({ a, leg, deps }) {
  if (!a) return <span className="muted">none</span>;
  return (
    <a className="mono" href={addressUrl(leg, a, deps)} target="_blank" rel="noreferrer">
      {a} ↗
    </a>
  );
}

const TX_TYPES = { "0x0": "legacy", "0x1": "access list (EIP-2930)", "0x2": "EIP-1559", "0x3": "blob (EIP-4844)", "0x4": "set code (EIP-7702)", "0x6": "frame (EIP-8141)" };

/** What the chain says about a transaction today: the transaction, its receipt and its block. */
function ChainTx({ hash, leg, gone }) {
  const { legs, deployments, status } = useNetwork();
  const node = legs.find((l) => l.id === leg);
  const [s, setS] = useState({ loading: true });
  useEffect(() => {
    if (gone || !node) return;
    let live = true;
    (async () => {
      const [tx, rc] = await Promise.all([rpc(node.rpc, "eth_getTransactionByHash", [hash]), rpc(node.rpc, "eth_getTransactionReceipt", [hash])]);
      const block = rc?.blockNumber ? await rpc(node.rpc, "eth_getBlockByNumber", [rc.blockNumber, false]) : null;
      return { tx, rc, block };
    })()
      .then((d) => live && setS(d))
      .catch((error) => live && setS({ error }));
    return () => {
      live = false;
    };
  }, [hash, node, gone]);

  const link = (
    <div className="row small">
      <a className="mono" href={txUrl(leg, hash, deployments)} target="_blank" rel="noreferrer">
        {hash} ↗
      </a>
      <Copy text={hash} />
    </div>
  );
  if (gone)
    return (
      <>
        {link}
        <div className="callout small">This ran on the frames devnet before it was reset on 6 November 2026. The transaction is no longer on any chain, so only what was recorded at the time is shown.</div>
      </>
    );
  if (!node) return link;
  if (s.loading) return <>{link}<Loading what={`Reading it from ${LEGS[leg] ?? leg}`} /></>;
  if (s.error)
    return (
      <>
        {link}
        <div className="bad">
          Could not read it from {LEGS[leg] ?? leg} right now ({s.error.name === "AbortError" ? "timed out" : status[leg]?.rpcOk === false ? "the network is unreachable from here" : s.error.message}). The explorer link above still works.
        </div>
      </>
    );
  const { tx, rc, block } = s;
  if (!tx && !rc) return <>{link}<div className="bad">{LEGS[leg] ?? leg} does not know this transaction.</div></>;

  const used = big(rc?.gasUsed);
  const limit = big(tx?.gas);
  const price = big(rc?.effectiveGasPrice ?? tx?.gasPrice);
  const fee = used !== null && price !== null ? used * price : null;
  const head = status[leg]?.head;
  const blockNo = rc?.blockNumber ? Number(rc.blockNumber) : null;
  const input = tx?.input ?? tx?.data;
  return (
    <>
      {link}
      <div className="kv small">
        <span>Status</span>
        <span>{rc ? rc.status === "0x1" ? <Pill tone="ok">success</Pill> : <Pill tone="bad">reverted</Pill> : <Pill tone="warn">pending</Pill>}</span>
        <span>Block</span>
        <span>
          {blockNo !== null ? num(blockNo) : "—"}
          {head && blockNo !== null ? <span className="muted"> · {num(head - blockNo)} confirmations</span> : null}
        </span>
        {block ? (
          <>
            <span>Mined at</span>
            <span>{when(Number(block.timestamp) * 1000)}</span>
          </>
        ) : null}
        <span>From</span>
        <span>
          <Addr a={tx?.from ?? rc?.from} leg={leg} deps={deployments} />
        </span>
        <span>To</span>
        <span>
          <Addr a={tx?.to ?? rc?.to} leg={leg} deps={deployments} />
        </span>
        {rc?.contractAddress ? (
          <>
            <span>Created</span>
            <span>
              <Addr a={rc.contractAddress} leg={leg} deps={deployments} />
            </span>
          </>
        ) : null}
        <span>Type</span>
        <span>{TX_TYPES[tx?.type ?? rc?.type] ?? tx?.type ?? rc?.type ?? "—"}</span>
        {tx?.nonce ? (
          <>
            <span>Nonce</span>
            <span>{num(big(tx.nonce))}</span>
          </>
        ) : null}
        {tx?.value ? (
          <>
            <span>Value</span>
            <span>{formatEther(big(tx.value))} ETH</span>
          </>
        ) : null}
        <span>Gas used</span>
        <span>
          {used !== null ? num(used) : "—"}
          {used !== null && limit ? <span className="muted"> of {num(limit)} ({((Number(used) / Number(limit)) * 100).toFixed(1)}%)</span> : null}
        </span>
        {price !== null ? (
          <>
            <span>Gas price</span>
            <span>{formatGwei(price)} gwei</span>
          </>
        ) : null}
        {fee !== null ? (
          <>
            <span>Fee paid</span>
            <span>{formatEther(fee)} ETH</span>
          </>
        ) : null}
        {block?.baseFeePerGas ? (
          <>
            <span>Base fee</span>
            <span>{formatGwei(big(block.baseFeePerGas))} gwei</span>
          </>
        ) : null}
        <span>Events</span>
        <span>{rc?.logs?.length ?? 0}</span>
        {input && input !== "0x" ? (
          <>
            <span>Calldata</span>
            <span>
              {num((input.length - 2) / 2)} bytes · selector <code>{input.slice(0, 10)}</code>
            </span>
          </>
        ) : null}
      </div>
      <details>
        <summary className="small muted">Raw transaction and receipt</summary>
        <pre className="mono-block">{JSON.stringify({ transaction: tx, receipt: rc && { ...rc, logs: rc.logs?.length ? rc.logs : [] } }, null, 2)}</pre>
      </details>
    </>
  );
}

function ProofDetail({ r, others }) {
  const x = r.message ? explainRevert(r.message) : null;
  return (
    <div className="detail">
      <div className="label">The run</div>
      <div className="kv small">
        <span>Test</span>
        <span>
          <code>{r.id}</code> · {GROUPS[r.group]} · <Link to={`/proofs?id=${encodeURIComponent(r.id)}`}>in the proof ledger →</Link>
        </span>
        <span>Ran at</span>
        <span>
          {when(r.at)} <span className="muted">({r.at})</span>
        </span>
        <span>Network</span>
        <span>{LEGS[r.leg] ?? r.leg}</span>
        <span>Expected</span>
        <span>{r.expected}</span>
        <span>Got</span>
        <span>{OUTCOME[r.outcome] ?? r.outcome}</span>
        <span>Evidence</span>
        <span>
          <Evidence kind={r.evidence} /> <span className="muted">{EVIDENCE[r.evidence]?.note}</span>
        </span>
        <span>Recorded in</span>
        <span>
          {r.recordedIn?.length ? (
            r.recordedIn.map((c, i) => (
              <span key={c}>
                {i ? ", " : ""}
                <a className="mono" href={`${REPO}/commit/${c}`} target="_blank" rel="noreferrer">
                  {c}
                </a>
              </span>
            ))
          ) : (
            <span className="muted">not committed yet</span>
          )}
        </span>
        <span>Standing</span>
        <span>
          {r.latest ? "the current run for this test" : "superseded by a later run"}
          {others > 0 ? (
            <span className="muted">
              {" "}
              · {others} other run{others === 1 ? "" : "s"} of {r.id} on record
            </span>
          ) : null}
        </span>
      </div>

      <div className="label">Transaction</div>
      {r.txHash ? <ChainTx hash={r.txHash} leg={r.leg} gone={r.leg === "devnet" && r.evidence === "older"} /> : <div className="muted small">{r.outcome === "rejected-at-mempool" ? "None. It was refused before the mempool, so it never became a transaction." : r.outcome === "not-run" ? "None. This test did not run." : "None recorded."}</div>}
      {r.block ? <div className="small muted">Recorded at the time: block {num(r.block)}</div> : null}

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
          <div className="label">Gas per frame</div>
          <table className="plain num small">
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
                  <td>{num(f.execution)}</td>
                  <td>{num(f.state)}</td>
                </tr>
              ))}
              <tr>
                <th>Total</th>
                <th>{num(r.frameGas.reduce((a, f) => a + f.execution, 0))}</th>
                <th>{num(r.frameGas.reduce((a, f) => a + f.state, 0))}</th>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
      {r.extra ? (
        <>
          <div className="label">Also recorded</div>
          <pre className="mono-block">{JSON.stringify(r.extra, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}

function ProofRow({ r, open, toggle, others }) {
  const gas = r.frameGas?.reduce((a, f) => a + f.execution, 0);
  const err = errorName(r.message);
  return (
    <li className={`proof${open ? " open" : ""}`} id={keyOf(r)}>
      <button className="proof-head" aria-expanded={open} onClick={toggle}>
        <span className="pid mono">{r.id}</span>
        <span className="ptitle">
          <strong>{r.title}</strong>
          <span className="muted">
            {when(r.at)} · expects: {r.expected}
          </span>
        </span>
        <span className="pmeta">
          {r.outcome === "not-run" ? <Pill tone="mute">not run</Pill> : r.pass ? <Pill tone="ok">expected met</Pill> : <Pill tone="bad">expected not met</Pill>}
          <Evidence kind={r.evidence} />
          <Pill tone="mute">{LEGS[r.leg] ?? r.leg}</Pill>
          {r.latest ? <Pill tone="info">current</Pill> : <Pill tone="mute">superseded</Pill>}
        </span>
        <span className="pout">
          {OUTCOME[r.outcome] ?? r.outcome}
          {err ? (
            <>
              {" · "}
              <code>{err}</code>
            </>
          ) : null}
          {gas ? <span className="muted"> · {num(gas)} gas</span> : null}
          {r.txHash ? <span className="muted"> · tx {short(r.txHash)}</span> : null}
        </span>
      </button>
      {open ? <ProofDetail r={r} others={others} /> : null}
    </li>
  );
}

/** One live demo run: the server still has every step, so open it in full. */
function LiveRow({ r, info, open, toggle }) {
  const [full, setFull] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open || full) return;
    apiGet(`/suites/run/${r.id}`).then(setFull, setError);
  }, [open, full, r.id]);
  return (
    <li className={`proof${open ? " open" : ""}`}>
      <button className="proof-head" aria-expanded={open} onClick={toggle}>
        <span className="pid mono">{r.proof ?? r.case}</span>
        <span className="ptitle">
          <strong>{r.title}</strong>
          <span className="muted">{when(r.finishedAt)} · Sepolia, from the live demo</span>
        </span>
        <span className="pmeta">
          {r.asExpected ? <Pill tone="ok">as expected</Pill> : <Pill tone="bad">not as expected</Pill>}
          <Pill tone="mute">Sepolia</Pill>
        </span>
        <span className="pout">
          {KINDS[r.kind] ?? r.kind}
          {r.name ? (
            <>
              {" · "}
              <code>{r.name}</code>
            </>
          ) : null}
          {r.gasUsed ? <span className="muted"> · {num(r.gasUsed)} gas</span> : null}
          {r.txHash ? <span className="muted"> · tx {short(r.txHash)}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="detail">
          {error ? <Failed what="this run" error={error} /> : full ? <RunView run={full} info={info} /> : <Loading what="Loading the run" />}
          <div className="label">Transaction</div>
          {r.txHash ? <ChainTx hash={r.txHash} leg="sepolia" /> : <div className="muted small">None. It never reached a block.</div>}
        </div>
      ) : null}
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

function useOpen(initial) {
  const [open, setOpen] = useState(() => new Set(initial ? [initial] : []));
  const toggle = (k) =>
    setOpen((o) => {
      const n = new Set(o);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  return [open, toggle];
}

function LiveRuns() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [open, toggle] = useOpen();
  useEffect(() => {
    apiGet("/suites").then(setInfo, setError);
  }, []);
  const list = info?.history ?? info?.recent ?? [];
  return (
    <>
      <h2 className="section">Live demo runs</h2>
      <p className="muted small">
        Runs anyone started from <Link to="/demo">the live demo</Link>, on Sepolia. The server keeps these in memory, so this list starts empty each time it restarts.
      </p>
      {error ? (
        <div className="muted small">The server is not reachable, so there are no live runs to show: {error.message}</div>
      ) : !info ? (
        <Loading what="Asking the server" />
      ) : list.length ? (
        <ul className="proofs">
          {list.map((r) => (
            <LiveRow key={r.id} r={r} info={info} open={open.has(r.id)} toggle={() => toggle(r.id)} />
          ))}
        </ul>
      ) : (
        <div className="muted small">No live runs since the server last started.</div>
      )}
    </>
  );
}

export default function History() {
  const d = useData(["history.json", "manifest.json"]);
  const [params, setParams] = useSearchParams();
  const [open, toggle] = useOpen(params.get("run"));
  const f = { q: params.get("q") ?? "", leg: params.get("leg") ?? "", outcome: params.get("outcome") ?? "", result: params.get("result") ?? "", group: params.get("group") ?? "", standing: params.get("standing") ?? "", tx: params.get("tx") ?? "" };
  const set = (k) => (v) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const all = useMemo(() => (d.data ? d.data[0].map((r) => ({ ...r, leg: legOf(r), evidence: evidenceOf(r), group: groupOf(r.id) })) : []), [d.data]);
  const runsOf = useMemo(() => all.reduce((m, r) => m.set(r.id, (m.get(r.id) ?? 0) + 1), new Map()), [all]);

  useEffect(() => {
    const k = params.get("run");
    if (k && all.length) document.getElementById(k)?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.length]);

  if (d.loading) return <Loading what="Loading the history" />;
  if (d.error) return <Failed what="history.json" error={d.error} />;
  const [, manifest] = d.data;

  const q = f.q.trim().toLowerCase();
  const shown = all.filter(
    (r) =>
      (!q || [r.id, r.title, r.expected, r.message, r.txHash].some((s) => s?.toLowerCase().includes(q))) &&
      (!f.leg || r.leg === f.leg) &&
      (!f.outcome || r.outcome === f.outcome) &&
      (!f.result || resultOf(r) === f.result) &&
      (!f.group || r.group === f.group) &&
      (!f.standing || (f.standing === "current") === r.latest) &&
      (!f.tx || (f.tx === "yes") === Boolean(r.txHash)),
  );
  const days = [];
  for (const r of shown) {
    const k = day(r.at);
    if (days.at(-1)?.k !== k) days.push({ k, runs: [] });
    days.at(-1).runs.push(r);
  }
  const txs = all.filter((r) => r.txHash).length;
  const met = all.filter((r) => r.pass).length;
  const first = all.at(-1)?.at;
  const last = all[0]?.at;

  return (
    <>
      <h1>Test history</h1>
      <p className="lede">Every test run on record, not just the latest. The proof ledger keeps one run per test; this page keeps all of them, from every version of it in git, with what the chain says about each transaction today.</p>
      <div className="counters">
        <div className="counter">
          <div className="big">{num(all.length)}</div>
          <div>runs of {runsOf.size} tests</div>
        </div>
        <div className="counter">
          <div className="big">{num(txs)}</div>
          <div>produced a transaction; the rest were refused before the mempool or did not run</div>
        </div>
        <div className="counter">
          <div className="big">{num(met)}</div>
          <div>met their expected result at the time</div>
        </div>
        <div className="counter">
          <div className="big small-big">{first ? `${new Date(first).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "—"}</div>
          <div>first run to latest</div>
        </div>
      </div>

      <LiveRuns />

      <h2 className="section">Proof runs</h2>
      <div className="filters">
        <label className="filter">
          <span>Search</span>
          <input type="search" value={f.q} placeholder="id, title, error or tx hash" onChange={(e) => set("q")(e.target.value)} />
        </label>
        <Select label="Network" value={f.leg} onChange={set("leg")} options={LEGS} />
        <Select label="Outcome" value={f.outcome} onChange={set("outcome")} options={OUTCOME} />
        <Select label="Result" value={f.result} onChange={set("result")} options={RESULTS} />
        <Select label="Group" value={f.group} onChange={set("group")} options={GROUPS} />
        <Select label="Standing" value={f.standing} onChange={set("standing")} options={{ current: "current run", superseded: "superseded" }} />
        <Select label="Transaction" value={f.tx} onChange={set("tx")} options={{ yes: "has a transaction", no: "no transaction" }} />
      </div>
      <div className="muted small">
        {shown.length} of {all.length} runs ·{" "}
        <a href="/data/history.json" download>
          history.json
        </a>{" "}
        as of commit <code>{manifest.commit}</code>
      </div>
      {days.map(({ k, runs }) => (
        <section key={k}>
          <div className="label">
            {k} · {runs.length} run{runs.length === 1 ? "" : "s"}
          </div>
          <ul className="proofs">
            {runs.map((r) => (
              <ProofRow key={keyOf(r)} r={r} open={open.has(keyOf(r))} toggle={() => toggle(keyOf(r))} others={runsOf.get(r.id) - 1} />
            ))}
          </ul>
        </section>
      ))}
      {!shown.length ? <div className="muted pad">No runs match these filters.</div> : null}
    </>
  );
}

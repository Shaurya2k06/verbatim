import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { PUBLIC_GATEWAY_GAS, STATELESS_GAS } from "@verbatim/client";
import { Evidence, Pill } from "../components/Badge";
import { Markdown } from "../components/Markdown";
import { ProofRef } from "../components/ProofRef";
import { Failed, Loading } from "../components/States";
import { useData, useText } from "../lib/data";

const CAP = 100_000;
const SIG = 2_800; // one protocol-validated SECP256K1 entry; G0c measured the cap with signatures counted
const n = (x) => Number(x).toLocaleString();

const F = ({ k, t, tone }) => (
  <div className={`frame ${tone ?? ""}`}>
    <span className="mono">{k}</span>
    <strong>{t}</strong>
  </div>
);

function Paths() {
  return (
    <div className="grid2">
      <div className="panel">
        <h2>Stateless path</h2>
        <div className="frames">
          <F k="0 VERIFY" t="expiry" />
          <F k="1 VERIFY" t="account: re-render + snapshot proofs" tone="hot" />
          <F k="2 SENDER" t="account: execute + assert" />
        </div>
        <p className="small">Public mempool, no stake. The account proves every leaf it used against the attested root, inside the transaction, so a trust update invalidates nothing pending.</p>
      </div>
      <div className="panel">
        <h2>Paymaster path</h2>
        <div className="frames">
          <F k="0 VERIFY" t="expiry" />
          <F k="1 VERIFY" t="account: signatures, layout" />
          <F k="2 VERIFY" t="paymaster: re-render from its cache" tone="hot" />
          <F k="3 SENDER" t="account: execute + assert" />
        </div>
        <p className="small">The alternative mempool's heavy-render path. The staked paymaster reads its own storage (STORAGE-031), which the canonical mempool refuses. A trust refresh can invalidate pending transactions that used what changed.</p>
      </div>
    </div>
  );
}

function GasTable({ rows }) {
  return (
    <div className="panel">
      <h2>
        Validation gas, paymaster path <Evidence kind="older" />
      </h2>
      <div className="scroll">
        <table className="plain num small">
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Expiry</th>
              <th>Account</th>
              <th>Paymaster render</th>
              <th>Signatures</th>
              <th>Prefix</th>
              <th>Headroom vs 100k</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const total = r.expiry + r.frame0 + r.frame1 + 2 * SIG;
              return (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{n(r.expiry)}</td>
                  <td>{n(r.frame0)}</td>
                  <td>{n(r.frame1)}</td>
                  <td>{n(2 * SIG)}</td>
                  <td>{n(total)}</td>
                  <td className={CAP - total < 10_000 ? "neg" : ""}>{n(CAP - total)}</td>
                </tr>
              );
            })}
            <tr>
              <td>ERC-20 swap (approve + swap)</td>
              <td colSpan={5} className="muted" style={{ textAlign: "left" }}>
                not measured as one transaction: the second call adds about 21,500 to the render
              </td>
              <td className="neg">doesn't fit in 100k</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        From <code>docs/prefix-measurements.json</code>, the last measurement on the four-frame layout before the devnet stopped. Signature cost counts against the cap (proof <Link to="/proofs?id=G0c">G0c</Link>: 100,000 admitted, 100,001 refused). The stateless path has not been measured live yet; its declared budget is {n(STATELESS_GAS.expiry + STATELESS_GAS.account)} plus signatures. These numbers are replaced when the devnet rerun lands.
      </p>
      <details>
        <summary className="small">Full measurements (docs/GAS.md)</summary>
        <Markdown path="docs/GAS.md" strip />
      </details>
    </div>
  );
}

function Simulator({ rows }) {
  const [i, setI] = useState(0);
  const [stake, setStake] = useState(true);
  const r = rows[i];
  const pm = r.expiry + r.frame0 + r.frame1 + 2 * SIG;
  const statelessBudget = Number(STATELESS_GAS.expiry + STATELESS_GAS.account) + 4 * SIG;
  const pmBudget = Number(PUBLIC_GATEWAY_GAS.expiry + PUBLIC_GATEWAY_GAS.account + PUBLIC_GATEWAY_GAS.paymaster) + 2 * SIG;
  // The rule the wallet follows: stateless whenever it fits, since it needs no stake and survives trust updates.
  const route = r.frame1 + 20_000 <= Number(STATELESS_GAS.account) ? "stateless" : stake && pm <= CAP ? "paymaster" : "none";
  return (
    <div className="panel">
      <h2>Routing simulator</h2>
      <div className="row">
        <label className="filter">
          <span>Transaction type</span>
          <select value={i} onChange={(e) => setI(Number(e.target.value))}>
            {rows.map((x, j) => (
              <option key={x.name} value={j}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="switch">
          <input type="checkbox" checked={stake} onChange={(e) => setStake(e.target.checked)} />
          <span>A staked paymaster is available</span>
        </label>
      </div>
      <div className="kv small">
        <span>Render cost (measured)</span>
        <span>{n(r.frame1)}</span>
        <span>Stateless budget</span>
        <span>
          {n(statelessBudget)} declared ({n(STATELESS_GAS.account)} for the account frame, which also verifies the snapshot proofs)
        </span>
        <span>Paymaster prefix</span>
        <span>
          {n(pm)} of {n(pmBudget)} declared, cap {n(CAP)}
        </span>
        <span>Route</span>
        <span>
          <Pill tone={route === "none" ? "bad" : "ok"}>{route}</Pill>{" "}
          {route === "stateless"
            ? "The render plus proof checks fit the account frame: no stake, and a trust update invalidates nothing pending."
            : route === "paymaster"
              ? "Too heavy to prove inline, so a staked paymaster renders from its cache."
              : "Neither path fits: split the batch, or wait for a higher cap."}
        </span>
      </div>
      <p className="small muted">An estimate: proof verification is taken as about 20k over the render, pending live stateless measurements.</p>
    </div>
  );
}

function Findings() {
  const s = useText("docs/FINDINGS.md");
  const cards = useMemo(() => {
    if (!s.data) return [];
    const out = [];
    for (const sec of s.data.split(/\n## /).slice(1)) {
      const [title, ...body] = sec.split("\n");
      if (/^Also found/.test(title)) {
        for (const b of body.join("\n").split(/\n- /).map((x) => x.replace(/^- /, "").trim()).filter(Boolean)) {
          const m = b.match(/^\*\*(.+?)\*\*\s*([\s\S]*)/);
          if (m) out.push({ title: m[1].replace(/\.$/, ""), body: m[2] });
        }
      } else out.push({ title, body: body.join("\n").trim() });
    }
    // Lead with the starved expiry frame: the finding that changed the design.
    return out.sort((a, b) => (/starved/i.test(b.title) ? 1 : 0) - (/starved/i.test(a.title) ? 1 : 0));
  }, [s.data]);
  if (s.loading) return <Loading />;
  if (s.error) return <Failed what="findings" error={s.error} />;
  return (
    <div className="findings">
      {cards.map((c) => (
        <div key={c.title} className="panel">
          <strong>{c.title}</strong>
          <div className="md small" dangerouslySetInnerHTML={{ __html: marked.parse(c.body) }} />
        </div>
      ))}
    </div>
  );
}

export default function Mempool() {
  const d = useData(["docs/prefix-measurements.json", "proofs.json"]);
  return (
    <>
      <h1>Paths and mempool lab</h1>
      <p className="lede">Two ways to make the chain re-render a sentence in validation, measured on the EIP-8141 frames devnet through the ERC-8421 alternative mempool.</p>
      <Paths />
      {d.loading ? <Loading /> : d.error ? <Failed what="measurements" error={d.error} /> : (
        <>
          <GasTable rows={d.data[0]} />
          <Simulator rows={d.data[0]} />
          <div className="panel">
            <h2>Invalidation</h2>
            <p className="small">
              On the paymaster path, a trust update can make pending transactions fail validation. Expected: N evicted on the paymaster path, 0 on the stateless path. The N=50 benchmark has not run yet: it needs the devnet. What was measured, with 5 transactions:
            </p>
            <ProofRef id="A15" />
            <p className="small muted">Method: re-running validation for each pending transaction through ethrex_simulateFrameTransaction, the call the sidecar makes. Limit: they shared a sender, so they were not all pending at once.</p>
          </div>
        </>
      )}
      <div className="panel">
        <h2>Rules we rely on (ERC-8421)</h2>
        <Markdown path="docs/ALTMEMPOOL.md" strip />
      </div>
      <h2 className="section">Where the sidecar differs</h2>
      <Findings />
    </>
  );
}

import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { OUTCOME, errorName, rows } from "../lib/evidence";
import { Evidence, Pill } from "./Badge";
import { TxLink } from "./TxLink";

/** One recorded proof, inline, with its evidence badge. */
export function ProofRef({ id }) {
  const d = useData("proofs.json");
  if (!d.data) return null;
  const r = rows(d.data).find((x) => x.id === id);
  if (!r) return <div className="proofref muted">No recorded proof {id} yet.</div>;
  const err = errorName(r.message);
  return (
    <div className="proofref">
      <div className="proofref-head">
        <Link to={`/proofs?id=${encodeURIComponent(r.id)}`} className="mono">
          {r.id}
        </Link>
        <strong>{r.title}</strong>
      </div>
      <div className="badges">
        {r.outcome === "not-run" ? <Pill>not run</Pill> : r.pass ? <Pill tone="ok">expected met</Pill> : <Pill tone="bad">expected not met</Pill>}
        <Evidence kind={r.evidence} />
      </div>
      <div className="small">
        {OUTCOME[r.outcome] ?? r.outcome}
        {err ? (
          <>
            {" · "}
            <code>{err}</code>
          </>
        ) : null}
        {r.txHash ? (
          <>
            {" · "}
            <TxLink hash={r.txHash} leg={r.leg} />
          </>
        ) : null}
      </div>
    </div>
  );
}

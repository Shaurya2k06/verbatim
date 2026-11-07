// The end-to-end workflows: one swap followed from the click to the block, the whole demo in order, the general cases, and every proof
// on record, each runnable where the server can run it. The pages for Uniswap and ENS hold what is specific to them. Every run here
// is real, and every transaction lands in the dropdown.
import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Lifecycle } from "../components/Lifecycle";
import { ProofLedger } from "../components/ProofLedger";
import { SuiteRunner } from "../components/SuiteRunner";
import { TxLog } from "../components/TxLog";

export default function Demo() {
  const [txs, setTxs] = useState([]);
  const addTx = (t) => setTxs((x) => [...x, { id: `${Date.now()}-${x.length}`, at: Date.now(), ...t }]);
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linked = hash === "#proofs" || Boolean(params.get("id"));
  const [proofsOpen, setProofsOpen] = useState(linked);

  // A link to a proof opens the ledger, even when this page is already showing.
  useEffect(() => {
    if (linked) setProofsOpen(true);
  }, [linked, params]);

  return (
    <>
      <h1>Live demo</h1>
      <p className="lede">
        End-to-end workflows, run for real. Follow one swap from the click to the block, run the whole demo in order, run the general cases one at a time, or open every proof on record and run it again. The Uniswap and ENS pages hold the tests specific to them.
      </p>
      <TxLog entries={txs} onClear={() => setTxs([])} />
      <Lifecycle onTx={addTx} />
      <section className="panel" id="cases">
        <h2>The general cases</h2>
        <p className="muted small">Signed sentences, stale signatures, and promises checked after the calls. Each runs on Sepolia when you press Run.</p>
        <SuiteRunner topic="general" onTx={addTx} facts />
      </section>
      <section className="panel" id="proofs">
        <div className="proofs-toggle-head">
          <div>
            <h2>Every proof</h2>
            <p className="muted small">The proof ledger: every claim, with what a live network returned. Rows the server can run again have a Run button.</p>
          </div>
          <button type="button" className="lp-btn lp-btn-outline" aria-expanded={proofsOpen} aria-controls="proof-ledger" onClick={() => setProofsOpen((o) => !o)}>
            {proofsOpen ? "Hide the proofs" : "Show every proof"}
          </button>
        </div>
        {proofsOpen ? (
          <div id="proof-ledger">
            <ProofLedger onTx={addTx} />
          </div>
        ) : null}
      </section>
    </>
  );
}

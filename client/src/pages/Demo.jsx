// The end-to-end workflows: one swap followed from the click to the block, the whole demo in order, and the general cases. The pages
// for Uniswap and ENS hold what is specific to them. Every run here is real, on Sepolia, and every transaction lands in the dropdown.
import { useState } from "react";
import { Lifecycle } from "../components/Lifecycle";
import { SuiteRunner } from "../components/SuiteRunner";
import { TxLog } from "../components/TxLog";

export default function Demo() {
  const [txs, setTxs] = useState([]);
  const addTx = (t) => setTxs((x) => [...x, { id: `${Date.now()}-${x.length}`, at: Date.now(), ...t }]);
  return (
    <>
      <h1>Live demo</h1>
      <p className="lede">
        End-to-end workflows, run for real on Sepolia. Follow one swap from the click to the block, run the whole demo in order, or run the general cases one at a time. The Uniswap and ENS pages hold the tests specific to them.
      </p>
      <TxLog entries={txs} onClear={() => setTxs([])} />
      <Lifecycle onTx={addTx} />
      <section className="panel" id="cases">
        <h2>The general cases</h2>
        <p className="muted small">Signed sentences, stale signatures, and promises checked after the calls. Each runs on Sepolia when you press Run.</p>
        <SuiteRunner topic="general" onTx={addTx} facts />
      </section>
    </>
  );
}

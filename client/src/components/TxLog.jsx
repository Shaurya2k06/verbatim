// Every transaction this page has produced, in one dropdown: the side-by-side swaps, the lifecycle runs and the full demo. A refusal
// before the mempool produces no transaction, so it is listed as that rather than left out: the list shows what happened, not only what landed.
import { Pill } from "./Badge";
import { TxLink } from "./TxLink";

const KIND = {
  landed: { tone: "ok", text: "landed" },
  skimmed: { tone: "bad", text: "landed, and the hook took the output" },
  reverted: { tone: "warn", text: "mined, batch reverted" },
  rejected: { tone: "ok", text: "refused before the mempool" },
  "device-refused": { tone: "ok", text: "the device refused to sign" },
  error: { tone: "bad", text: "did not finish" },
};

const clock = (t) => new Date(t).toISOString().slice(11, 19);

export function TxLog({ entries, onClear }) {
  const mined = entries.filter((e) => e.txHash).length;
  return (
    <details className="panel txlog" open={entries.length > 0 ? undefined : false}>
      <summary>
        <strong>All transactions from this demo</strong>{" "}
        <span className="muted small">
          {entries.length ? `${entries.length} run${entries.length === 1 ? "" : "s"}, ${mined} mined, ${entries.length - mined} refused before the mempool` : "none yet: run something below"}
        </span>
      </summary>
      {entries.length ? (
        <>
          <table className="lc-table txlog-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>What</th>
                <th>Result</th>
                <th>Transaction</th>
                <th>Block</th>
                <th>Gas</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const k = KIND[e.kind] ?? { text: e.kind };
                return (
                  <tr key={e.id}>
                    <td>{clock(e.at)}</td>
                    <td>{e.label}</td>
                    <td>
                      <Pill tone={k.tone}>{k.text}</Pill>
                      {e.error ? <div className="muted small mono">{e.error}</div> : null}
                    </td>
                    <td>{e.txHash ? <TxLink hash={e.txHash} leg={e.leg ?? "sepolia"} /> : <span className="muted small">none: it never reached a block</span>}</td>
                    <td>{e.block ?? ""}</td>
                    <td>{e.gas ? Number(e.gas).toLocaleString("en-US") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row">
            <button onClick={onClear}>Clear the list</button>
          </div>
        </>
      ) : null}
    </details>
  );
}

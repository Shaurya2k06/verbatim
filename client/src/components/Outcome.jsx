// What the chain did with a user operation, in the site's one vocabulary.
import { Pill } from "./Badge";
import { TxLink } from "./TxLink";

export function Outcome({ o }) {
  if (!o) return null;
  if (o.error) return <div className="bad">{o.error}</div>;
  if (o.rejected) {
    return (
      <div>
        <div className="bad">
          Rejected in validation. It never reached the mempool, and nothing was paid.
          {o.reason?.name ? (
            <>
              {" "}
              The account says <code>{o.reason.raw}</code>
              {o.reason.human ? `: ${o.reason.human}` : "."}
            </>
          ) : null}
        </div>
        {!o.reason?.name ? <div className="mono">{o.reason?.raw ?? o.bundler}</div> : null}
        <div className="muted small">The bundler said: {String(o.bundler).slice(0, 200)}</div>
      </div>
    );
  }
  if (o.pending) return <div className="muted">Admitted by the bundler. Waiting for a block… {o.userOpHash ? <code>{o.userOpHash.slice(0, 18)}…</code> : null}</div>;
  const ok = o.result?.ok;
  return (
    <div>
      {ok ? (
        <div className="ok">Landed. Every guarantee in the sentence held.</div>
      ) : (
        <div className="bad">
          Mined, and the batch reverted: everything was undone, only the fee was paid.
          {o.result?.error?.raw ? (
            <>
              {" "}
              <code>{o.result.error.raw}</code>
              {o.result.error.human ? `: ${o.result.error.human}` : ""}
            </>
          ) : null}
        </div>
      )}
      <div className="row small">
        <TxLink hash={o.txHash} leg="sepolia" />
        {o.actualGasUsed ? <Pill>{o.actualGasUsed.toLocaleString()} gas</Pill> : null}
      </div>
    </div>
  );
}

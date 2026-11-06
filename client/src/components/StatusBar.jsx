import { useNetwork } from "../lib/network-context";

const ago = (s) => (s === null ? "—" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`);

function Leg({ leg }) {
  const { status, ageOf, stateOf } = useNetwork();
  const s = status[leg.id];
  const state = stateOf(leg.id);
  const relayTone = s?.relay === "up" ? "ok" : s?.relay === "down" ? "bad" : "mute";
  return (
    <div className={`leg leg-${state}`} title={s?.rpcError ?? s?.relayError ?? ""}>
      <span className="dot" aria-hidden />
      <span className="leg-name">{leg.name}</span>
      <span className="leg-meta">
        {leg.chainId}
        {s?.rpcOk ? ` · #${s.head.toLocaleString()} · ${ago(ageOf(leg.id))}` : s ? " · unreachable" : " · checking"}
      </span>
      <span className={`leg-relay tone-${relayTone}`}>
        {leg.relay.label} {s?.relay ?? "…"}
      </span>
    </div>
  );
}

export function StatusBar() {
  const { legs, deploymentsError } = useNetwork();
  return (
    <div className="statusbar" role="status" aria-label="Network status">
      {deploymentsError ? <div className="leg leg-degraded">deployments not published: {deploymentsError.message}</div> : legs.map((l) => <Leg key={l.id} leg={l} />)}
    </div>
  );
}

/** Shown on every page while the devnet is not producing blocks. */
export function DevnetBanner() {
  const { stateOf, legs } = useNetwork();
  if (!legs.some((l) => l.id === "devnet") || stateOf("devnet") !== "degraded") return null;
  return <div className="banner">Frames devnet is not producing blocks. Live actions are disabled; recorded proofs are shown.</div>;
}

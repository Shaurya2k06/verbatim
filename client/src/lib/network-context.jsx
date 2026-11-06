// Polls each leg's head block and relay, so any page can ask "is this leg live?" and fall back to recorded proofs.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useDeployments } from "./data";
import { STALE_AFTER_S, legsFrom, rpc } from "./networks";

const Ctx = createContext(null);
const POLL_MS = 15_000;

async function probe(leg) {
  const s = { id: leg.id, checkedAt: Date.now() };
  try {
    const b = await rpc(leg.rpc, "eth_getBlockByNumber", ["latest", false]);
    s.head = Number(b.number);
    s.headTime = Number(b.timestamp);
    s.rpcOk = true;
  } catch (e) {
    s.rpcOk = false;
    s.rpcError = e.name === "AbortError" ? "timed out" : e.message;
  }
  if (leg.relay.url) {
    try {
      await rpc(leg.relay.url, leg.relay.method);
      s.relay = "up";
    } catch (e) {
      s.relay = "down";
      s.relayError = e.name === "AbortError" ? "timed out" : e.message;
    }
  } else s.relay = "not configured";
  return s;
}

export function NetworkProvider({ children }) {
  const deps = useDeployments();
  const legs = useMemo(() => (deps.data ? legsFrom(deps.data) : []), [deps.data]);
  const [status, setStatus] = useState({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!legs.length) return;
    let live = true;
    const tick = () => legs.forEach((l) => probe(l).then((s) => live && setStatus((x) => ({ ...x, [l.id]: s }))));
    tick();
    const t = setInterval(tick, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, [legs]);

  const value = useMemo(() => {
    const ageOf = (id) => (status[id]?.headTime ? Math.max(0, Math.floor(now / 1000) - status[id].headTime) : null);
    /** "loading" until first probe, then "live" or "degraded". */
    const stateOf = (id) => {
      const s = status[id];
      if (!s) return "loading";
      if (!s.rpcOk) return "degraded";
      const age = ageOf(id);
      return age !== null && age > STALE_AFTER_S ? "degraded" : "live";
    };
    return { deployments: deps.data, deploymentsError: deps.error, legs, status, ageOf, stateOf, isLive: (id) => stateOf(id) === "live" };
  }, [deps.data, deps.error, legs, status, now]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNetwork = () => useContext(Ctx);

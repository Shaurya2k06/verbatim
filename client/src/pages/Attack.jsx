import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { parseAbi, parseEther } from "viem";
import { Pill } from "../components/Badge";
import { OpRunner } from "../components/OpRunner";
import { ProofRef } from "../components/ProofRef";
import { apiGet, apiPost } from "../lib/api";
import { ATTACKS, ATTACK_GROUPS, LAYER } from "../lib/attacks";
import { useNetwork } from "../lib/network-context";
import { sepoliaPublic } from "../lib/networks";
import { accountState, quote } from "../lib/userop";

const HOOK = parseAbi(["function ATTACKER() view returns (address)"]);

/** Shared state between the judge's phone and the team's laptop, by polling the server. */
function useSession(code) {
  const [s, set] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!code) return;
    let live = true;
    const tick = () =>
      apiGet(`/session/${code}`)
        .then((x) => live && (set(x), setErr(null)))
        .catch((e) => live && setErr(e.message));
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [code]);
  return [s, err];
}

function Scoreboard({ events }) {
  const done = events.filter((e) => e.stage === "done");
  const rejected = done.filter((e) => e.outcome === "rejected-at-validation").length;
  const reverted = done.filter((e) => e.outcome === "reverted-in-batch").length;
  const landed = done.filter((e) => e.outcome === "landed").length;
  const refused = events.filter((e) => e.stage === "device-refused").length;
  return (
    <div className="scoreboard">
      <div>
        <div className="big">{done.length + refused}</div>attempts
      </div>
      <div>
        <div className="big">{rejected}</div>rejected in validation
      </div>
      <div>
        <div className="big">{reverted}</div>reverted in batch
      </div>
      <div>
        <div className="big">{refused}</div>refused by the device
      </div>
      <div className={landed ? "warn" : "zero"}>
        <div className="big">{landed ? `${landed} landed` : "$0"}</div>
        {landed ? "attacks landed: check each one" : "stolen"}
      </div>
    </div>
  );
}

function SessionBar({ code, role, setParams }) {
  const [join, setJoin] = useState("");
  const canvas = useRef(null);
  const judgeUrl = code ? `${location.origin}/attack?s=${code}&role=judge` : "";
  useEffect(() => {
    if (canvas.current && judgeUrl) QRCode.toCanvas(canvas.current, judgeUrl, { margin: 1, width: 132 });
  }, [judgeUrl]);
  if (code)
    return (
      <div className="panel session">
        <div>
          <div className="label">Session</div>
          <div className="code">{code}</div>
          <div className="small muted">{role === "judge" ? "You pick attacks; the team signs on the device." : "Judges join with this code and pick attacks; you sign them."}</div>
          <button className="chip" onClick={() => setParams({})}>
            Leave
          </button>
        </div>
        {role !== "judge" ? <canvas ref={canvas} aria-label="Join link as a QR code" /> : null}
      </div>
    );
  return (
    <div className="panel session">
      <div>
        <div className="label">Run it together</div>
        <p className="small">The team starts a session on the laptop that signs. Judges join on their phones and pick attacks.</p>
        <div className="row">
          <button className="primary" onClick={async () => setParams({ s: (await apiPost("/session")).code, role: "host" })}>
            Start a session
          </button>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (join.trim()) setParams({ s: join.trim().toUpperCase(), role: "judge" });
            }}
          >
            <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder="Code" maxLength={4} aria-label="Session code" style={{ width: "7em" }} />
            <button>Join</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Card({ a, onRun, onProof, canRun, requested }) {
  return (
    <article className="attack">
      <header>
        <span className="mono">{a.id}</span>
        <strong>{a.title}</strong>
      </header>
      <p>{a.plain}</p>
      <div className="small muted">
        {LAYER[a.layer]} · expects <code>{a.expect}</code>
      </div>
      <div className="row">
        {a.live ? (
          <button className="primary" disabled={!canRun.ok} title={canRun.ok ? "" : canRun.why} onClick={() => onRun(a)}>
            {requested ? "Requested" : "Run live"}
          </button>
        ) : a.link ? (
          <Link className="button" to={a.link[0]}>
            {a.link[1]}
          </Link>
        ) : (
          <button disabled title={a.why}>
            Run live
          </button>
        )}
        <button onClick={() => onProof(a)}>Show recorded proof</button>
      </div>
      {!a.live && a.why ? <div className="small muted">{a.why}</div> : null}
      {a.live && !canRun.ok ? <div className="small muted">{canRun.why}</div> : null}
    </article>
  );
}

export default function Attack() {
  const { deployments, stateOf } = useNetwork();
  const dep = deployments?.sepolia;
  const [params, setParams] = useSearchParams();
  const code = params.get("s");
  const role = params.get("role") ?? "host";
  const [session, sessionErr] = useSession(code);
  const [ctx, setCtx] = useState(null);
  const [panel, setPanel] = useState(null); // { attack, mode: "run" | "proof", request? }
  const [localEvents, setLocalEvents] = useState([]);
  const live = stateOf("sepolia") === "live";

  useEffect(() => {
    if (!dep || role === "judge") return;
    let ok = true;
    Promise.all([accountState(dep.account), sepoliaPublic().readContract({ address: dep.skimHook, abi: HOOK, functionName: "ATTACKER" }), quote(dep, dep.pools.eth.key, parseEther("0.001"))])
      .then(([account, attacker, q]) => ok && setCtx({ dep, account, attacker, minOut: (q * 99n) / 100n }))
      .catch((e) => ok && setCtx({ error: e.shortMessage ?? e.message }));
    return () => {
      ok = false;
    };
  }, [dep, role]);

  const events = code ? (session?.events ?? []) : localEvents;
  const record = useCallback(
    (attack, request) => (e) => {
      const ev = { attack: attack.id, request, stage: e.stage, outcome: e.outcome, error: e.error, txHash: e.txHash, userOpHash: e.userOpHash, leg: "sepolia", at: Date.now() };
      if (code) apiPost(`/session/${code}/event`, ev).catch(() => {});
      else setLocalEvents((x) => [...x, ev]);
    },
    [code],
  );

  const canRun = !live ? { ok: false, why: "Sepolia is unreachable right now." } : role === "judge" ? { ok: true } : !ctx ? { ok: false, why: "Reading the account…" } : ctx.error ? { ok: false, why: ctx.error } : { ok: true };
  const run = async (a) => {
    if (role === "judge") {
      await apiPost(`/session/${code}/request`, { attack: a.id, from: "judge" }).catch(() => {});
      setPanel({ attack: a, mode: "watch" });
    } else setPanel({ attack: a, mode: "run" });
  };

  // The host sees judges' requests and opens the newest one.
  const seen = useRef(new Set());
  const pending = (session?.requests ?? []).filter((r) => !events.some((e) => String(e.request) === String(r.id) && e.stage === "done"));
  useEffect(() => {
    if (role === "judge" || !session) return;
    for (const r of session.requests) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      const a = ATTACKS.find((x) => x.id === r.attack);
      if (a && !panel) setPanel({ attack: a, mode: "run", request: r.id });
    }
  }, [session, role, panel]);

  const spec = useMemo(() => (panel?.mode === "run" && ctx && !ctx.error ? panel.attack.live?.(ctx) : null), [panel, ctx]);

  return (
    <>
      <h1>Attack us</h1>
      <p className="lede">Pick an attack. The team signs whatever the offline device shows. Watch where it stops.</p>
      <Scoreboard events={events} />
      <SessionBar code={code} role={role} setParams={setParams} />
      {sessionErr ? <div className="bad">{sessionErr}</div> : null}
      {role !== "judge" && pending.length ? (
        <div className="panel">
          <div className="label">Requests from judges</div>
          {pending.map((r) => {
            const a = ATTACKS.find((x) => x.id === r.attack);
            return a ? (
              <button key={r.id} className="chip" onClick={() => setPanel({ attack: a, mode: "run", request: r.id })}>
                #{r.id} {a.id} {a.title}
              </button>
            ) : null;
          })}
        </div>
      ) : null}

      {ATTACK_GROUPS.map(([g, label]) => (
        <section key={g}>
          <h2 className="section">{label}</h2>
          <div className="attacks">
            {ATTACKS.filter((a) => a.group === g).map((a) => (
              <Card key={a.id} a={a} canRun={canRun} requested={role === "judge" && session?.requests.some((r) => r.attack === a.id)} onRun={run} onProof={(x) => setPanel({ attack: x, mode: "proof" })} />
            ))}
          </div>
        </section>
      ))}

      <div className="callout">
        <strong>What this proves, and what it doesn't.</strong> It proves a tampering host or frontend cannot get a transaction past the account with a sentence that does not match its calldata, and that execution enforces the guarantees. It does not cover stolen keys, compromised machine signers, sentences that are accurate but misunderstood, or a captured attestor quorum mislabelling things. See the scope on the <Link to="/">home page</Link>.
      </div>

      {panel ? (
        <div className="sheet" role="dialog" aria-label={`${panel.attack.id} ${panel.attack.title}`}>
          <div className="sheet-head">
            <div>
              <span className="mono">{panel.attack.id}</span> <strong>{panel.attack.title}</strong>
              <div className="small muted">
                Expected: {LAYER[panel.attack.layer]} · <code>{panel.attack.expect}</code>
              </div>
            </div>
            <button onClick={() => setPanel(null)}>Close</button>
          </div>
          <div className="sheet-body">
            {panel.mode === "proof" ? (
              <ProofRef id={panel.attack.proof} />
            ) : panel.mode === "watch" ? (
              <Watch events={events.filter((e) => e.attack === panel.attack.id)} attack={panel.attack} />
            ) : spec ? (
              <OpRunner key={`${panel.attack.id}-${panel.request ?? "local"}`} spec={spec} account={ctx.account} onEvent={record(panel.attack, panel.request)} claimedTitle={spec.lie ? "The device shows (the frontend's sentence)" : "The device shows"} />
            ) : (
              <div className="muted">{ctx?.error ?? "Preparing…"}</div>
            )}
            {panel.mode !== "proof" ? (
              <>
                <div className="label">Recorded</div>
                <ProofRef id={panel.attack.proof} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Watch({ events, attack }) {
  const last = events.at(-1);
  return (
    <div>
      {!events.length ? <div className="muted">Waiting for the team to build and sign {attack.id}…</div> : null}
      <ol className="events">
        {events.map((e, i) => (
          <li key={i}>
            <strong>{e.stage}</strong>
            {e.outcome ? <Pill tone={e.outcome === "landed" ? "bad" : "ok"}>{e.outcome}</Pill> : null}
            {e.error ? <code> {e.error}</code> : null}
          </li>
        ))}
      </ol>
      {last?.txHash ? (
        <a href={`https://sepolia.etherscan.io/tx/${last.txHash}`} target="_blank" rel="noreferrer">
          Transaction ↗
        </a>
      ) : null}
    </div>
  );
}

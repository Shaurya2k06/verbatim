import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { encodeFunctionData, formatEther, formatUnits, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { RISK_TEXT } from "@verbatim/displayvm-ts";
import { BIT } from "@verbatim/urrender";
import { Pill } from "../components/Badge";
import { OpRunner } from "../components/OpRunner";
import { Loading } from "../components/States";
import { short } from "../components/TxLink";
import { apiPost, serverConfig } from "../lib/api";
import { config as ensConfig, resolveName } from "../lib/ens";
import { useNetwork } from "../lib/network-context";
import { addressUrl, sepoliaPublic } from "../lib/networks";
import { ERC20, accountState, quote, swapCall, transferCall } from "../lib/userop";
import { SentenceList } from "./Sentences";

const ADMIN = parseAbi(["function addOwner(address)", "function removeOwner(address)", "function setThreshold(uint8)", "function setAttestors(address[],uint8)", "function setPolicy(uint32,uint32,uint32)", "function addWatch(address)"]);
const SYMBOL = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

// allowMask bits: risk classes the owners chose to let through. Names as the policy reads them.
const ALLOW = [
  [BIT.UNVERIFIED, "unverified contracts"],
  [BIT.BLIND, "calls nobody can read (blind data)"],
  [BIT.UNLIMITED, "unlimited approvals"],
  [BIT.NO_MIN_OUT, "swaps with no minimum output"],
  [BIT.HOOK_TAKE, "hooks that can take your input or output"],
  [BIT.HOOK_UNVERIFIED, "unverified hooks"],
  [BIT.SPENDER_UNATTESTED, "unattested spenders"],
  [BIT.TOKEN_UNSAFE, "rebasing or fee-on-transfer tokens"],
  [BIT.TRUST_CHANGE, "trust changes without the TRUST_CHANGE flow"],
  [BIT.ALLOW_REVERT, "router commands that may partially fail"],
];
void RISK_TEXT;

const A = ({ a }) => {
  const { deployments } = useNetwork();
  return (
    <a className="mono" href={addressUrl("sepolia", a, deployments)} target="_blank" rel="noreferrer">
      {a}
    </a>
  );
};

function useWallet(dep) {
  const [s, set] = useState({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!dep) return;
    let live = true;
    (async () => {
      const pub = sepoliaPublic();
      const account = await accountState(dep.account);
      const tokens = await Promise.all(
        Object.entries(dep.tokens).map(async ([sym, address]) => {
          const [bal, decimals] = await Promise.all([pub.readContract({ address, abi: ERC20, functionName: "balanceOf", args: [dep.account] }), pub.readContract({ address, abi: SYMBOL, functionName: "decimals" }).catch(() => 18)]);
          return { sym, address, bal, decimals: Number(decimals) };
        }),
      );
      const eth = await pub.getBalance({ address: dep.account });
      const cfg = await ensConfig(dep);
      const name = await resolveName(cfg, dep.account).catch(() => null);
      return { account, tokens, eth, name: name?.reverse ?? null };
    })()
      .then((x) => live && set(x))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dep, n]);
  return [s, () => setN((x) => x + 1)];
}

function Overview({ dep, w }) {
  const a = w.account;
  return (
    <div className="grid2">
      <div className="panel">
        <h2>Account</h2>
        <div className="kv">
          <span>Address</span>
          <A a={dep.account} />
          <span>ENS name</span>
          <span>{w.name ?? <em>no primary name</em>}</span>
          <span>Leg</span>
          <span>
            Sepolia, ERC-4337 <Pill tone="ok">LIVE · final build</Pill>
          </span>
          <span>ETH</span>
          <span>{formatEther(w.eth)}</span>
          {w.tokens.map((t) => [
            <span key={`${t.sym}k`}>{t.sym}</span>,
            <span key={`${t.sym}v`}>{formatUnits(t.bal, t.decimals)}</span>,
          ])}
        </div>
      </div>
      <div className="panel">
        <h2>Owners and policy</h2>
        <div className="kv">
          <span>Owners</span>
          <span>
            {a.threshold} of {a.owners?.length}
            {a.owners?.map((o) => (
              <div key={o}>
                <A a={o} />
              </div>
            ))}
          </span>
          <span>Attestors</span>
          <span>
            {a.attestorThreshold} must sign each snapshot. <Link to="/ens#attestors">Who they are →</Link>
          </span>
          <span>Max signature life</span>
          <span>{a.maxTtl} s</span>
          <span>Max snapshot life</span>
          <span>{(a.maxSnapshotTtl / 3600).toFixed(1)} h</span>
          <span>Policy version</span>
          <span>{a.policyVersion}</span>
          <span>Let through</span>
          <span>{ALLOW.filter(([b]) => a.allowMask & b).map(([, t]) => t).join(", ") || "nothing: every risk class the policy knows is refused"}</span>
        </div>
      </div>
      <div className="panel">
        <h2>Approval ledger</h2>
        <p className="small muted">Permit2 base allowances this account has granted, at most 16. An entry is pruned when it reaches 0, and no approval outlives its transaction.</p>
        {a.ledger?.length ? a.ledger.map((x) => <div key={x}><A a={x} /></div>) : <em>empty</em>}
      </div>
      <div className="panel">
        <h2>Watchlist</h2>
        <p className="small muted">Tokens whose balance may not fall unless a sentence says so. At most 32.</p>
        {a.watchlist?.length ? a.watchlist.map((x) => <div key={x}><A a={x} /></div>) : <em>empty</em>}
      </div>
      <div className="panel">
        <h2>Fee tickets</h2>
        <p className="small muted">Prepaid per-nonce fees exist on the paymaster path (frames devnet). This Sepolia account pays its own gas through the EntryPoint, so it holds none.</p>
      </div>
    </div>
  );
}

/** Address or ENS name, resolved forward and reverse through the live checks on /ens. */
function useRecipient(dep, input) {
  const [r, set] = useState(null);
  useEffect(() => {
    const v = input.trim();
    if (!v) return set(null);
    if (isAddress(v)) return set({ addr: v });
    if (!/\.eth$/.test(v)) return set({ error: "Enter an address or a .eth name" });
    let live = true;
    set({ loading: true });
    const t = setTimeout(async () => {
      try {
        const x = await resolveName(await ensConfig(dep), v);
        if (live) set(x.forward ? { addr: x.forward, name: v, verified: x.verdict === null, reverse: x.reverse, verdict: x.verdict } : { error: `${v} does not resolve` });
      } catch (e) {
        if (live) set({ error: e.message });
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dep, input]);
  return r;
}

function Send({ dep, w, onDone }) {
  const [to, setTo] = useState(dep.ens.publisher);
  const [token, setToken] = useState("dUSDC");
  const [amount, setAmount] = useState("1");
  const [spec, setSpec] = useState(null);
  const r = useRecipient(dep, to);
  const t = w.tokens.find((x) => x.sym === token);
  const route = "ERC-4337 through the bundler (Sepolia's only path: no paymaster, the account pays its own gas)";
  const build = () => {
    const raw = token === "ETH" ? parseEther(amount) : parseUnits(amount, t.decimals);
    setSpec({ calls: [token === "ETH" ? { target: r.addr, value: raw, data: "0x" } : transferCall(t.address, r.addr, raw)] });
  };
  return (
    <div className="panel">
      <h2>Send</h2>
      <label className="field">
        <span>To (address or ENS name)</span>
        <input value={to} onChange={(e) => (setTo(e.target.value), setSpec(null))} />
      </label>
      {r?.loading ? <div className="muted small">Resolving…</div> : r?.error ? <div className="bad">{r.error}</div> : r?.name ? (
        <div className={r.verified ? "ok" : "bad"}>
          {r.verified ? `✓ ${r.name} → ${r.addr}, and it names itself back. A sentence may show the name.` : `${r.name} → ${r.addr}, but ${r.verdict?.name}: the sentence will show the raw address.`}
        </div>
      ) : null}
      <div className="row">
        <label className="filter">
          <span>Token</span>
          <select value={token} onChange={(e) => (setToken(e.target.value), setSpec(null))}>
            {w.tokens.map((x) => (
              <option key={x.sym}>{x.sym}</option>
            ))}
            <option>ETH</option>
          </select>
        </label>
        <label className="filter">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setSpec(null))} />
        </label>
      </div>
      <div className="small muted">Route: {route}</div>
      <button className="primary" disabled={!r?.addr || !Number(amount)} onClick={build}>
        Preview the sentence
      </button>
      {spec ? <OpRunner spec={spec} account={w.account} onEvent={(e) => e.stage === "done" && onDone()} /> : null}
    </div>
  );
}

function Swap({ dep, w, onDone }) {
  const [amount, setAmount] = useState("0.001");
  const [slip, setSlip] = useState("1");
  const [q, setQ] = useState(null);
  const [api, setApi] = useState(null);
  const [spec, setSpec] = useState(null);
  const [pair, setPair] = useState("ETH-dUSDC");
  useEffect(() => {
    setSpec(null);
    setQ(null);
    if (pair !== "ETH-dUSDC" || !Number(amount)) return;
    let live = true;
    quote(dep, dep.pools.eth.key, parseEther(amount)).then((x) => live && setQ(x)).catch((e) => live && setQ({ error: e.shortMessage ?? e.message }));
    apiPost("/uniswap/quote", { chainId: 11155111, tokenIn: "0x0000000000000000000000000000000000000000", tokenOut: dep.tokens.dUSDC, amount: parseEther(amount).toString(), swapper: dep.account, slippage: Number(slip) })
      .then((x) => live && setApi({ ok: true, out: x.quote?.output?.amount }))
      .catch((e) => live && setApi({ error: e.message }));
    return () => {
      live = false;
    };
  }, [dep, amount, slip, pair]);
  const min = typeof q === "bigint" ? (q * BigInt(Math.round((100 - Number(slip)) * 100))) / 10_000n : null;
  return (
    <div className="panel">
      <h2>Swap</h2>
      <div className="row">
        <label className="filter">
          <span>Pair</span>
          <select value={pair} onChange={(e) => setPair(e.target.value)}>
            <option value="ETH-dUSDC">ETH → dUSDC</option>
            <option value="dWETH-dUSDC">dWETH → dUSDC (ERC-20 input)</option>
          </select>
        </label>
        <label className="filter">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="filter">
          <span>Slippage %</span>
          <input inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} />
        </label>
      </div>
      {pair !== "ETH-dUSDC" ? (
        <div className="callout">
          ERC-20 input swaps need a Permit2 approval and the swap in one batch, because no approval may outlive a transaction. On this Sepolia account that fits; on the frames devnet it does not, since its sidecar caps validation at 100k gas and each extra call costs about 21k (finding (b), <Link to="/mempool">measured here</Link>). This page builds ETH-input swaps only for now.
        </div>
      ) : (
        <>
          <div className="kv small">
            <span>Uniswap v4 Quoter</span>
            <span>{q === null ? "…" : q.error ? q.error : `${formatUnits(q, 6)} dUSDC`}</span>
            <span>Uniswap Trading API</span>
            <span>{api === null ? "…" : api.ok ? (api.out ? `${formatUnits(BigInt(api.out), 6)} dUSDC` : "no route") : `no quote: ${api.error}`}</span>
            <span>Minimum you sign</span>
            <span>{min !== null ? `${formatUnits(min, 6)} dUSDC` : "…"}</span>
          </div>
          <p className="small muted">The demo dUSDC pool is not indexed by the Trading API, so the minimum comes from the on-chain Quoter. Hook-risk lines, if any, appear in the sentence.</p>
          <button className="primary" disabled={min === null} onClick={() => setSpec({ calls: [swapCall(dep, dep.pools.eth.key, parseEther(amount), min)] })}>
            Preview the sentence
          </button>
          {spec ? <OpRunner spec={spec} account={w.account} onEvent={(e) => e.stage === "done" && onDone()} /> : null}
        </>
      )}
    </div>
  );
}

function Connect({ dep, w, onDone }) {
  const [cfg, setCfg] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [uri, setUri] = useState("");
  const [log, setLog] = useState([]);
  const [req, setReq] = useState(null);
  useEffect(() => {
    serverConfig().then(setCfg);
  }, []);
  const add = (l) => setLog((x) => [...x.slice(-30), `${new Date().toLocaleTimeString()} ${l}`]);
  const start = async () => {
    const { startWallet } = await import("../lib/walletconnect");
    const kit = await startWallet({ projectId: cfg.walletConnectProjectId, account: dep.account, onLog: add, onRequest: (r) => setReq(r) });
    setWallet(kit);
    return kit;
  };
  const spec = useMemo(() => (req ? { calls: [{ target: req.tx.to, value: BigInt(req.tx.value ?? 0), data: req.tx.data ?? "0x" }] } : null), [req]);
  if (!cfg) return <Loading />;
  if (!cfg.walletConnectProjectId) return <div className="panel bad">The server has no WalletConnect project ID configured.</div>;
  return (
    <div className="panel">
      <h2>Connect a dapp (WalletConnect)</h2>
      <p className="small muted">Pair with any dapp on Sepolia. Each transaction it asks for is rendered from its calldata, shown on the device, and signed like any other. Off-chain signatures are refused, because the chain cannot check them afterwards.</p>
      <form
        className="inline"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const k = wallet ?? (await start());
            await k.pair(uri.trim());
            add("pairing…");
            setUri("");
          } catch (err) {
            add(`could not pair: ${err.message}`);
          }
        }}
      >
        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="wc:…" aria-label="WalletConnect link" />
        <button className="primary" disabled={!uri.startsWith("wc:")}>
          Pair
        </button>
      </form>
      {wallet?.sessions().map((s) => (
        <div key={s.topic} className="row small">
          <Pill tone="ok">connected</Pill> {s.name} <span className="muted">{s.url}</span>
          <button className="chip" onClick={() => wallet.disconnect(s.topic).then(() => add(`disconnected ${s.name}`))}>
            Disconnect
          </button>
        </div>
      ))}
      <pre className="mono-block">{log.join("\n") || "No activity yet."}</pre>
      {req ? (
        <div className="panel inset">
          <div className="label">{req.dapp} asks for a transaction</div>
          <OpRunner
            spec={spec}
            account={w.account}
            claimedTitle="What it does, rendered from the calldata"
            onEvent={(e) => {
              if (e.stage === "device-refused") return;
              if (e.stage !== "done") return;
              if (e.outcome === "landed" || e.outcome === "reverted-in-batch") req.reply({ result: e.txHash });
              else req.reply({ error: { code: 4001, message: (e.error ?? "refused").slice(0, 200) } });
              add(`${req.dapp}: ${e.outcome}${e.error ? ` ${e.error}` : ""}`);
              onDone();
            }}
          />
          <button
            onClick={() => {
              req.reply({ error: { code: 4001, message: "rejected by the owner" } });
              add(`${req.dapp}: rejected`);
              setReq(null);
            }}
          >
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

const ADMIN_ACTIONS = {
  addOwner: { label: "Add an owner", fields: ["address"] },
  removeOwner: { label: "Remove an owner", fields: ["address"] },
  setThreshold: { label: "Set the threshold", fields: ["threshold"] },
  setAttestors: { label: "Set attestors", fields: ["addresses (comma-separated)", "threshold"] },
  setPolicy: { label: "Set the policy", fields: ["max TTL (s)", "max snapshot TTL (s)", "allow mask"] },
  addWatch: { label: "Watch a token", fields: ["token address"] },
};

function Admin({ dep, w, onDone }) {
  const [fn, setFn] = useState("addWatch");
  const [vals, setVals] = useState({});
  const [spec, setSpec] = useState(null);
  const [err, setErr] = useState(null);
  const build = () => {
    try {
      const v = ADMIN_ACTIONS[fn].fields.map((_, i) => (vals[i] ?? "").trim());
      const args = { addOwner: [v[0]], removeOwner: [v[0]], setThreshold: [Number(v[0])], setAttestors: [v[0].split(",").map((x) => x.trim()), Number(v[1])], setPolicy: v.map(Number), addWatch: [v[0]] }[fn];
      setSpec({ calls: [{ target: dep.account, value: 0n, data: encodeFunctionData({ abi: ADMIN, functionName: fn, args }) }] });
      setErr(null);
    } catch (e) {
      setErr(e.shortMessage ?? e.message);
    }
  };
  return (
    <div className="panel">
      <h2>Admin: trust changes</h2>
      <p className="small muted">A trust change is a transaction to the account itself. It is rendered, flagged CHANGES WHO CONTROLS THIS ACCOUNT, and signed through the device like anything else.</p>
      <div className="callout small">
        The current Sepolia snapshot attests only the token and Permit2 descriptors, not <code>descriptors/account-admin.json</code>. Until an attestor update adds it, these render as an unverified contract and the account refuses them with <code>PolicyRefused</code>.
      </div>
      <label className="filter">
        <span>Change</span>
        <select value={fn} onChange={(e) => (setFn(e.target.value), setVals({}), setSpec(null))}>
          {Object.entries(ADMIN_ACTIONS).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {ADMIN_ACTIONS[fn].fields.map((f, i) => (
        <label key={`${fn}${i}`} className="field">
          <span>{f}</span>
          <input value={vals[i] ?? ""} onChange={(e) => (setVals({ ...vals, [i]: e.target.value }), setSpec(null))} />
        </label>
      ))}
      <button className="primary" onClick={build}>
        Preview the sentence
      </button>
      {err ? <div className="bad">{err}</div> : null}
      {spec ? <OpRunner spec={spec} account={w.account} onEvent={(e) => e.stage === "done" && onDone()} /> : null}
    </div>
  );
}

const TABS = ["overview", "send", "swap", "connect", "admin", "history"];

export default function Wallet() {
  const { deployments, stateOf } = useNetwork();
  const dep = deployments?.sepolia;
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "overview";
  const [w, refresh] = useWallet(dep);
  return (
    <>
      <h1>Verbatim wallet</h1>
      <p className="lede">A working account on Sepolia. Everything it sends is a sentence the owners read on the offline signer, re-rendered by the chain before it runs.</p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setParams({ tab: t })}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {!dep || w.loading ? (
        <Loading what="Reading the account on Sepolia" />
      ) : w.error ? (
        <div className="bad">
          Sepolia is unreachable ({w.error.shortMessage ?? w.error.message}). {stateOf("sepolia") !== "live" ? "The status bar shows the leg down." : ""}
        </div>
      ) : tab === "overview" ? (
        <Overview dep={dep} w={w} />
      ) : tab === "send" ? (
        <Send dep={dep} w={w} onDone={refresh} />
      ) : tab === "swap" ? (
        <Swap dep={dep} w={w} onDone={refresh} />
      ) : tab === "connect" ? (
        <Connect dep={dep} w={w} onDone={refresh} />
      ) : tab === "admin" ? (
        <Admin dep={dep} w={w} onDone={refresh} />
      ) : (
        <div className="panel">
          <h2>History</h2>
          <SentenceList account={dep.account} />
        </div>
      )}
      <p className="small muted">
        Account {short(dep?.account ?? "", 6)} · signing happens on the <a href={import.meta.env.VITE_SIGNER_URL || "#signer"}>offline signer</a>, a separate app that makes no network requests.
      </p>
    </>
  );
}

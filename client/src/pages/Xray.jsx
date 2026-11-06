import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { encodeAbiParameters, keccak256, parseAbiItem, zeroAddress } from "viem";
import { LEAF, leafKey } from "@verbatim/snapshot-cli";
import { Pill } from "../components/Badge";
import { Sentence } from "../components/Sentence";
import { Loading } from "../components/States";
import { useNetwork } from "../lib/network-context";
import { addressUrl, sepoliaPublic } from "../lib/networks";
import { context, prepare, swapCall } from "../lib/userop";
import { FLAGS, parseInput, poolId, xray } from "../lib/xray";

const INITIALIZE = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
const word = (v) => encodeAbiParameters([{ type: "uint256" }], [BigInt(v)]);

/** A pool's key: from the published deployments, or from the PoolManager's recent Initialize events. */
async function keyForId(dep, id) {
  const known = Object.values(dep.pools).find((p) => poolId(p.key).toLowerCase() === id);
  if (known) return known.key;
  const pub = sepoliaPublic();
  const head = await pub.getBlockNumber();
  const logs = await pub.getLogs({ address: dep.uniswap.poolManager, event: INITIALIZE, args: { id }, fromBlock: head - 9_000n, toBlock: head });
  if (!logs.length) throw new Error("Not one of this deployment's pools, and not initialized in the last ~30 hours. Paste its PoolKey instead.");
  const a = logs[0].args;
  return { currency0: a.currency0, currency1: a.currency1, fee: a.fee, tickSpacing: a.tickSpacing, hooks: a.hooks };
}

async function analyse(dep, input) {
  const p = parseInput(input);
  const key = p.key ?? (p.id ? await keyForId(dep, p.id) : null);
  const hook = key?.hooks ?? p.hook;
  const x = xray(hook, key?.fee);
  const out = { key, id: key ? poolId(key) : null, hook, x, zero: hook.toLowerCase() === zeroAddress };
  if (out.zero) return out;
  const code = await sepoliaPublic().getCode({ address: hook });
  out.codehash = code && code !== "0x" ? keccak256(code) : null;
  const { snapshot } = await context();
  const leaf = snapshot.leaves.find((l) => l.type === LEAF.HOOK && leafKey(l) === leafKey({ type: LEAF.HOOK, key: [word(snapshot.chainId), out.codehash ?? `0x${"00".repeat(32)}`] }));
  out.attested = !!leaf;
  out.snapshotRoot = snapshot.root;
  return out;
}

function Result({ dep, r }) {
  const [sentence, setSentence] = useState(null);
  useEffect(() => {
    setSentence(null);
    if (!r.key || r.key.currency0.toLowerCase() !== zeroAddress) return;
    let live = true;
    prepare({ calls: [swapCall(dep, r.key, 1_000_000_000_000_000n, 0n)] })
      .then((p) => live && setSentence({ tree: p.tree }))
      .catch((e) => live && setSentence({ error: e.shortMessage ?? e.message }));
    return () => {
      live = false;
    };
  }, [dep, r]);
  return (
    <>
      <div className="panel">
        {r.id ? <div className="mono">Pool {r.id}</div> : null}
        <div className="mono">
          Hook{" "}
          <a href={addressUrl("sepolia", r.hook)} target="_blank" rel="noreferrer">
            {r.hook}
          </a>
        </div>
        {r.zero ? (
          <div className="ok">No hook on this pool.</div>
        ) : (
          <>
            <div className="label">Risk lines, as the signer shows them</div>
            {r.x.risks.map((t) => (
              <div key={t} className="s-risk">
                ! {t}
              </div>
            ))}
            {!r.attested ? <div className="s-risk">! UNVERIFIED HOOK</div> : null}
            {!r.x.risks.length && r.attested ? <div className="ok">This hook cannot take your input or output through a return delta, and it is attested.</div> : null}
            <div className="label">Attestation</div>
            {r.attested ? (
              <div className="ok">Its code hash is attested in the current snapshot ({r.snapshotRoot.slice(0, 12)}…).</div>
            ) : (
              <div className="bad">
                Not attested in the current Sepolia snapshot {r.snapshotRoot.slice(0, 12)}…. Code hash {r.codehash ?? "none: no code at this address"}.
              </div>
            )}
          </>
        )}
      </div>
      {!r.zero ? (
        <div className="panel">
          <h2>Permissions, from the address bits</h2>
          <div className="flags">
            {FLAGS.map(([n, b, risk]) => (
              <div key={n} className={`flag${r.x.on.includes(n) ? " on" : ""}${risk && r.x.on.includes(n) ? " risky" : ""}`}>
                <span>{n}</span>
                <span className="mono">bit {b}</span>
              </div>
            ))}
          </div>
          <p className="small muted">These say what the hook may do, not what it will. Verbatim also checks its code hash against attested hooks, and the default policy refuses an unverified hook that can take your output with no minimum.</p>
        </div>
      ) : null}
      {r.key ? (
        <div className="panel">
          <h2>A 0.001 ETH swap through this pool, as the signer would show it</h2>
          {r.key.currency0.toLowerCase() !== zeroAddress ? (
            <div className="muted">This page renders ETH-input example swaps; this pool's input is a token.</div>
          ) : !sentence ? (
            <Loading what="Rendering" />
          ) : sentence.error ? (
            <div className="bad">{sentence.error}</div>
          ) : (
            <Sentence tree={sentence.tree} compact />
          )}
        </div>
      ) : null}
    </>
  );
}

// From packages/urrender/README.md.
const EMBED = `import { renderUR, Buf, executeData, v4ExactInSingleInput, CMD } from "@verbatim/urrender";
import { hexToBytes } from "viem";

const data = executeData([CMD.V4_SWAP], [v4ExactInSingleInput({ key, zeroForOne: true, amountIn, amountOutMinimum })], deadline);
const t = new Buf(4096);
renderUR(t, hexToBytes(data), ctx); // ctx: router, account, permit2, weth, and your lookups`;

export default function Xray() {
  const { deployments } = useNetwork();
  const dep = deployments?.sepolia;
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [r, set] = useState(null);
  useEffect(() => {
    if (!dep || !q) return set(null);
    let live = true;
    set({ loading: true });
    analyse(dep, q)
      .then((x) => live && set(x))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dep, q]);
  const examples = dep
    ? [
        ["Honest demo pool", poolId(dep.pools.eth.key)],
        ["SkimHook pool", poolId(dep.pools.ethEvil.key)],
        ["SkimHook address", dep.skimHook],
      ]
    : [];
  return (
    <>
      <h1>Hook X-ray</h1>
      <p className="lede">What a Uniswap v4 hook is allowed to do is written in the low bits of its address. Paste a PoolKey, a pool ID or a hook address. Reads Sepolia.</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft.trim() ? { q: draft.trim() } : {});
        }}
      >
        <label className="field">
          <span>PoolKey JSON, pool ID or hook address</span>
          <textarea rows={3} spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='{"currency0":"0x…","currency1":"0x…","fee":3000,"tickSpacing":60,"hooks":"0x…"}' />
        </label>
        <div className="row">
          <button className="primary">X-ray</button>
          {examples.map(([label, v]) => (
            <button
              type="button"
              key={label}
              className="chip"
              onClick={() => {
                setDraft(v);
                setParams({ q: v });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="small muted">Well-known mainnet hooks are not listed: this page reads Sepolia, and lists only hooks it can check there.</p>
      </form>
      {!r ? null : r.loading ? <Loading what="Reading Sepolia" /> : r.error ? <div className="bad">{r.error.shortMessage ?? r.error.message}</div> : <Result dep={dep} r={r} />}
      <div className="panel">
        <h2>
          Embed this <Pill>@verbatim/urrender</Pill>
        </h2>
        <p className="small">The same decoder runs on chain (Solidity) and in your wallet (TypeScript), byte-identical under differential fuzzing.</p>
        <pre className="mono-block">{EMBED}</pre>
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiItem, recoverTypedDataAddress } from "viem";
import { LEAF, indexOf, pathOf, snapshotTypedData, treeOf, verifyPath } from "@verbatim/snapshot-cli";
import { Evidence, Pill } from "../components/Badge";
import { Failed, Loading } from "../components/States";
import { TxLink, short } from "../components/TxLink";
import { apiGet } from "../lib/api";
import { load, useData } from "../lib/data";
import { useNetwork } from "../lib/network-context";
import { rpc, sepoliaPublic } from "../lib/networks";

const TYPE = Object.fromEntries(Object.entries(LEAF).map(([k, v]) => [v, k]));
const REVOKED = parseAbiItem("event Revoked(bytes32 indexed leafHash)");
const PAYMASTER = parseAbi(["function snapshot() view returns (bytes32 root, uint64 issuedAt, uint64 expiry)", "function trustEpoch() view returns (uint64)"]);
const when = (s) => new Date(Number(s) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

/** Which descriptors' effects have run live. Others are proven against mocks in Foundry only. */
const EFFECTS_EVIDENCE = {
  "erc20.json": ["final", "B-honest-pimlico"],
  "permit2.json": ["final", "B14"],
  "weth.json": ["older", "WRAP"],
  "evil-vault.json": ["older", "A6"],
  "erc4626.json": ["foundry", null],
  "aave-v3-pool.json": ["foundry", null],
};

function SnapshotCard({ title, snap, note }) {
  const [sigs, setSigs] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all(
      snap.signatures.map(async (s) => {
        const who = await recoverTypedDataAddress({ ...snapshotTypedData(BigInt(snap.chainId), snap.root, BigInt(snap.issuedAt), BigInt(snap.expiry), snap.schema), signature: s.sig });
        return { ...s, ok: who.toLowerCase() === s.signer.toLowerCase() && snap.attestors.some((a) => a.toLowerCase() === who.toLowerCase()) };
      }),
    ).then((x) => live && setSigs(x));
    return () => {
      live = false;
    };
  }, [snap]);
  const [now] = useState(() => Date.now() / 1000);
  const left = Number(snap.expiry) - now;
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="kv small">
        <span>Root</span>
        <code>{snap.root}</code>
        <span>Issued</span>
        <span>{when(snap.issuedAt)}</span>
        <span>Expires</span>
        <span>
          {when(snap.expiry)} {left > 0 ? <Pill tone="ok">{(left / 3600).toFixed(1)} h left</Pill> : <Pill tone="bad">expired</Pill>}
        </span>
        <span>TTL</span>
        <span>{((Number(snap.expiry) - Number(snap.issuedAt)) / 3600).toFixed(1)} h</span>
        <span>Schema</span>
        <span>{snap.schema}</span>
        <span>Leaves</span>
        <span>{snap.leaves.filter((l) => l.type !== 0 && l.type !== 255).length}, depth {snap.depth}</span>
        <span>Signatures</span>
        <span>
          {(sigs ?? snap.signatures).map((s) => (
            <div key={s.signer}>
              {sigs ? (s.ok ? "✓" : "✗") : "·"} <code>{s.signer}</code>
            </div>
          ))}
          <span className="muted">checked here against the snapshot's typed data</span>
        </span>
      </div>
      {note ? <div className="small muted">{note}</div> : null}
    </div>
  );
}

function Leaves({ snap }) {
  const [q, setQ] = useState("");
  const [proof, setProof] = useState({});
  const tree = useMemo(() => treeOf(snap), [snap]);
  const leaves = snap.leaves.filter((l) => l.type !== 0 && l.type !== 255);
  const term = q.trim().toLowerCase().replace(/^0x/, "");
  const shown = leaves.filter((l) => !term || [...l.key, ...l.value, TYPE[l.type]].some((x) => x.toLowerCase().includes(term)));
  const verify = (l, i) => {
    const index = indexOf(tree, l);
    const path = pathOf(tree, index);
    setProof((p) => ({ ...p, [i]: { ok: verifyPath(snap.root, l, index, path), index, depth: path.length } }));
  };
  return (
    <div className="panel">
      <h2>Leaf browser</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by contract, code hash, selector, token or type" aria-label="Search leaves" />
      <ul className="leaves">
        {shown.map((l) => {
          const i = leaves.indexOf(l);
          return (
            <li key={i}>
              <div className="row">
                <Pill tone="info">{TYPE[l.type] ?? l.type}</Pill>
                <button className="chip" onClick={() => verify(l, i)}>
                  Verify proof
                </button>
                {proof[i] ? proof[i].ok ? <span className="tone-ok small">✓ proves into the root (index {proof[i].index}, {proof[i].depth} hashes)</span> : <span className="tone-bad small">✗ does not prove</span> : null}
              </div>
              <div className="mono small">key {l.key.map((k) => short(k, 8)).join(" · ")}</div>
              <div className="mono small">value {l.value.map((k) => short(k, 8)).join(" · ") || "—"}</div>
            </li>
          );
        })}
      </ul>
      <p className="small muted">The proof check runs @verbatim/snapshot-cli in this browser: the same sorted-Merkle rules as the on-chain SnapshotVerifier.</p>
    </div>
  );
}

function Coverage() {
  const d = useData(["manifest.json", "registry-failures.json", "descriptors.json"]);
  if (d.loading) return <Loading />;
  if (d.error) return <Failed what="coverage" error={d.error} />;
  const [m, failures, descriptors] = d.data;
  const reasons = Object.entries(failures.reduce((a, f) => ((a[f.reason] = (a[f.reason] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid2">
      <div className="panel">
        <h2>Registry coverage</h2>
        {m.registry ? (
          <>
            <div className="big">
              {m.registry.compiled.toLocaleString()} / {m.registry.total.toLocaleString()}
            </div>
            <p className="small muted">ERC-7730 registry functions that compile to descriptors ({((100 * m.registry.compiled) / m.registry.total).toFixed(1)}%). Compiling is not attesting: attestors still decide what to trust.</p>
          </>
        ) : null}
        <table className="plain num small">
          <thead>
            <tr>
              <th>Why the rest failed</th>
              <th>Functions</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map(([r, n]) => (
              <tr key={r}>
                <td>{r}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>Effects written by hand</h2>
        <p className="small muted">ERC-7730 says nothing about effects. These descriptors add them, so the chain can assert what a sentence promised.</p>
        <table className="plain small">
          <tbody>
            {descriptors
              .filter((x) => x.functions.some((f) => f.effects))
              .map((x) => {
                const [ev, proof] = EFFECTS_EVIDENCE[x.file] ?? ["foundry", null];
                return (
                  <tr key={x.file}>
                    <td>
                      <code>{x.file}</code>
                      <div className="muted">{x.functions.filter((f) => f.effects).map((f) => f.intent ?? f.sig).join(", ")}</div>
                    </td>
                    <td>
                      <Evidence kind={ev} detail={ev === "foundry" ? "mock" : null} />
                      {proof ? (
                        <div>
                          <Link className="small" to={`/proofs?id=${proof}`}>
                            {proof}
                          </Link>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            <tr>
              <td>
                <code>Universal Router</code> <span className="muted">(URRender, not a descriptor)</span>
              </td>
              <td>
                <Evidence kind="final" />
                <div>
                  <Link className="small" to="/proofs?id=B-swap">
                    B-swap
                  </Link>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Revocations({ dep }) {
  const [s, set] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    (async () => {
      const pub = sepoliaPublic();
      const head = await pub.getBlockNumber();
      const logs = await pub.getLogs({ address: dep.revocations, event: REVOKED, fromBlock: head - 9_000n, toBlock: head });
      return Promise.all(
        logs.map(async (l) => {
          const [tx, b] = await Promise.all([pub.getTransaction({ hash: l.transactionHash }), pub.getBlock({ blockNumber: l.blockNumber })]);
          return { leaf: l.args.leafHash, by: tx.from, at: b.timestamp, hash: l.transactionHash };
        }),
      );
    })()
      .then((items) => live && set({ items }))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dep]);
  return (
    <div className="panel">
      <h2>Revocation registry (Sepolia)</h2>
      <p className="small muted">
        Attestors revoke a leaf here, by signature, and it fails at execution. ENS holds a second list; see <Link to="/ens#revocations">/ens</Link>. Showing the last ~30 hours of blocks.
      </p>
      {s.loading ? <Loading /> : s.error ? <div className="bad">{s.error.shortMessage ?? s.error.message}</div> : !s.items.length ? <em>No revocations in that window.</em> : (
        <table className="plain small">
          <tbody>
            {s.items.map((x) => (
              <tr key={x.hash}>
                <td>
                  <code>{short(x.leaf, 10)}</code>
                </td>
                <td>
                  <code>{short(x.by)}</code>
                </td>
                <td>{when(x.at)}</td>
                <td>
                  <TxLink hash={x.hash} leg="sepolia" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PaymasterCache({ dev }) {
  const { stateOf } = useNetwork();
  const [s, set] = useState({ loading: true });
  useEffect(() => {
    if (!dev?.paymaster) return;
    let live = true;
    const call = async (functionName) => decodeFunctionResult({ abi: PAYMASTER, functionName, data: await rpc(dev.node, "eth_call", [{ to: dev.paymaster, data: encodeFunctionData({ abi: PAYMASTER, functionName }) }, "latest"]) });
    Promise.all([call("snapshot"), call("trustEpoch")])
      .then(([[root, issuedAt, expiry], epoch]) => live && set({ root, issuedAt, expiry, epoch }))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dev]);
  return (
    <div className="panel">
      <h2>Paymaster cache (frames devnet)</h2>
      <p className="small muted">On the paymaster path, trust is cached in the staked paymaster's storage by refreshTrust, instead of proved per transaction.</p>
      {stateOf("devnet") !== "live" ? <div className="muted small">The devnet is not producing blocks; the cache below is its last state, if the node still answers.</div> : null}
      {s.loading ? <Loading /> : s.error ? <div className="bad">Could not read the paymaster: {s.error.message}</div> : (
        <div className="kv small">
          <span>Cached root</span>
          <code>{s.root}</code>
          <span>Window</span>
          <span>
            {when(s.issuedAt)} → {when(s.expiry)}
          </span>
          <span>Trust epoch</span>
          <span>{s.epoch.toString()}</span>
        </div>
      )}
      <div className="callout small">
        <strong>Paymaster-path hooks and spenders can't be un-attested yet.</strong> <code>refreshTrust</code> only ever sets <code>attestedHooks</code> and <code>attestedSpenders</code> to true (<code>contracts/src/trust/TrustStore.sol</code>). Revoking one needs a new paymaster. The stateless path has no such cache.
      </div>
    </div>
  );
}

export default function Trust() {
  const { deployments } = useNetwork();
  const dep = deployments?.sepolia;
  const dev = deployments?.["frames-devnet"];
  const [snaps, set] = useState(null);
  useEffect(() => {
    Promise.all([apiGet("/snapshot/sepolia").catch(() => load("deployments/snapshot-sepolia.json")), load("deployments/snapshot-devnet.json").catch(() => null)])
      .then(([s, d]) => set({ sepolia: s, devnet: d }))
      .catch((error) => set({ error }));
  }, []);
  return (
    <>
      <h1>Snapshot and attestors</h1>
      <p className="lede">One trust model on both paths: attestors sign a sorted-Merkle snapshot of what may be rendered, and every sentence proves the leaves it used against that root.</p>
      {!snaps ? <Loading /> : snaps.error ? <Failed what="snapshots" error={snaps.error} /> : (
        <>
          <div className="grid2">
            <SnapshotCard title="Sepolia (current)" snap={snaps.sepolia} note={snaps.sepolia.source === "re-signed" ? "The published root, re-signed by the attestors with fresh timestamps by the server: policy caps a snapshot at 6 hours. No leaf changed." : "As published in deployments/snapshot-sepolia.json."} />
            {snaps.devnet ? <SnapshotCard title="Frames devnet" snap={snaps.devnet} /> : null}
          </div>
          <Leaves snap={snaps.sepolia} />
        </>
      )}
      <h2 className="section">Coverage</h2>
      <Coverage />
      {dep ? <Revocations dep={dep} /> : null}
      {dev ? <PaymasterCache dev={dev} /> : null}
    </>
  );
}

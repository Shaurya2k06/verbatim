import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { decodeAbiParameters, decodeFunctionData, isAddress, keccak256, parseAbiItem, slice, toHex } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { SnapshotTrust, packedUniswap, renderWithChain } from "@verbatim/client";
import { decodeTree } from "@verbatim/displayvm-ts";
import { Pill } from "../components/Badge";
import { Sentence, linesOf } from "../components/Sentence";
import { Loading } from "../components/States";
import { TxLink, short } from "../components/TxLink";
import { config as ensConfig, resolveName } from "../lib/ens";
import { useNetwork } from "../lib/network-context";
import { sepoliaPublic } from "../lib/networks";
import { ACCOUNT_ABI, context, decodeError } from "../lib/userop";

const OP_EVENT = parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const BODY = [{ type: "tuple[]", components: [{ type: "address", name: "target" }, { type: "uint256", name: "value" }, { type: "bytes", name: "data" }] }, { type: "bytes" }];
const SIG = [{ type: "tuple", components: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "root", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "snapExpiry", type: "uint64" }, { name: "ownerSigs", type: "bytes" }, { name: "attestorSigs", type: "bytes" }, { name: "attestors", type: "address[]" }, { name: "hints", type: "address[]" }, { name: "proofs", type: "bytes" }] }];
const VERBATIM_RESULT = keccak256(toHex("VerbatimResult(bool,bytes)"));
const CHUNK = 9_000n;

/** The account's user operations, newest first, by EntryPoint events. */
async function findOps(dep, account, max = 20, chunks = 8) {
  const pub = sepoliaPublic();
  const head = await pub.getBlockNumber();
  const out = [];
  for (let i = 0n; i < BigInt(chunks) && out.length < max; i++) {
    const to = head - i * CHUNK;
    const from = to - CHUNK + 1n;
    try {
      const logs = await pub.getLogs({ address: dep.entryPoint, event: OP_EVENT, args: { sender: account }, fromBlock: from, toBlock: to });
      out.push(...logs.reverse());
    } catch (e) {
      // Older history may be unavailable; show what was found.
      if (out.length) break;
      throw e;
    }
  }
  return out.slice(0, max);
}

/** Everything the explorer shows for one operation: its calls, the signed fields, the account's verdict, and a local re-render. */
async function inspect(dep, txHash, account) {
  const pub = sepoliaPublic();
  const [tx, receipt] = await Promise.all([pub.getTransaction({ hash: txHash }), pub.getTransactionReceipt({ hash: txHash })]);
  const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
  const { args } = decodeFunctionData({ abi: entryPoint07Abi, data: tx.input });
  const op = args[0].find((o) => o.sender.toLowerCase() === account.toLowerCase());
  if (!op) throw new Error("this transaction carries no operation from the account");
  const [calls, spec] = decodeAbiParameters(BODY, slice(op.callData, 4));
  const [sig] = decodeAbiParameters(SIG, op.signature);
  const log = receipt.logs.find((l) => l.address.toLowerCase() === account.toLowerCase() && l.topics[0] === VERBATIM_RESULT);
  let result = null;
  if (log) {
    const [err] = decodeAbiParameters([{ type: "bytes" }], log.data);
    result = { ok: BigInt(log.topics[1]) === 1n, error: decodeError(err) };
  }
  const opEvent = receipt.logs.find((l) => l.address.toLowerCase() === dep.entryPoint.toLowerCase() && l.topics[2] && `0x${l.topics[2].slice(26)}`.toLowerCase() === account.toLowerCase());
  return { txHash, block: Number(receipt.blockNumber), time: Number(block.timestamp), calls, spec, sig, result, op, success: opEvent ? BigInt(`0x${opEvent.data.slice(2 + 64, 2 + 128)}`) === 1n : null };
}

/** Re-renders the operation from its calldata with displayvm-ts, as the account did. */
async function rerender(dep, x) {
  const { snapshot } = await context();
  if (snapshot.root.toLowerCase() !== x.sig.root.toLowerCase()) return { error: `signed under snapshot ${short(x.sig.root, 8)}, which is not the published one (${short(snapshot.root, 8)})` };
  const pub = sepoliaPublic();
  const policyVersion = Number(await pub.readContract({ address: dep.account, abi: ACCOUNT_ABI, functionName: "policyVersion" }));
  const gas = BigInt(x.op.accountGasLimits.slice(0, 34)) + BigInt(`0x${x.op.accountGasLimits.slice(34)}`) + x.op.preVerificationGas;
  const maxFeePerGas = BigInt(`0x${x.op.gasFees.slice(34)}`);
  const { encodeBody } = await import("@verbatim/client");
  const base = { chainId: 11155111n, account: dep.account, expiry: x.sig.expiry, snapshotRoot: x.sig.root, policyVersion, path: 3, feeAsset: "0x0000000000000000000000000000000000000000", maxFee: gas * maxFeePerGas, body: encodeBody(x.calls, "0x") };
  const trust = new SnapshotTrust(pub, snapshot, { permit2: dep.uniswap.permit2, weth: dep.uniswap.weth9, publisher: packedUniswap });
  const { out } = await renderWithChain(base, trust, pub);
  return { tree: out.tree, treeHash: out.treeHash, specHash: out.specHash, matches: out.treeHash === x.sig.treeHash && out.specHash === x.sig.specHash };
}

function Headline({ dep, x }) {
  const [h, set] = useState(null);
  useEffect(() => {
    let live = true;
    rerender(dep, x)
      .then((r) => live && set(r.tree ? linesOf(r.tree).find((l) => l.guarantee)?.text ?? "—" : null))
      .catch(() => live && set(null));
    return () => {
      live = false;
    };
  }, [dep, x]);
  return <span>{h ?? <span className="muted">{x.calls.length} call(s)</span>}</span>;
}

const status = (x) => (x.result?.ok ? ["landed", "ok"] : x.result ? ["batch reverted", "bad"] : x.success === false ? ["failed", "bad"] : ["landed", "ok"]);

function Detail({ dep, x }) {
  const [r, set] = useState({ loading: true });
  useEffect(() => {
    rerender(dep, x).then(set).catch((e) => set({ error: e.message }));
  }, [dep, x]);
  let guarantees = [];
  try {
    guarantees = r.tree ? linesOf(r.tree).filter((l) => l.guarantee) : [];
  } catch {
    /* shown below */
  }
  const failedAt = x.result?.error?.name === "AssertionFailed" ? Number(x.result.error.args[0]) : null;
  const decoded = r.tree ? decodeTree(r.tree) : null;
  return (
    <div className="detail">
      <div className="label">The sentence, re-rendered here from the calldata</div>
      {r.loading ? <Loading what="Re-rendering with displayvm-ts" /> : r.error ? <div className="bad">{r.error}</div> : <Sentence tree={r.tree} compact />}
      {guarantees.length ? (
        <>
          <div className="label">Guarantees</div>
          <ul className="guarantees">
            {guarantees.map((g, i) => {
              // Assertions run in the guarantees' order, so one that failed at index i means the ones before it held.
              const mark = x.result?.ok ? "held" : failedAt !== null ? (i < failedAt ? "held" : i === failedAt ? "failed" : "unreached") : "unreached";
              return (
                <li key={i} className={mark === "failed" ? "fail" : mark === "held" ? "pass" : ""}>
                  {mark === "failed" ? "✗" : mark === "held" ? "✓" : "·"} {g.text}
                  {mark === "unreached" ? <span className="muted small"> (not reached: the batch reverted first)</span> : null}
                  {mark === "failed" ? <span className="small"> (failed)</span> : null}
                </li>
              );
            })}
          </ul>
          {!x.result?.ok && x.result?.error ? (
            <div className="bad">
              <code>{x.result.error.raw}</code> {x.result.error.human ?? ""}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="label">What the owners signed</div>
      <div className="kv small">
        <span>treeHash</span>
        <code>{x.sig.treeHash}</code>
        <span>specHash</span>
        <code>{x.sig.specHash}</code>
        <span>expiry</span>
        <span>{new Date(Number(x.sig.expiry) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC</span>
        <span>snapshotRoot</span>
        <code>{x.sig.root}</code>
        <span>path</span>
        <span>{decoded ? decoded.path : 3} (ERC-4337)</span>
        <span>txCommit</span>
        <span>the user operation hash</span>
      </div>
      {r.tree ? r.matches ? <div className="ok">✓ Verified locally: the calldata renders to exactly the tree and spec hashes the owners signed.</div> : <div className="bad">The local render does not match the signed hashes.</div> : null}
    </div>
  );
}

/** Used by /wallet's History tab too. */
export function SentenceList({ account }) {
  const { deployments } = useNetwork();
  const dep = deployments?.sepolia;
  const [s, set] = useState({ loading: true });
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!dep || !account) return;
    let live = true;
    set({ loading: true });
    findOps(dep, account)
      .then((logs) => Promise.all(logs.map((l) => inspect(dep, l.transactionHash, account).catch((e) => ({ txHash: l.transactionHash, error: e.message })))))
      .then((items) => live && set({ items }))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dep, account]);
  if (s.loading) return <Loading what="Finding this account's operations on Sepolia" />;
  if (s.error) return <div className="bad">{s.error.shortMessage ?? s.error.message}</div>;
  if (!s.items.length) return <div className="muted">No operations from {short(account)} in the last ~{Number((8n * CHUNK) / 7200n)} days of Sepolia blocks.</div>;
  return (
    <ul className="proofs">
      {s.items.map((x) => {
        if (x.error)
          return (
            <li key={x.txHash} className="proof">
              <div className="proof-head">
                <TxLink hash={x.txHash} leg="sepolia" /> <span className="muted">{x.error}</span>
              </div>
            </li>
          );
        const [label, tone] = status(x);
        return (
          <li key={x.txHash} className={`proof${open === x.txHash ? " open" : ""}`}>
            <button className="proof-head" onClick={() => setOpen(open === x.txHash ? null : x.txHash)}>
              <span className="pid mono">{new Date(x.time * 1000).toISOString().slice(5, 16).replace("T", " ")}</span>
              <span className="ptitle">
                <Headline dep={dep} x={x} />
              </span>
              <span className="pmeta">
                <Pill tone={tone}>{label}</Pill>
                <Pill>Sepolia</Pill>
              </span>
            </button>
            <div className="plink">
              <TxLink hash={x.txHash} leg="sepolia" />
            </div>
            {open === x.txHash ? <Detail dep={dep} x={x} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function Sentences() {
  const { deployments } = useNetwork();
  const dep = deployments?.sepolia;
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [target, set] = useState(null);
  useEffect(() => {
    if (!dep) return;
    const v = q.trim();
    if (!v) return set({ account: dep.account });
    if (isAddress(v)) return set({ account: v });
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      sepoliaPublic()
        .getTransactionReceipt({ hash: v })
        .then((r) => {
          const l = r.logs.find((x) => x.address.toLowerCase() === dep.entryPoint.toLowerCase() && x.topics.length === 4);
          set(l ? { account: `0x${l.topics[2].slice(26)}` } : { error: "That transaction has no user operation." });
        })
        .catch((e) => set({ error: e.shortMessage ?? e.message }));
      return;
    }
    ensConfig(dep)
      .then((c) => resolveName(c, v))
      .then((r) => set(r.forward ? { account: r.forward } : { error: `${v} does not resolve` }))
      .catch((e) => set({ error: e.message }));
  }, [dep, q]);
  return (
    <>
      <h1>Sentence explorer</h1>
      <p className="lede">The first explorer that shows what humans approved. Each operation is re-rendered here from its calldata, and checked against the hashes its owners signed.</p>
      <form
        className="inline panel"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft.trim() ? { q: draft.trim() } : {});
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Account, transaction hash or ENS name" aria-label="Search" />
        <button className="primary">Search</button>
      </form>
      {target?.error ? <div className="bad">{target.error}</div> : target?.account ? (
        <>
          <p className="small muted">
            Operations from <code>{target.account}</code> on Sepolia. The frames devnet leg is not producing blocks; its transactions are on its <a href="https://explorer.altmempool.wtf/">explorer</a>.
          </p>
          <SentenceList account={target.account} />
        </>
      ) : (
        <Loading />
      )}
    </>
  );
}

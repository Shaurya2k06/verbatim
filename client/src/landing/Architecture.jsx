import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { REPO } from "../components/Layout";

const SRC = `${REPO}/blob/main`;

/**
 * One transaction through Verbatim, from the frontend that builds it to the block. Every box names the code behind it; the words
 * come from the README's architecture section. Two layouts: left to right on a wide screen, top to bottom on a phone.
 */
const NODES = [
  {
    id: "frontend",
    kind: "untrusted",
    title: "Frontend",
    sub: "builds the calls. May be hostile",
    detail:
      "Any page or app. Verbatim treats it, the host, the RPC and the relayer as untrusted: whatever they change shows up as different words.",
    files: [["client/", "client"]],
  },
  {
    id: "ts",
    kind: "untrusted",
    title: "displayvm-ts",
    sub: "renders VTREE (T) and VSPEC (S)",
    detail:
      "Two formats carry every transaction. VTREE is the sentence as canonical bytes: header, calls, warnings, guarantees. VSPEC is what must be true after the batch: balance deltas, allowances at zero, owners. Owners sign keccak256 of each. displayvm-ts is the TypeScript twin of the on-chain renderer that writes them. It is ours and still untrusted: if it disagrees with the chain, the transaction fails closed. 10,000 random cases per CI run compare the two byte for byte.",
    files: [
      ["packages/displayvm-ts", "packages/displayvm-ts"],
      ["contracts/docs/VTREE.md", "VTREE spec"],
      ["contracts/docs/VSPEC.md", "VSPEC spec"],
    ],
  },
  {
    id: "signer",
    kind: "trusted",
    title: "Offline signer",
    sub: "decodes T itself, signs its hash",
    detail:
      "One HTML file, or an Android app with no internet permission. It reads the request from a rotating QR, shows the guarantees first, and signs D_owner(hash T, hash S, expiry, snapshot root, path, txCommit). The signature goes back by QR. On a frame transaction it rides as an explicit-digest signature, so the protocol checks every one before any frame runs.",
    files: [["packages/signer", "packages/signer"]],
  },
  {
    id: "p4337",
    kind: "fallback",
    title: "ERC-4337",
    sub: "fallback, for chains without frames",
    detail:
      "The same logic behind any ERC-4337 bundler, for chains without frame transactions: account validation renders the sentence. Also live on Sepolia, through Pimlico and Alchemy, including a v4 swap through Uniswap’s router.",
    files: [["contracts/src/leg-b", "contracts/src/leg-b"]],
  },
  {
    id: "pstate",
    kind: "path",
    title: "Stateless",
    sub: "EIP-8141, any frame mempool",
    detail:
      "Frames [expiry | VERIFY account | SENDER account]. The account renders from Merkle proofs carried in the transaction, against a snapshot the attestors signed. No stake and no global state, which makes it valid in any frame mempool. Rotating the snapshot invalidated 0 of 50 pending transactions. Live on the EF frames devnet.",
    files: [["contracts/src/stateless", "contracts/src/stateless"]],
  },
  {
    id: "ppay",
    kind: "path",
    title: "Paymaster",
    sub: "EIP-8141 + ERC-8421 alt mempool",
    detail:
      "The main path. Frames [expiry | VERIFY account | VERIFY paymaster | SENDER account]. A staked paymaster renders from its cache, rebuilds D_owner and issues per-nonce fee tickets. The canonical rules refuse this storage read (StorageReadNonSender). ERC-8421 admits it because the renderer is staked: that is what the alt mempool is for. Live on the EF frames devnet: a transfer fits in 85,429 gas of the 100,000 cap.",
    files: [
      [
        "contracts/src/paymaster/RendererPaymaster.sol",
        "RendererPaymaster.sol",
      ],
    ],
  },
  {
    id: "trust",
    kind: "chain",
    title: "Trust",
    sub: "attestors, snapshot, ENS proof",
    detail:
      "Which contracts, tokens and names may be rendered. The attestor quorum and the ENS publisher must both collude to lie, and the ENS exclusivity proof is read again at execution.",
    files: [
      ["contracts/src/trust/TrustStore.sol", "TrustStore.sol"],
      ["contracts/src/trust/EnsTrustChecker.sol", "EnsTrustChecker.sol"],
    ],
  },
  {
    id: "render",
    kind: "chain",
    title: "Render on chain",
    sub: "a VERIFY frame rebuilds the VTREE",
    detail:
      "In the VERIFY frame (or 4337 validation), DisplayVM runs the descriptors, URRender decodes the Universal Router and v4 actions, and hook risk is read from the hook address’s low bits. The VTREE it writes must hash to what the owners signed, and the VSPEC it derives must match theirs.",
    files: [
      ["contracts/src/lib/DisplayVM.sol", "DisplayVM.sol"],
      ["contracts/src/uniswap/URRender.sol", "URRender.sol"],
    ],
  },
  {
    id: "refused",
    kind: "refuse",
    title: "Refused",
    sub: "the mempool never admits it",
    detail:
      "Different words, a weaker spec, an unattested contract or a risk the policy refuses: the validation frame reverts, the mempool never admits it, and nobody pays. The paymaster path answers SpecHashMismatch, the stateless path and ERC-4337 TreeMismatch.",
    code: "SpecHashMismatch · TreeMismatch · PolicyRefused",
  },
  {
    id: "account",
    kind: "chain",
    title: "VerbatimAccount",
    sub: "runs the calls, then asserts VSPEC",
    detail:
      "In an inner self-call: expiry, revocations, live re-checks, the calls, then every VSPEC assertion. No tracked holding may drop beyond what was signed, and no approval may survive. No DELEGATECALL, checked on the bytecode.",
    files: [
      ["contracts/src/account/VerbatimAccount.sol", "VerbatimAccount.sol"],
      ["contracts/src/lib/AssertionKit.sol", "AssertionKit.sol"],
    ],
  },
  {
    id: "landed",
    kind: "ok",
    title: "Lands",
    sub: "every promise held",
    detail:
      "The block contains exactly what the sentence said, checked twice: once on the words, once on the effects.",
  },
  {
    id: "reverted",
    kind: "refuse",
    title: "Batch reverts",
    sub: "fee kept, digest consumed",
    detail:
      "An assertion failed after the calls ran, so everything they did is undone. The fee stays paid and the signed digest cannot be replayed.",
    code: "AssertionFailed",
  },
];

// Positions and widths: [x, y, width] for the wide layout, then for the narrow one.
const WIDE = {
  frontend: [0, 20, 180],
  ts: [0, 190, 180],
  signer: [260, 105, 180],
  ppay: [520, -30, 170],
  pstate: [520, 105, 170],
  p4337: [520, 240, 170],
  trust: [770, -60, 180],
  render: [770, 105, 180],
  refused: [770, 270, 180],
  account: [1030, 105, 180],
  landed: [1030, -60, 180],
  reverted: [1030, 270, 180],
};
const NARROW = {
  frontend: [100, 0, 180],
  ts: [100, 120, 180],
  signer: [100, 240, 180],
  ppay: [0, 380, 120],
  pstate: [130, 380, 120],
  p4337: [260, 380, 120],
  trust: [0, 530, 170],
  render: [200, 530, 180],
  account: [0, 680, 170],
  refused: [200, 680, 180],
  landed: [0, 830, 170],
  reverted: [200, 830, 180],
};

// [source, target, label, tone, wide handles, narrow handles]. Handles: t, l, d are targets; r, b, u are sources.
const EDGES = [
  ["frontend", "ts", "calls", "", "bt", "bt"],
  ["ts", "signer", "QR: T, S", "flow", "rl", "bt"],
  ["signer", "ppay", "frame tx", "flow", "rl", "bt"],
  ["signer", "pstate", "", "flow", "rl", "bt"],
  ["signer", "p4337", "fallback", "", "rl", "bt"],
  ["p4337", "render", "", "", "rl", "bt"],
  ["pstate", "render", "", "flow", "rl", "bt"],
  ["ppay", "render", "", "flow", "rl", "bt"],
  ["trust", "render", "", "", "bt", "rl"],
  ["render", "account", "same words", "flow", "rl", "bt"],
  ["render", "refused", "differs", "bad", "bt", "bt"],
  ["account", "landed", "held", "ok", "ud", "bt"],
  ["account", "reverted", "broken", "bad", "bt", "rl"],
];

const KIND = {
  untrusted: "untrusted",
  trusted: "trusted",
  path: "path",
  fallback: "fallback path",
  chain: "on chain",
  refuse: "stops here",
  ok: "lands",
};

function Box({ data, selected }) {
  return (
    <div
      className={`lp-arch-node lp-arch-${data.kind}${selected ? " on" : ""}`}
      style={{ width: data.width }}
    >
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="target" position={Position.Bottom} id="d" />
      <span className="lp-arch-kind">{KIND[data.kind]}</span>
      <b>{data.title}</b>
      <span className="lp-arch-sub">{data.sub}</span>
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Top} id="u" />
    </div>
  );
}
const nodeTypes = { box: Box };

const TONE = {
  flow: "var(--ink)",
  ok: "var(--ok)",
  bad: "var(--risk)",
  "": "var(--mute)",
};

function useNarrow() {
  const q = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function Architecture() {
  const narrow = useNarrow();
  const [picked, setPicked] = useState("render");
  const box = useRef(null);
  const flow = useRef(null);

  const nodes = useMemo(() => {
    const at = narrow ? NARROW : WIDE;
    return NODES.map((n) => {
      const [x, y, width] = at[n.id];
      return {
        id: n.id,
        type: "box",
        position: { x, y },
        data: { ...n, width },
        selected: n.id === picked,
      };
    });
  }, [narrow, picked]);

  const edges = useMemo(
    () =>
      EDGES.map(([source, target, label, tone, wide, small]) => {
        const [s, t] = narrow ? small : wide;
        const color = TONE[tone];
        const lit = picked === source || picked === target;
        return {
          id: `${source}-${target}`,
          source,
          target,
          sourceHandle: s,
          targetHandle: t,
          type: "smoothstep",
          label: label || undefined,
          animated: tone === "flow",
          style: {
            stroke: color,
            strokeWidth: lit ? 2 : 1.25,
            opacity: lit ? 1 : 0.55,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 16,
            height: 16,
          },
          labelStyle: { fill: color, fontFamily: "var(--mono)", fontSize: 12 },
          labelBgStyle: { fill: "var(--bg)" },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 2,
        };
      }),
    [narrow, picked],
  );

  // Keep the whole diagram in view as the section resizes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      flow.current?.fitView({ padding: 0.08 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    requestAnimationFrame(() => flow.current?.fitView({ padding: 0.08 }));
  }, [narrow]);

  const n = NODES.find((x) => x.id === picked);
  return (
    <div className="lp-arch">
      <div className={`lp-arch-canvas${narrow ? " narrow" : ""}`} ref={box}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          onInit={(inst) => {
            flow.current = inst;
            inst.fitView({ padding: 0.08 });
          }}
          onNodeClick={(_, node) => setPicked(node.id)}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={!narrow}
          zoomOnScroll={false}
          zoomOnPinch={!narrow}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          aria-label="Architecture diagram"
        >
          <Background color="#1f2330" gap={24} size={1} />
          {narrow ? null : (
            <Controls showInteractive={false} position="top-left" />
          )}
        </ReactFlow>
      </div>
      <div className="lp-arch-detail" aria-live="polite">
        <div>
          <p className="lp-arch-kind">{KIND[n.kind]}</p>
          <h3>{n.title}</h3>
        </div>
        <div>
          <p>{n.detail}</p>
          {n.code ? <code className="lp-trace-log">{n.code}</code> : null}
          {n.files ? (
            <ul>
              {n.files.map(([path, name]) => (
                <li key={path}>
                  <a href={`${SRC}/${path}`} target="_blank" rel="noreferrer">
                    {name} ↗
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="lp-arch-hint">Select any box to read what it does.</p>
        </div>
      </div>
    </div>
  );
}

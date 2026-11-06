import { useState } from "react";
import { Pill } from "../components/Badge";
import { REPO } from "../components/Layout";
import { Markdown } from "../components/Markdown";
import { useNetwork } from "../lib/network-context";

const DOCS = [
  ["erc-sentence-bound-frame-transactions.md", "Sentence-bound frame transactions", null],
  ["erc-signed-attestation-snapshots.md", "Signed attestation snapshots", null],
];

export default function Standards() {
  const [open, setOpen] = useState(DOCS[0][0]);
  const { deployments } = useNetwork();
  const bountyLive = deployments && Object.values(deployments).some((d) => d.bountyWallet);
  return (
    <>
      <h1>Standards</h1>
      <p className="lede">What Verbatim proposes back: two ERC drafts, findings for the alternative-mempool author, and tools others can use today.</p>

      <h2 className="section">ERC drafts</h2>
      <div className="tabs" role="tablist">
        {DOCS.map(([f, t]) => (
          <button key={f} role="tab" aria-selected={open === f} className={open === f ? "on" : ""} onClick={() => setOpen(f)}>
            {t}
          </button>
        ))}
      </div>
      <div className="panel">
        <div className="row small">
          <Pill tone="warn">draft, not yet posted to Ethereum Magicians</Pill>
          <a href={`${REPO}/blob/main/docs/erc/${open.replace(/^erc-/, "")}`}>Source</a>
        </div>
        <Markdown path={`docs/${open}`} />
      </div>

      <h2 className="section">Findings (a)–(d) and others</h2>
      <div className="panel">
        <div className="row small">
          <Pill tone="warn">ready to file, none filed yet</Pill>
        </div>
        <Markdown path="docs/FINDINGS.md" strip />
      </div>

      <h2 className="section">Tooling</h2>
      <div className="grid2">
        <div className="panel">
          <h2>
            frame-tools <Pill>FrameReader · ApproveShim</Pill>
          </h2>
          <Markdown path="docs/frame-tools.md" strip />
          <p className="small muted">
            Not on npm yet. Use it from the repository: <a href={`${REPO}/tree/main/packages/frame-tools`}>packages/frame-tools</a>.
          </p>
        </div>
        <div className="panel">
          <h2>@verbatim/urrender</h2>
          <Markdown path="docs/urrender.md" strip />
          <p className="small muted">
            Not on npm yet. Use it from the repository: <a href={`${REPO}/tree/main/packages/urrender`}>packages/urrender</a>.
          </p>
        </div>
      </div>

      <h2 className="section">Upstream</h2>
      <div className="panel">
        <Markdown path="docs/UPSTREAM.md" strip />
      </div>

      {!bountyLive ? (
        <div className="panel">
          <h2>
            Bounty <Pill tone="warn">Ready, not funded</Pill>
          </h2>
          <p className="small">The policy-bounded bounty oracle, the L2 deploy script and the terms are written. There is no L2 deployment and no funds at risk, so the bounty page is not shown.</p>
          <details>
            <summary className="small">Terms (docs/BOUNTY.md)</summary>
            <Markdown path="docs/BOUNTY.md" strip />
          </details>
        </div>
      ) : null}
    </>
  );
}

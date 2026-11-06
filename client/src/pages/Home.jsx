import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { REPO } from "../components/Layout";
import { Failed } from "../components/States";
import { Architecture } from "../landing/Architecture";
import { Boot } from "../landing/Boot";
import { BENEFITS, COMMANDS, EXPLORE, FAQ, FRAME_CAP, FRAME_PATHS, REFUSALS, STEPS, TRY, VERSUS } from "../landing/content";
import { Finale } from "../landing/Finale";
import { Footer } from "../landing/Footer";
import { GateArt } from "../landing/GateArt";
import { HexField } from "../landing/HexField";
import { IsoIcon } from "../landing/IsoIcon";
import { LandingNav } from "../landing/LandingNav";
import { reveal, startReveals } from "../landing/motion";
import { SentenceDevice } from "../landing/SentenceDevice";
import { Tagline } from "../landing/Tagline";
import "../landing/landing.css";
import { useData } from "../lib/data";
import { rows, summary } from "../lib/evidence";

const DOCS = `${REPO}/blob/main/contracts/docs`;

function Rule() {
  return (
    <div className="lp-rule" aria-hidden="true">
      {"─".repeat(320)}
    </div>
  );
}

function HeroProof({ s }) {
  if (!s) return <div className="lp-skel lp-skel-line" aria-hidden="true" />;
  const live = s.attacksMetByEvidence.final ?? 0;
  return (
    <p className="lp-hero-proof">
      <b>{live}</b> attacks stopped on live networks, on the final build. <Link to="/proofs">See every record →</Link>
    </p>
  );
}

function Hero({ data, error, list, s }) {
  return (
    <section className="lp-hero">
      <div>
        <h1>
          The chain is
          <br />
          your wallet’s
          <br />
          screen.
        </h1>
        <p className="lp-hero-sub">
          It checks you signed what you read.
          <br />
          Then it checks that it came true.
        </p>
        <p className="lp-lede">Bybit lost $1.5B because its signers approved what a tampered screen showed them. Verbatim makes Ethereum’s new frame transactions rebuild every transaction into the sentence you signed, inside the validation frame. Different words, and the alt mempool never admits it. Broken promise, and the whole batch reverts.</p>
        <div className="lp-ctas">
          <Link className="lp-btn lp-btn-primary" to="/demo">
            See the demo
          </Link>
          <Link className="lp-btn lp-btn-outline" to="/uniswap">
            On Uniswap
          </Link>
        </div>
        <HeroProof s={s} />
        <p className="lp-fine">Open source under MIT. Unaudited hackathon code, on testnets, with no funds at risk.</p>
      </div>
      {data ? (
        <SentenceDevice vectors={data[2].vectors} proofs={list} />
      ) : error ? (
        <Failed what="the example sentence" error={error} />
      ) : (
        <div className="lp-device lp-skel lp-skel-device" aria-hidden="true" />
      )}
    </section>
  );
}

function Refusals() {
  return (
    <div className="lp-strip" aria-label="Things an attacker can try, and what the chain answers">
      <div className="lp-strip-track">
        {[...REFUSALS, ...REFUSALS].map(([what, answer], i) => (
          <span key={i} aria-hidden={i >= REFUSALS.length}>
            {what} → <b>{answer}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Problem() {
  return (
    <section className="lp-section" id="problem" aria-labelledby="problem-title">
      <div className="lp-split">
        <div {...reveal()}>
          <p className="lp-eyebrow">The problem</p>
          <h2 id="problem-title">$1.5B left because a screen lied</h2>
          <p className="lp-copy">On 21 February 2025, Bybit’s signers approved what a tampered Safe{"{"}Wallet{"}"} frontend showed them, not what the transaction did.</p>
          <p className="lp-copy">Clear signing makes transactions readable, but it lives in the wallet. Each wallet renders on its own, nothing on chain checks the result, and a contract can describe itself truthfully while doing something else.</p>
        </div>
        <div className="lp-versus" {...reveal(1)} role="table" aria-label="Clear signing today compared with Verbatim">
          <div className="lp-versus-row lp-versus-head" role="row">
            <span role="columnheader">Who checks what</span>
            <span role="columnheader">Clear signing today</span>
            <span role="columnheader">Verbatim</span>
          </div>
          {VERSUS.map(([what, today, ours]) => (
            <div className="lp-versus-row" role="row" key={what}>
              <span role="rowheader">{what}</span>
              <span role="cell" className="lp-versus-today" data-label="Today">
                {today}
              </span>
              <span role="cell" className="lp-versus-ours" data-label="Verbatim">
                {ours}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section className="lp-section" id="how" aria-labelledby="how-title">
      <div className="lp-head lp-head-art" {...reveal()}>
        <div>
          <p className="lp-eyebrow">How it works</p>
          <h2 id="how-title">One transaction, start to finish</h2>
          <p className="lp-copy">You sign words, not calldata. Then two checkpoints on chain hold those words to account, one before the transaction is admitted and one after its calls have run.</p>
        </div>
        <GateArt />
      </div>
      <ol className="lp-trace">
        {STEPS.map((r, i) => (
          <li key={r.step} {...reveal(i)}>
            <IsoIcon name={r.icon} size={88} />
            <h3>{r.step}</h3>
            <p>{r.body}</p>
            <code className="lp-trace-log">{r.log}</code>
            <Link className="lp-more" to={r.to}>
              {r.more} →
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="lp-section" id="architecture" aria-labelledby="architecture-title">
      <div className="lp-head" {...reveal()}>
        <div>
          <p className="lp-eyebrow">Architecture</p>
          <h2 id="architecture-title">Where the words are checked</h2>
        </div>
        <p className="lp-copy">Everything left of the device is untrusted. On an EIP-8141 frame transaction, a VERIFY frame renders the sentence again before the mempool admits it, and the account holds it to its promises after the calls run. ERC-4337 carries the same check on chains without frames.</p>
      </div>
      <div {...reveal(1)}>
        <Architecture />
      </div>
    </section>
  );
}

/** What each of Verbatim's two formats does, one card each. Sourced from contracts/docs/VTREE.md and VSPEC.md. */
const FORMATS = [
  {
    name: "VTREE",
    big: "Checks the words",
    doc: "VTREE.md",
    rows: [
      ["What it is", "the sentence as canonical bytes: a header (chain, account, expiry, snapshot root, path), then each call with its fields, risks and guarantees"],
      ["What is signed", "its hash, keccak256 of those bytes. The offline device decodes the bytes itself and lists the risks and guarantees first"],
      ["When it is checked", "during validation: a VERIFY frame renders the VTREE again from the real calldata. The Solidity and TypeScript renderers agree byte for byte, across 10,000 fuzz cases"],
      ["Nothing unexplained", "an unknown function, contract or router command renders as BLIND, and is refused"],
      ["If it differs", "the mempool never admits the transaction, and nobody pays"],
    ],
    code: "SpecHashMismatch · TreeMismatch",
  },
  {
    name: "VSPEC",
    big: "Checks the effects",
    doc: "VSPEC.md",
    rows: [
      ["What it is", "the list of what must be true after the batch: balance changes, allowance limits, owners, code hashes, no approval left standing"],
      ["Where it comes from", "the VTREE’s guarantee section, byte for byte, so a host cannot show strong guarantees and send weaker ones"],
      ["What is signed", "its hash, beside the VTREE’s, in the same owner digest"],
      ["When it is checked", "after the calls run, inside the account. A tracked asset the VSPEC does not name may not drop at all"],
      ["If one fails", "the whole batch reverts. The fee stays paid, and the signed digest cannot be replayed"],
    ],
    code: "AssertionFailed · APPROVALS_CLEARED",
  },
];

function Formats() {
  return (
    <section className="lp-section" id="compare" aria-labelledby="compare-title">
      <div className="lp-head" {...reveal()}>
        <div>
          <p className="lp-eyebrow">Two formats</p>
          <h2 id="compare-title">VTREE and VSPEC</h2>
        </div>
        <p className="lp-copy">Every transaction carries two byte formats, and the owners sign the hash of each. One is checked before the transaction is admitted, the other after its calls have run.</p>
      </div>
      <div className="lp-duel">
        {FORMATS.map((f, i) => (
          <article key={f.name} className="lp-card lp-card-fmt" {...reveal(i)}>
            <h3>{f.name}</h3>
            <p className="lp-card-big">{f.big}</p>
            <dl className="lp-kv">
              {f.rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <code className="lp-trace-log lp-fmt-code">{f.code}</code>
            <a className="lp-more" href={`${DOCS}/${f.doc}`} target="_blank" rel="noreferrer">
              Read the {f.name} format ↗
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <section className="lp-section" id="benefits" aria-labelledby="benefits-title">
      <p className="lp-eyebrow" {...reveal()}>What changes</p>
      <h2 id="benefits-title" {...reveal(1)}>Stop trusting the screen</h2>
      <ul className="lp-can">
        {BENEFITS.map((b) => (
          <li key={b.title} {...reveal()}>
            <q>{b.say}</q>
            <div className="lp-can-body">
              <IsoIcon name={b.icon} size={72} />
              <div>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
              {b.to ? (
                <Link className="lp-more" to={b.to}>
                  {b.more} →
                </Link>
              ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SEG_LABEL = { expiry: "expiry frame", account: "account frame", paymaster: "paymaster frame", signatures: "signatures" };
const fmt = (n) => n.toLocaleString("en-US");

/** One validation prefix as a bar against the 100k cap: each frame's gas, the signatures, and what is left. */
function GasBar({ what, parts }) {
  const used = parts.reduce((n, [, g]) => n + g, 0);
  const label = `${what}: ${parts.map(([k, g]) => `${SEG_LABEL[k]} ${fmt(g)}`).join(", ")}; ${fmt(used)} of ${fmt(FRAME_CAP)}, ${fmt(FRAME_CAP - used)} to spare`;
  return (
    <div className="lp-gas">
      <div className="lp-gas-head">
        <span>{what}</span>
        <span>
          <b>{fmt(used)}</b> of {fmt(FRAME_CAP)} · {fmt(FRAME_CAP - used)} to spare
        </span>
      </div>
      <div className="lp-gas-bar" role="img" aria-label={label}>
        {parts.map(([k, g]) => (
          <span key={k} className={`lp-gas-seg lp-gas-${k}`} style={{ width: `${(g / FRAME_CAP) * 100}%` }} title={`${SEG_LABEL[k]}: ${fmt(g)} gas`} />
        ))}
      </div>
    </div>
  );
}

function Paths() {
  return (
    <section className="lp-section" id="paths" aria-labelledby="paths-title">
      <div className="lp-head" {...reveal()}>
        <div>
          <p className="lp-eyebrow">Frame transactions</p>
          <h2 id="paths-title">Two ways to fit under 100,000 gas</h2>
        </div>
        <p className="lp-copy">
          An EIP-8141 transaction is a list of frames. VERIFY frames validate and end in APPROVE; the SENDER frame executes. The owners sign an explicit digest, so the protocol checks every signature before any frame runs, at 2,800 gas each, and that cost counts toward the cap: 100,000 was admitted, 100,001 refused. Both paths are live on the EF frames devnet.
        </p>
      </div>
      <div className="lp-fpaths">
        {FRAME_PATHS.map((p, i) => (
          <article key={p.name} className="lp-fpath" {...reveal(i)}>
            <h3>{p.name}</h3>
            <p className="lp-paths-where">{p.where}</p>
            <ol className="lp-frames">
              {p.frames.map((f, j) => (
                <li key={j}>
                  <span className="lp-frame-i">{j}</span>
                  <span className={`lp-frame-mode lp-frame-${f.mode.toLowerCase()}`}>{f.mode}</span>
                  <span className="lp-frame-body">
                    <b>{f.target}</b>
                    <span>{f.does}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="lp-frame-sigs">Signatures: {p.sigs}, checked by the protocol before frame 0</p>
            <GasBar what="Transfer" parts={p.gas.transfer} />
            <GasBar what="v4 swap" parts={p.gas.swap} />
            <dl className="lp-kv lp-fpath-facts">
              {p.facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <div className="lp-gas-legend" aria-hidden="true">
        {Object.entries(SEG_LABEL).map(([k, v]) => (
          <span key={k}>
            <i className={`lp-gas-seg lp-gas-${k}`} />
            {v}
          </span>
        ))}
        <span>
          <i className="lp-gas-seg lp-gas-free" />
          headroom to the cap
        </span>
      </div>
      <p className="lp-honest">
        <b>How the wallet chooses:</b> the stateless path when the account frame fits with 10,000 gas to spare, the paymaster path otherwise. Each extra call costs about 21,500 gas, so only single-call batches fit the flat cap today.
      </p>
    </section>
  );
}

function Try() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // The commands stay on screen to select by hand.
    }
  };
  return (
    <section className="lp-section" id="try" aria-labelledby="try-title">
      <p className="lp-eyebrow" {...reveal()}>Try it</p>
      <h2 id="try-title" {...reveal(1)}>Go break it</h2>
      <div className="lp-try">
        <ol className="lp-steps" {...reveal()}>
          {TRY.map((t) => (
            <li key={t.to}>
              <h3>
                <Link to={t.to}>{t.title} →</Link>
              </h3>
              <p>{t.body}</p>
            </li>
          ))}
        </ol>
        <div className="lp-term" {...reveal(1)}>
          <div className="lp-winbar">
            <span className="lp-winbar-title">run the proofs yourself</span>
            <button type="button" className="lp-btn lp-btn-quiet lp-btn-small" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre tabIndex={0}>{COMMANDS}</pre>
        </div>
      </div>
      <ul className="lp-explore">
        {EXPLORE.map(([to, name, what, icon], i) => (
          <li key={to} {...reveal(i % 4)}>
            <Link to={to}>
              <IsoIcon name={icon} size={56} />
              <b>{name}</b>
              <span>{what}</span>
            </Link>
          </li>
        ))}
        <li {...reveal(3)}>
          <a href={REPO} target="_blank" rel="noreferrer">
            <IsoIcon name="bundle" size={56} />
            <b>Repository</b>
            <span>Every contract, script and proof ↗</span>
          </a>
        </li>
      </ul>
    </section>
  );
}

function Faq() {
  return (
    <section className="lp-section" id="faq" aria-labelledby="faq-title">
      <p className="lp-eyebrow" {...reveal()}>FAQ</p>
      <h2 id="faq-title" {...reveal(1)}>Plain answers</h2>
      <div className="lp-faq">
        {FAQ.map((f) => (
          <details key={f.q} {...reveal()}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const d = useData(["proofs.json", "manifest.json", "render-vectors.json"]);
  const { hash } = useLocation();
  const list = d.data ? rows(d.data[0]) : null;
  const s = list ? summary(list) : null;

  // Arriving by link: once on mount, and again when the data has settled the sections above the target. After that, in-page
  // links belong to the browser.
  const loaded = Boolean(d.data);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "instant" });
    else if (!loaded) window.scrollTo({ top: 0, behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Blocks rise into place once, as they first come into view. Loaded data moves everything below it, so measure again.
  useEffect(() => {
    startReveals();
  }, [loaded]);

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <Boot />
      <HexField />
      <LandingNav />
      <main id="main">
        <Hero data={d.data} error={d.error} list={list} s={s} />
        <Refusals />
        <Problem />
        <Tagline />
        <How />
        <Rule />
        <ArchitectureSection />
        <Formats />
        <Rule />
        <Benefits />
        <Paths />
        <Rule />
        <Rule />
        <Try />
        <Faq />
        <section className="lp-finale" aria-labelledby="finale-title">
          <Finale />
          <p id="finale-title" className="lp-finale-line">
            Read it. Sign it. The chain checks both.
          </p>
          <div className="lp-ctas lp-ctas-center">
            <Link className="lp-btn lp-btn-primary" to="/demo">
              See the demo
            </Link>
            <Link className="lp-btn lp-btn-outline" to="/uniswap">
              On Uniswap
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

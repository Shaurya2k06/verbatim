import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Evidence } from "../components/Badge";
import { REPO } from "../components/Layout";
import { DevnetBanner, StatusBar } from "../components/StatusBar";
import { Failed } from "../components/States";
import { TxLink } from "../components/TxLink";
import { Architecture } from "../landing/Architecture";
import { Boot } from "../landing/Boot";
import { BENEFITS, COMMANDS, COVERS, EXCLUDES, EXPLORE, FAQ, FRAME_CAP, FRAME_PATHS, REFUSALS, STEPS, TRY, VERSUS } from "../landing/content";
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

const dusdc = (raw) => (Number(raw) / 1e6).toFixed(2);

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

function SideBySide({ list }) {
  const eoa = list?.find((r) => r.id === "B-A2-eoa");
  const ours = list?.find((r) => r.id === "B-A2b");
  const got = eoa?.extra?.victimGot;
  const took = eoa?.extra?.hookTook;
  const share = got && took ? Math.round((Number(took) / (Number(took) + Number(got))) * 100) : null;
  return (
    <section className="lp-section" id="compare" aria-labelledby="compare-title">
      <div className="lp-head" {...reveal()}>
        <div>
          <p className="lp-eyebrow">The difference</p>
          <h2 id="compare-title">Same route. Two wallets.</h2>
        </div>
        <p className="lp-copy">A 0.001 ETH swap on Uniswap’s official Sepolia contracts, through a pool whose hook skims the output. Both results are recorded on a live network. The difference is the two things Verbatim adds: a VTREE, the sentence the chain rebuilds from the calldata, and a VSPEC, the promises it checks after the calls.</p>
      </div>
      <div className="lp-duel">
        <article className="lp-card lp-card-bad" {...reveal()}>
          <IsoIcon name="leak" size={88} />
          <h3>Ordinary wallet</h3>
          <p className="lp-card-big">{share !== null ? `${share}% gone` : "…"}</p>
          <dl className="lp-kv">
            <div>
              <dt>You signed</dt>
              <dd>raw calldata. No VTREE, so nothing rebuilt what you read</dd>
            </div>
            <div>
              <dt>After the swap</dt>
              <dd>nothing checked. No VSPEC, so the hook’s cut stood</dd>
            </div>
            <div>
              <dt>You received</dt>
              <dd>{got ? `${dusdc(got)} dUSDC` : "…"}</dd>
            </div>
            <div>
              <dt>The hook took</dt>
              <dd>{took ? `${dusdc(took)} dUSDC` : "…"}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>{eoa?.txHash ? <TxLink hash={eoa.txHash} leg={eoa.leg} /> : "…"}</dd>
            </div>
          </dl>
        </article>
        <article className="lp-card lp-card-ok" {...reveal(1)}>
          <IsoIcon name="check" size={88} />
          <h3>Verbatim</h3>
          <p className="lp-card-big">Nothing moved</p>
          <dl className="lp-kv">
            <div>
              <dt>VTREE, what you read</dt>
              <dd>the sentence, with three risk lines read from the hook’s address: no minimum output, hook can take your output, unverified hook</dd>
            </div>
            <div>
              <dt>Rebuilt on chain</dt>
              <dd>
                the same VTREE, from the real calldata. The policy refuses that hook: <code>PolicyRefused</code>
              </dd>
            </div>
            <div>
              <dt>If the screen lied</dt>
              <dd>
                hide a warning, and the rebuilt VTREE no longer matches what was signed: <code>SpecHashMismatch</code>
              </dd>
            </div>
            <div>
              <dt>VSPEC, what must hold</dt>
              <dd>ETH spent exactly as signed, output at or above the signed minimum, no approval left. Checked after the calls, or the batch reverts</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{ours ? <Evidence kind={ours.evidence} /> : "…"}</dd>
            </div>
          </dl>
        </article>
      </div>
      <p className="lp-copy lp-duel-note" {...reveal()}>
        We also compromised <b>Uniswap’s real interface</b>: it quoted <b>26.19 USDC</b>, and the ordinary wallet got <b>0.026</b>. The VTREE rebuilt from those exact bytes carried three risk lines, and the account answered <code>PolicyRefused</code>.{" "}
        <Link to="/uniswap">Watch the recording →</Link>
      </p>
      <div className="lp-ctas lp-ctas-center">
        <Link className="lp-btn lp-btn-outline" to="/uniswap#skim">
          Run both, live
        </Link>
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

function Proof({ s, manifest, error }) {
  const reg = manifest?.registry;
  return (
    <section className="lp-section" id="proof" aria-labelledby="proof-title">
      <div className="lp-head" {...reveal()}>
        <div>
          <p className="lp-eyebrow">Proof</p>
          <h2 id="proof-title">Don’t take this page’s word for it</h2>
        </div>
        <p className="lp-copy">The counts below are read from the proof ledger published with this build. Each row links to the transaction or the named revert behind it.</p>
      </div>
      {error ? <Failed what="the proof ledger" error={error} /> : null}
      <ul className="lp-stats" {...reveal()}>
        <li>
          {s ? (
            <>
              <b>
                {s.attacksMet} <small>of {s.attacks}</small>
              </b>
              <span>recorded attacks stopped as expected</span>
              <div className="badges">
                {s.attacksMetByEvidence.final ? <Evidence kind="final" detail={s.attacksMetByEvidence.final} /> : null}
                {s.attacksMetByEvidence.older ? <Evidence kind="older" detail={s.attacksMetByEvidence.older} /> : null}
              </div>
            </>
          ) : error ? null : (
            <div className="lp-skel lp-skel-stat" aria-hidden="true" />
          )}
        </li>
        <li>
          {s ? (
            <>
              <b>
                {s.rejected} <small>rejected</small>
              </b>
              <span>transactions refused before the mempool, against {s.admitted} admitted</span>
            </>
          ) : error ? null : (
            <div className="lp-skel lp-skel-stat" aria-hidden="true" />
          )}
        </li>
        <li>
          {reg ? (
            <>
              <b>
                {reg.compiled.toLocaleString("en-US")} <small>of {reg.total.toLocaleString("en-US")}</small>
              </b>
              <span>ERC-7730 registry functions compile, with each failure listed and explained</span>
            </>
          ) : error ? null : (
            <div className="lp-skel lp-skel-stat" aria-hidden="true" />
          )}
        </li>
        <li>
          <b>
            10,000 <small>per CI run</small>
          </b>
          <span>random cases compare the Solidity and TypeScript renderers byte for byte, with zero mismatches</span>
        </li>
      </ul>
      {s && s.notMet + s.notRun > 0 ? (
        <p className="lp-honest">
          <b>
            {s.notMet + s.notRun} of {s.total} rows
          </b>{" "}
          miss their expected result or have not run. They stay listed. <Link to="/proofs">Read them →</Link>
        </p>
      ) : null}
      <div className="lp-status">
        <StatusBar />
        <DevnetBanner />
      </div>
    </section>
  );
}

function Limits() {
  return (
    <section className="lp-section" id="limits" aria-labelledby="limits-title">
      <p className="lp-eyebrow" {...reveal()}>Limits</p>
      <h2 id="limits-title" {...reveal(1)}>What it will not save you from</h2>
      <div className="lp-scope">
        <div {...reveal()}>
          <IsoIcon name="check" size={72} />
          <h3>Covered</h3>
          <ul className="lp-bullets lp-bullets-ok">
            {COVERS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div {...reveal(1)}>
          <IsoIcon name="cross" size={72} />
          <h3>Not covered</h3>
          <ul className="lp-bullets lp-bullets-bad">
            {EXCLUDES.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="lp-honest">
        <b>Status:</b> hackathon code, unaudited, with no mainnet deployment and no independent review. <a href={`${DOCS}/STATUS.md`}>Read the full status →</a>
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
  const manifest = d.data?.[1] ?? null;

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
        <SideBySide list={list} />
        <Rule />
        <Benefits />
        <Paths />
        <Rule />
        <Proof s={s} manifest={manifest} error={d.error} />
        <Limits />
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

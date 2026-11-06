import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Evidence } from "../components/Badge";
import { REPO } from "../components/Layout";
import { DevnetBanner, StatusBar } from "../components/StatusBar";
import { Failed } from "../components/States";
import { TxLink } from "../components/TxLink";
import { AttackStage } from "../landing/AttackStage";
import { Boot } from "../landing/Boot";
import { BENEFITS, COMMANDS, COVERS, EXCLUDES, EXPLORE, FAQ, PATHS, REFUSALS, STEPS, TRY, VERSUS } from "../landing/content";
import { Finale } from "../landing/Finale";
import { GateArt } from "../landing/GateArt";
import { HexField } from "../landing/HexField";
import { LandingNav, Mark } from "../landing/LandingNav";
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
      <b>{live}</b> attacks stopped on Sepolia, on the final build. <Link to="/proofs">See every record →</Link>
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
        <p className="lp-lede">Bybit lost $1.5B because its signers approved what a tampered screen showed them. Verbatim makes Ethereum rebuild every transaction into the sentence you signed. Different words, and it never reaches the mempool. Broken promise, and the whole batch reverts.</p>
        <div className="lp-ctas">
          <Link className="lp-btn lp-btn-primary" to="/demo">
            Watch the attack fail
          </Link>
          <Link className="lp-btn lp-btn-outline" to="/attack">
            Attack us
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
    <section className="lp-section lp-reveal" id="problem" aria-labelledby="problem-title">
      <div className="lp-split">
        <div>
          <p className="lp-eyebrow">The problem</p>
          <h2 id="problem-title">$1.5B left because a screen lied</h2>
          <p className="lp-copy">On 21 February 2025, Bybit’s signers approved what a tampered Safe{"{"}Wallet{"}"} frontend showed them, not what the transaction did.</p>
          <p className="lp-copy">Clear signing makes transactions readable, but it lives in the wallet. Each wallet renders on its own, nothing on chain checks the result, and a contract can describe itself truthfully while doing something else.</p>
        </div>
        <div className="lp-versus" role="table" aria-label="Clear signing today compared with Verbatim">
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
    <section className="lp-section lp-reveal" id="how" aria-labelledby="how-title">
      <div className="lp-head lp-head-art">
        <div>
          <p className="lp-eyebrow">How it works</p>
          <h2 id="how-title">One transaction, start to finish</h2>
          <p className="lp-copy">You sign words, not calldata. Then two checkpoints on chain hold those words to account, one before the transaction is admitted and one after its calls have run.</p>
        </div>
        <GateArt />
      </div>
      <ol className="lp-trace">
        {STEPS.map((r) => (
          <li key={r.step}>
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

function Attacks({ list }) {
  return (
    <section className="lp-section lp-reveal" id="attacks" aria-labelledby="attacks-title">
      <div className="lp-head">
        <div>
          <p className="lp-eyebrow">Attacks</p>
          <h2 id="attacks-title">Six ways to lie. Watch where each one stops.</h2>
        </div>
        <p className="lp-copy">Each scene is backed by a recorded run. The line under it comes from the proof ledger, including which build it ran on.</p>
      </div>
      <AttackStage proofs={list} />
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
    <section className="lp-section lp-reveal" id="compare" aria-labelledby="compare-title">
      <div className="lp-head">
        <div>
          <p className="lp-eyebrow">The difference</p>
          <h2 id="compare-title">Same route. Two wallets.</h2>
        </div>
        <p className="lp-copy">A 0.001 ETH swap on Uniswap’s official Sepolia contracts, through a pool whose hook skims the output. Both results are recorded on a live network.</p>
      </div>
      <div className="lp-duel">
        <article className="lp-card lp-card-bad">
          <h3>Ordinary wallet</h3>
          <p className="lp-card-big">{share !== null ? `${share}% gone` : "…"}</p>
          <dl className="lp-kv">
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
        <article className="lp-card lp-card-ok">
          <h3>Verbatim</h3>
          <p className="lp-card-big">Nothing moved</p>
          <dl className="lp-kv">
            <div>
              <dt>The device showed</dt>
              <dd>three risk lines, before signing</dd>
            </div>
            <div>
              <dt>The account said</dt>
              <dd>
                <code>PolicyRefused</code>
              </dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{ours ? <Evidence kind={ours.evidence} /> : "…"}</dd>
            </div>
          </dl>
        </article>
      </div>
      <div className="lp-ctas lp-ctas-center">
        <Link className="lp-btn lp-btn-outline" to="/demo">
          Run both, live
        </Link>
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <section className="lp-section lp-reveal" id="benefits" aria-labelledby="benefits-title">
      <p className="lp-eyebrow">What changes</p>
      <h2 id="benefits-title">Stop trusting the screen</h2>
      <ul className="lp-can">
        {BENEFITS.map((b) => (
          <li key={b.title}>
            <q>{b.say}</q>
            <div>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
              {b.to ? (
                <Link className="lp-more" to={b.to}>
                  {b.more} →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Paths() {
  return (
    <section className="lp-section lp-reveal" id="paths" aria-labelledby="paths-title">
      <div className="lp-head">
        <div>
          <p className="lp-eyebrow">Where it runs</p>
          <h2 id="paths-title">Three paths, one guarantee</h2>
        </div>
        <p className="lp-copy">Every path renders the sentence during validation and asserts it during execution. They differ in who does the rendering, and in how far each has been proven live.</p>
      </div>
      <ul className="lp-paths">
        {PATHS.map((p) => (
          <li key={p.name}>
            <h3>{p.name}</h3>
            <p className="lp-paths-where">{p.where}</p>
            <p>{p.body}</p>
            <span className={`lp-state lp-state-${p.tone}`}>{p.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Proof({ s, manifest, error }) {
  const reg = manifest?.registry;
  return (
    <section className="lp-section lp-reveal" id="proof" aria-labelledby="proof-title">
      <div className="lp-head">
        <div>
          <p className="lp-eyebrow">Proof</p>
          <h2 id="proof-title">Don’t take this page’s word for it</h2>
        </div>
        <p className="lp-copy">The counts below are read from the proof ledger published with this build. Each row links to the transaction or the named revert behind it.</p>
      </div>
      {error ? <Failed what="the proof ledger" error={error} /> : null}
      <ul className="lp-stats">
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
          miss their expected result or have not run. The public frames devnet stopped during the final build, so those rows come from older builds, some with a masked revert bug since fixed. They stay listed until the rerun. <Link to="/proofs">Read them →</Link>
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
    <section className="lp-section lp-reveal" id="limits" aria-labelledby="limits-title">
      <p className="lp-eyebrow">Limits</p>
      <h2 id="limits-title">What it will not save you from</h2>
      <div className="lp-scope">
        <div>
          <h3>Covered</h3>
          <ul className="lp-bullets lp-bullets-ok">
            {COVERS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
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
    <section className="lp-section lp-reveal" id="try" aria-labelledby="try-title">
      <p className="lp-eyebrow">Try it</p>
      <h2 id="try-title">Go break it</h2>
      <div className="lp-try">
        <ol className="lp-steps">
          {TRY.map((t) => (
            <li key={t.to}>
              <h3>
                <Link to={t.to}>{t.title} →</Link>
              </h3>
              <p>{t.body}</p>
            </li>
          ))}
        </ol>
        <div className="lp-term">
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
        {EXPLORE.map(([to, name, what]) => (
          <li key={to}>
            <Link to={to}>
              <b>{name}</b>
              <span>{what}</span>
            </Link>
          </li>
        ))}
        <li>
          <a href={REPO} target="_blank" rel="noreferrer">
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
    <section className="lp-section lp-reveal" id="faq" aria-labelledby="faq-title">
      <p className="lp-eyebrow">FAQ</p>
      <h2 id="faq-title">Plain answers</h2>
      <div className="lp-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer({ manifest }) {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-brand">
        <Mark size={18} />
        <span>Verbatim. The chain is your wallet’s screen.</span>
      </div>
      <div className="lp-footer-links">
        <a href={REPO}>Repository</a>
        <a href={`${REPO}/tree/main/contracts/docs/erc`}>ERC drafts</a>
        <a href={`${DOCS}/FINDINGS.md`}>Findings</a>
        <a href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
        <a href={`${REPO}/graphs/contributors`}>Team</a>
        {manifest ? (
          <span>
            evidence as of {manifest.commit}
            {manifest.dirty ? "+modified" : ""}
          </span>
        ) : null}
      </div>
    </footer>
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

  // Sections rise into place once, as they first come into view.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll(".lp-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

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
        <Attacks list={list} />
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
              Watch the attack fail
            </Link>
            <Link className="lp-btn lp-btn-outline" to="/attack">
              Attack us
            </Link>
          </div>
        </section>
      </main>
      <Footer manifest={manifest} />
    </div>
  );
}

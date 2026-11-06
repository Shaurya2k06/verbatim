import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Evidence, Pill } from "../components/Badge";
import { OUTCOME } from "../lib/evidence";
import { LAYERS, SCENES } from "./content";
import { calm } from "./motion";

const SCENE_MS = 8500;

/** One attack at a time: what it tries, how it plays out, where it stops, and the recorded result behind that claim. */
export function AttackStage({ proofs }) {
  const [still] = useState(calm);
  const [i, setI] = useState(0);
  const [step, setStep] = useState(still ? Infinity : 0);
  const root = useRef(null);
  const bar = useRef(null);
  const hold = useRef({ hover: false, offscreen: true });
  const scene = SCENES[i];
  const steps = scene.lines.length + 1;
  const row = proofs?.find((r) => r.id === scene.id);

  const go = (n) => {
    setI(n);
    setStep(still ? Infinity : 0);
  };

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => (hold.current.offscreen = !e.isIntersecting), { threshold: 0.2 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);

  // A hand on the stage holds it still. Time only runs while it is on screen.
  useEffect(() => {
    if (still) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      if (hold.current.hover || hold.current.offscreen) return;
      elapsed += dt;
      const p = Math.min(1, elapsed / SCENE_MS);
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      setStep(Math.floor((elapsed / (SCENE_MS * 0.72)) * steps));
      if (p >= 1) {
        cancelAnimationFrame(raf);
        setI((n) => (n + 1) % SCENES.length);
        setStep(0);
      }
    };
    if (bar.current) bar.current.style.transform = "scaleX(0)";
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, still, steps]);

  const onKey = (e) => {
    if (e.key === "ArrowRight") go((i + 1) % SCENES.length);
    if (e.key === "ArrowLeft") go((i - 1 + SCENES.length) % SCENES.length);
  };
  const answered = step >= scene.lines.length;

  return (
    <div
      className="lp-stage"
      ref={root}
      onPointerEnter={() => (hold.current.hover = true)}
      onPointerLeave={() => (hold.current.hover = false)}
      onFocus={() => (hold.current.hover = true)}
      onBlur={() => (hold.current.hover = false)}
    >
      <div className="lp-stage-body" id="lp-stage-panel" role="tabpanel" aria-label={scene.name}>
        <div>
          <p className="lp-stage-quote">{scene.plain}</p>
          <ol className="lp-rail" aria-label="Checkpoints">
            {LAYERS.map((l) => (
              <li key={l} className={answered && l === scene.stop ? "is-stop" : undefined}>
                {l}
              </li>
            ))}
          </ol>
          <p className={`lp-stage-result${answered ? " is-in" : ""}`}>{scene.result}</p>
        </div>
        <div className="lp-term lp-term-replay">
          <div className="lp-winbar">
            <span className="lp-winbar-title">{scene.id}</span>
          </div>
          <div className="lp-replay">
            {scene.lines.map(([who, what], n) => (
              <div key={`${scene.id}-${n}`} className={`lp-replay-line${step >= n ? " is-in" : ""}`}>
                <span>{who}</span>
                <span>{what}</span>
              </div>
            ))}
            <div key={`${scene.id}-answer`} className={`lp-replay-line lp-replay-answer${answered ? " is-in" : ""}`}>
              <span>[!]</span>
              <span>{scene.answer}</span>
            </div>
          </div>
          <div className="lp-replay-proof">
            {row ? (
              <>
                {row.pass ? <Pill tone="ok">expected met</Pill> : <Pill tone="bad">expected not met</Pill>}
                <Evidence kind={row.evidence} />
                <span className="lp-replay-outcome">{OUTCOME[row.outcome] ?? row.outcome}</span>
                <Link to={`/proofs?id=${encodeURIComponent(row.id)}`}>Read the record →</Link>
              </>
            ) : proofs ? (
              <span className="lp-replay-outcome">No recorded proof {scene.id} in this build.</span>
            ) : (
              <span className="lp-replay-outcome">Loading the recorded result…</span>
            )}
          </div>
        </div>
      </div>
      <div className="lp-stage-index" role="tablist" aria-label="Attacks" onKeyDown={onKey}>
        {SCENES.map((s, n) => (
          <button key={s.id} type="button" role="tab" aria-selected={n === i} aria-controls="lp-stage-panel" tabIndex={n === i ? 0 : -1} onClick={() => go(n)}>
            {n === i && !still ? <span className="lp-stage-bar" ref={bar} /> : null}
            <span className="lp-stage-num">{String(n + 1).padStart(2, "0")}</span>
            <span className="lp-stage-name">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

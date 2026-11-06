import { useEffect, useRef, useState } from "react";
import { Evidence } from "../components/Badge";
import { Sentence, linesOf } from "../components/Sentence";
import { calm } from "./motion";

// Two recorded render vectors, decoded by displayvm-ts: the honest swap, then the same swap through the skim hook.
const ROUTES = [
  { key: "honest", tab: "Honest route", vector: "ur.v4_swap", proof: "B-swap", answer: "A swap like this rendered the same and landed on Sepolia.", tone: "ok" },
  { key: "risk", tab: "Skim hook", vector: "ur.v4_swap skim hook, no minimum", proof: "B-A2b", answer: "The device warns, and the account answers PolicyRefused.", tone: "bad" },
];
const LINE_MS = 220;
const HOLD_LINES = 16;

/** The hero: the offline signer's screen, one line at a time, for real recorded sentences. */
export function SentenceDevice({ vectors, proofs }) {
  const [still] = useState(calm);
  const [view, setView] = useState({ which: 0, reveal: still ? Infinity : 0 });
  const paused = useRef(false);
  const screen = useRef(null);
  const route = ROUTES[view.which];
  const tree = vectors.find((v) => v.name === route.vector)?.tree;
  const total = tree ? linesOf(tree).length : 0;
  const done = view.reveal >= total;
  const row = proofs?.find((r) => r.id === route.proof);

  useEffect(() => {
    if (still) return;
    const t = setInterval(() => {
      if (paused.current) return;
      setView((v) => (v.reveal >= total + HOLD_LINES ? { which: 1 - v.which, reveal: 0 } : { ...v, reveal: v.reveal + 1 }));
    }, LINE_MS);
    return () => clearInterval(t);
  }, [still, total]);

  // Follow the newest line, without moving the page around it.
  useEffect(() => {
    if (still || done || paused.current || !screen.current) return;
    screen.current.scrollTop = view.reveal === 0 ? 0 : screen.current.scrollHeight;
  }, [view, still, done]);

  // Then come back to the lines that matter: the warnings if there are any, otherwise the guarantees at the top.
  useEffect(() => {
    if (still || !done || paused.current || !screen.current) return;
    const risk = screen.current.querySelector(".s-risk");
    screen.current.scrollTo({ top: risk ? risk.offsetTop - 16 : 0, behavior: "smooth" });
  }, [still, done, view.which]);

  if (!tree) return null;
  return (
    <figure className="lp-device">
      <div className="lp-winbar">
        <span className="lp-winbar-title">offline signer · no network</span>
        <div className="lp-tabs" role="group" aria-label="Which route to show">
          {ROUTES.map((r, i) => (
            <button key={r.key} type="button" aria-pressed={view.which === i} className={view.which === i ? "is-on" : undefined} onClick={() => setView({ which: i, reveal: still ? Infinity : 0 })}>
              {r.tab}
            </button>
          ))}
        </div>
      </div>
      <div
        className="lp-screen"
        ref={screen}
        tabIndex={0}
        role="region"
        aria-label={`The sentence for the ${route.tab.toLowerCase()}`}
        onPointerEnter={() => (paused.current = true)}
        onPointerLeave={() => (paused.current = false)}
        onFocus={() => (paused.current = true)}
        onBlur={() => (paused.current = false)}
      >
        <Sentence tree={tree} reveal={view.reveal} compact />
      </div>
      <div className={`lp-verdict${done ? ` is-${route.tone}` : ""}`} aria-live="off">
        {done ? (
          <>
            <span>{route.answer}</span>
            {row?.pass ? <Evidence kind={row.evidence} /> : null}
          </>
        ) : (
          <span className="lp-caret-line">reading the sentence</span>
        )}
      </div>
      <figcaption>
        Decoded in your browser by <code>displayvm-ts</code> from the test vectors, the bytes the on chain renderer must match.
      </figcaption>
    </figure>
  );
}

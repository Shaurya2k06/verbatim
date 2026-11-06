import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { REPO } from "../components/Layout";
import { perFrame } from "./motion";

const SECTIONS = [
  ["#how", "How it works"],
  ["#attacks", "Attacks"],
  ["#proof", "Proof"],
  ["#limits", "Limits"],
  ["#faq", "FAQ"],
];

const V = ["X......X", "X......X", ".X....X.", ".X....X.", "..X..X..", "..X..X..", "...XX...", "...XX..."];

/** The mark: a V drawn on the same pixel grid as the headings. */
export function Mark({ size = 20 }) {
  return (
    <svg className="lp-mark" width={size} height={size} viewBox="-1 -1 10 10" aria-hidden="true">
      {V.flatMap((row, y) => Array.from(row, (c, x) => (c === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null)))}
    </svg>
  );
}

/** `base` is where the section links live: "" on the landing page itself, "/" from any other page. */
export function LandingNav({ base = "" }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  // Out of the way while reading down the page; back as soon as the reader scrolls up.
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = perFrame(() => {
      const y = window.scrollY;
      if (y < 80 || y < lastY - 24) setHidden(false);
      else if (y > lastY + 4) setHidden(true);
      lastY = y;
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      onScroll.cancel();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prior = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prior;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className={`lp-nav${hidden && !open ? " is-hidden" : ""}`} onFocus={() => setHidden(false)}>
        <Link className="lp-logo" to="/" onClick={close}>
          <Mark />
          verbatim
        </Link>
        <nav aria-label="Sections" className="lp-nav-links">
          <Link to="/suites">Demo</Link>
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={base + href}>
              {label}
            </a>
          ))}
        </nav>
        <a className="lp-btn lp-btn-quiet lp-btn-small lp-nav-repo" href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <button type="button" className={`lp-burger${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="lp-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          <i />
          <i />
        </button>
      </header>
      <div id="lp-menu" className={`lp-menu${open ? " is-open" : ""}`} inert={!open}>
        <nav aria-label="Menu">
          <Link to="/suites" onClick={close}>
            Demo
          </Link>
          {SECTIONS.map(([href, label], i) => (
            <a key={href} href={base + href} onClick={close} style={{ transitionDelay: open ? `${(i + 1) * 60}ms` : "0ms" }}>
              {label}
            </a>
          ))}
          <Link to="/proofs" onClick={close} style={{ transitionDelay: open ? "360ms" : "0ms" }}>
            Every proof
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer" onClick={close} style={{ transitionDelay: open ? "400ms" : "0ms" }}>
            GitHub
          </a>
        </nav>
      </div>
    </>
  );
}

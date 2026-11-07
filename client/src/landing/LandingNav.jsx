import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { REPO } from "../components/Layout";
import { perFrame } from "./motion";

const SECTIONS = [
  ["#how", "How it works"],
  ["#architecture", "Architecture"],
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

/**
 * The site's one navigation bar. On the landing page it carries the section links; `base` is where those live: "" on the landing
 * page itself, "/" from any other page. On the app pages `pages` ([path, label] pairs) replaces them with the page links, so there
 * is a single bar everywhere and no second row.
 */
export function LandingNav({ base = "", pages = null }) {
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
        {pages ? (
          <nav aria-label="Pages" className="lp-nav-links is-pages">
            {pages.map(([to, label]) => (
              <NavLink key={to} to={to}>
                {label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <nav aria-label="Sections" className="lp-nav-links">
            <Link to="/demo">Demo</Link>
            {SECTIONS.map(([href, label]) => (
              <a key={href} href={base + href}>
                {label}
              </a>
            ))}
          </nav>
        )}
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
          {pages ? (
            pages.map(([to, label], i) => (
              <NavLink key={to} to={to} onClick={close} style={{ transitionDelay: open ? `${Math.min(i, 8) * 40}ms` : "0ms" }}>
                {label}
              </NavLink>
            ))
          ) : (
            <>
              <Link to="/demo" onClick={close}>
                Demo
              </Link>
              {SECTIONS.map(([href, label], i) => (
                <a key={href} href={base + href} onClick={close} style={{ transitionDelay: open ? `${(i + 1) * 60}ms` : "0ms" }}>
                  {label}
                </a>
              ))}
              <Link to="/demo#proofs" onClick={close} style={{ transitionDelay: open ? "360ms" : "0ms" }}>
                Every proof
              </Link>
            </>
          )}
          <a href={REPO} target="_blank" rel="noreferrer" onClick={close} style={{ transitionDelay: open ? "400ms" : "0ms" }}>
            GitHub
          </a>
        </nav>
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { TAGLINE } from "./content";
import { calm, perFrame } from "./motion";

const WORDS = TAGLINE.flat().length;

/** The core promise, large. Words light one at a time as the section crosses the viewport, and stay lit. */
export function Tagline() {
  const ref = useRef(null);
  const [lit, setLit] = useState(() => (calm() ? WORDS : 0));

  useEffect(() => {
    if (calm()) return;
    const measure = perFrame(() => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const start = window.innerHeight * 0.85;
      const end = window.innerHeight * 0.4;
      const p = (start - box.top) / (start - end + box.height);
      setLit((n) => Math.max(n, Math.round(Math.min(1, Math.max(0, p)) * WORDS)));
    });
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      measure.cancel();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  let n = 0;
  return (
    <section className="lp-tagline" aria-label="The promise">
      <p ref={ref}>
        {TAGLINE.map((line, i) => (
          <span className="lp-tagline-line" key={i}>
            {line.map((w, j) => {
              const on = n++ < lit;
              return (
                <span key={j} className={on ? "is-lit" : undefined}>
                  {w}{" "}
                </span>
              );
            })}
          </span>
        ))}
      </p>
    </section>
  );
}

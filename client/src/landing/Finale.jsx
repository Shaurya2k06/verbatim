import { useEffect, useRef, useState } from "react";
import { calm } from "./motion";

const LETTERS = [
  ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
  ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██████╔╝", "╚═════╝ "],
  [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  ["███╗   ███╗", "████╗ ████║", "██╔████╔██║", "██║╚██╔╝██║", "██║ ╚═╝ ██║", "╚═╝     ╚═╝"],
];
const BANNER = Array.from({ length: 6 }, (_, row) => LETTERS.map((l) => l[row]).join(""));
const WIDTH = BANNER[0].length;
const HEX = "0123456789abcdef";
const DECODE_MS = 1700;

/** Calldata, left to right, turning into the word. */
function frame(p) {
  const edge = p * (WIDTH + 12);
  return BANNER.map((line, row) =>
    Array.from(line, (c, col) => {
      if (col < edge - 12) return c;
      if (col > edge) return " ";
      return HEX[(col * 7 + row * 13 + Math.floor(p * 60)) % 16];
    }).join(""),
  ).join("\n");
}

export function Finale() {
  const ref = useRef(null);
  const [text, setText] = useState(() => (calm() ? BANNER.join("\n") : frame(0)));

  useEffect(() => {
    if (calm()) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / DECODE_MS);
          setText(p < 1 ? frame(p) : BANNER.join("\n"));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <pre className="lp-banner" ref={ref} role="img" aria-label="Verbatim">
      {text}
    </pre>
  );
}

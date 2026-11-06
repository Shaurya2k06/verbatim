import { useEffect, useRef } from "react";
import { calm, perFrame } from "./motion";

const HEX = "0123456789abcdef";
const FONT = 13;
const LINE = 18;
const TONES = [0.05, 0.085, 0.13, 0.19];
const FRAME_MS = 50;
const CHAR_MS = 28;

// The real answers the contracts give, surfacing out of the calldata.
const WORDS = [
  ["execute(bytes,bytes[],uint256)", "plain"],
  ["frame 0  VERIFY  expiry", "plain"],
  ["frame 1  VERIFY  account", "plain"],
  ["frame 2  VERIFY  paymaster", "plain"],
  ["frame 3  SENDER  account", "plain"],
  ["TreeMismatch(expected, actual)", "bad"],
  ["PolicyRefused(56)", "bad"],
  ["BadLayout(0)", "bad"],
  ["SpecHashMismatch", "bad"],
  ["AssertionFailed: APPROVALS_CLEARED", "bad"],
  ["WrongResolverCode", "bad"],
  ["TtlTooLong", "bad"],
  ["AttestorNotListed", "bad"],
  ["render(calldata) == T", "good"],
  ["assert(S) holds", "good"],
  ["admitted", "good"],
];
const COLOR = { plain: "233, 236, 243", bad: "255, 107, 90", good: "141, 255, 176" };

const hashOf = (i, j) => (Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) >>> 0;
const glyph = (i, j, t) => {
  const h = hashOf(i, j);
  return HEX[(h + Math.floor(t / (900 + h % 2600)) * 7) % 16];
};

/** The page's background: calldata drifting as hex, with the chain's answers decoding out of it. */
export function HexField() {
  const wrap = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const still = calm();
    let cw = 8;
    let cols = 0;
    let rows = 0;

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT}px "Geist Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      cw = ctx.measureText("0").width;
      cols = Math.ceil(window.innerWidth / cw);
      rows = Math.ceil(window.innerHeight / LINE);
    };
    fit();

    const pointer = { x: -999, y: -999 };
    const onMove = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };

    const snippets = [];
    let nextSnippet = 0;
    // Words only surface beside the hero on wide screens. Anywhere else they would land behind text the visitor is reading.
    const spawn = (t) => {
      if (window.innerWidth <= 960 || window.scrollY > window.innerHeight * 0.6) return;
      const [text, tone] = WORDS[Math.floor(Math.random() * WORDS.length)];
      const minCol = Math.floor(cols * 0.5);
      const col = minCol + Math.floor(Math.random() * Math.max(1, cols - minCol - text.length));
      const row = Math.floor(Math.random() * rows);
      if (snippets.some((s) => s.row === row)) return;
      snippets.push({ text, tone, col, row, born: still ? t - 60000 : t, life: 4200 });
    };

    const draw = (t) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      // Whole rows of one tone are far cheaper than one fillText per character.
      for (let j = 0; j < rows; j++) {
        const span = snippets.find((s) => s.row === j);
        const lines = TONES.map(() => "");
        const y = j * LINE;
        for (let i = 0; i < cols; i++) {
          const v = Math.sin(i * 0.09 + t * 0.00018) + Math.sin(j * 0.16 - t * 0.00013) + Math.sin((i + j) * 0.05 + t * 0.00009);
          const x = i * cw;
          const near = Math.hypot(x - pointer.x, y - pointer.y) < 130;
          let tone = v > 0.25 ? Math.min(3, Math.floor((v - 0.25) / 0.7)) : -1;
          if (near) tone = Math.min(3, tone + 2);
          if (span && i >= span.col - 1 && i <= span.col + span.text.length) tone = -1;
          for (let k = 0; k < TONES.length; k++) lines[k] += k === tone ? glyph(i, j, t) : " ";
        }
        lines.forEach((line, k) => {
          ctx.fillStyle = `rgba(233, 236, 243, ${TONES[k]})`;
          ctx.fillText(line, 0, y);
        });
        if (!span) continue;
        const age = t - span.born;
        const fade = still ? 1 : Math.min(1, age / 300, (span.life - age) / 500);
        const shown = Array.from(span.text, (c, k) => (still || age > k * CHAR_MS || c === " " ? c : glyph(span.col + k, j, t + k * 97))).join("");
        ctx.fillStyle = `rgba(${COLOR[span.tone]}, ${0.62 * Math.max(0, fade)})`;
        ctx.fillText(shown, span.col * cw, y);
      }
    };

    let raf = 0;
    let last = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      for (let i = snippets.length - 1; i >= 0; i--) if (t - snippets[i].born > snippets[i].life) snippets.splice(i, 1);
      if (t > nextSnippet && snippets.length < 6) {
        spawn(t);
        nextSnippet = t + 900 + Math.random() * 1100;
      }
      draw(t);
    };
    const paintStill = () => {
      fit();
      snippets.length = 0;
      for (let i = 0; i < 5; i++) spawn(0);
      draw(0);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };

    // The field fades as the page scrolls past the hero, so long copy stays easy to read.
    const veil = perFrame(() => {
      const past = Math.min(1, window.scrollY / window.innerHeight);
      if (wrap.current) wrap.current.style.opacity = String(1 - past * 0.7);
    });
    const onResize = () => (still ? paintStill() : fit());

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", veil, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", start);
    document.fonts?.load(`${FONT}px "Geist Mono"`).then(() => (still ? paintStill() : fit()));
    veil();
    if (still) paintStill();
    else start();

    return () => {
      cancelAnimationFrame(raf);
      veil.cancel();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", veil);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return (
    <div className="lp-field" ref={wrap} aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}

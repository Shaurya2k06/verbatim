import { useEffect, useState } from "react";
import { calm } from "./motion";

const KEY = "verbatim.booted";
const WORD = "verbatim";

function seen() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** A short power on, once per visit: the word types itself, then the tube opens onto the page. Any input skips it. */
export function Boot() {
  const [skipped] = useState(() => calm() || seen());
  const [stage, setStage] = useState(skipped ? "done" : "type");

  useEffect(() => {
    if (skipped) return;
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Private windows may refuse storage. The intro just plays again next time.
    }
    const open = setTimeout(() => setStage("open"), 900);
    const done = setTimeout(() => setStage("done"), 1500);
    const skip = () => {
      clearTimeout(open);
      clearTimeout(done);
      setStage("done");
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      clearTimeout(open);
      clearTimeout(done);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [skipped]);

  if (stage === "done") return null;
  return (
    <div className={`lp-boot${stage === "open" ? " is-open" : ""}`} aria-hidden="true">
      <div className="lp-boot-half lp-boot-top" />
      <div className="lp-boot-half lp-boot-bottom" />
      <div className="lp-boot-line" />
      <div className="lp-boot-word">
        {Array.from(WORD, (c, i) => (
          <span key={i} style={{ animationDelay: `${i * 70}ms` }}>
            {c}
          </span>
        ))}
        <i />
      </div>
    </div>
  );
}

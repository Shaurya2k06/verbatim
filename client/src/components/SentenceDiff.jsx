// Two sentences side by side, every line that differs marked. Both come from displayvm-ts; nothing here writes a sentence.
import { linesOf } from "./Sentence";

function Column({ title, tree, other, tone }) {
  let lines;
  try {
    lines = linesOf(tree);
  } catch (e) {
    return <div className="bad">Does not decode: {e.message}</div>;
  }
  const theirs = new Set(other ? (() => { try { return linesOf(other).map((l) => l.text); } catch { return []; } })() : []);
  return (
    <div className={`diffcol ${tone ?? ""}`}>
      <h3>{title}</h3>
      <div className="sentence compact">
        {lines.map((l, i) => {
          const changed = other && !theirs.has(l.text) && !/^Valid until|^Policy version|^Snapshot/.test(l.text);
          return (
            <div key={i} className={`${l.risk ? "s-risk" : l.guarantee ? "s-guarantee" : "s-line"}${changed ? " s-changed" : ""}`} style={l.indent ? { paddingLeft: `${l.indent * 14}px` } : undefined}>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SentenceDiff({ claimed, actual, claimedTitle = "What you are asked to sign", actualTitle = "What the calldata really does" }) {
  if (!actual || actual === claimed) return <Column title={claimedTitle} tree={claimed} />;
  return (
    <div className="diff">
      <Column title={claimedTitle} tree={claimed} other={actual} />
      <Column title={actualTitle} tree={actual} other={claimed} tone="truth" />
    </div>
  );
}

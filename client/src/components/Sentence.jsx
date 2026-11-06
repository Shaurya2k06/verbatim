// The only way this site shows a sentence: displayvm-ts decodes the VTREE bytes and formats them, exactly as the signer does.
// The client never writes a sentence itself, so it cannot disagree with the chain.
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";

export function linesOf(tree) {
  return formatForDevice(decodeTree(tree));
}

export function Sentence({ tree, reveal = Infinity, compact = false }) {
  let lines;
  try {
    lines = linesOf(tree);
  } catch (e) {
    // A partial view could mislead. Show the decode error instead.
    return <div className="bad">This sentence does not decode: {e.message}</div>;
  }
  return (
    <div className={`sentence${compact ? " compact" : ""}`}>
      {lines.slice(0, reveal).map((l, i) => (
        <div key={i} className={l.risk ? "s-risk" : l.guarantee ? "s-guarantee" : "s-line"} style={l.indent ? { paddingLeft: `${l.indent * 14}px` } : undefined}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

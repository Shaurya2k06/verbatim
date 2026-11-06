import { EVIDENCE } from "../lib/evidence";

/** The evidence label every claim carries. */
export function Evidence({ kind, detail }) {
  const e = EVIDENCE[kind];
  if (!e) return null;
  return (
    <span className={`badge badge-${e.tone}`} title={e.note}>
      {e.label}
      {detail ? ` · ${detail}` : ""}
    </span>
  );
}

export function Pill({ tone = "mute", children, title }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

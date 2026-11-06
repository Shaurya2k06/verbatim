// built → signed → submitted → rejected at validation, or mined (batch ok or reverted).
const STEPS = [
  ["built", "Built"],
  ["signed", "Signed"],
  ["submitted", "Submitted"],
  ["done", "Result"],
];

export function Timeline({ stage, failed }) {
  const at = STEPS.findIndex(([k]) => k === stage);
  return (
    <ol className="timeline">
      {STEPS.map(([k, label], i) => (
        <li key={k} className={i < at ? "past" : i === at ? (failed && k === "done" ? "fail" : "now") : ""}>
          {label}
        </li>
      ))}
    </ol>
  );
}

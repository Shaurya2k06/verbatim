export const Loading = ({ what = "Loading" }) => <div className="muted pad">{what}…</div>;

export function Failed({ error, what }) {
  return (
    <div className="bad">
      Could not load {what}: {error?.message ?? String(error)}
    </div>
  );
}

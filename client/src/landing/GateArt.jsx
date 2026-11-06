// An isometric line drawing of the three checkpoints. An honest packet passes all three; a tampered one stops at validation.
const COS = 0.866;
const SIN = 0.5;
const OX = 84;
const OY = 64;
const SLAB = 84;
const PACKET = 16;
const LANE = SLAB / 2 - PACKET / 2;

const iso = (x, y, z = 0) => [OX + (x - y) * COS, OY + (x + y) * SIN - z];
const pts = (list) => list.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");

function Box({ x, y, w, d, h, z = 0 }) {
  const top = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
  const right = [[x + w, y, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x + w, y, z]];
  const left = [[x, y + d, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x, y + d, z]];
  return (
    <g>
      <polygon className="lp-iso-side" points={pts(left)} />
      <polygon className="lp-iso-dark" points={pts(right)} />
      <polygon className="lp-iso-top" points={pts(top)} />
    </g>
  );
}

const GATES = [
  { x: 0, n: "01", name: "device", note: "signs the words" },
  { x: 190, n: "02", name: "validation", note: "renders them again" },
  { x: 380, n: "03", name: "execution", note: "asserts the promise" },
];

function Gate({ x, n, name, note }) {
  const [lx, ly] = iso(x + SLAB, 0);
  const mid = x + SLAB / 2;
  return (
    <g>
      <Box x={x} y={0} w={SLAB} d={SLAB} h={10} />
      <polyline className="lp-iso-frame" points={pts([[mid, 8, 10], [mid, 8, 66], [mid, SLAB - 8, 66], [mid, SLAB - 8, 10]])} />
      <text x={lx + 8} y={ly - 32} className="lp-iso-num">
        {n}
      </text>
      <text x={lx + 34} y={ly - 32} className="lp-iso-name">
        {name}
      </text>
      <text x={lx + 8} y={ly - 14} className="lp-iso-note">
        {note}
      </text>
    </g>
  );
}

export function GateArt() {
  return (
    <svg className="lp-iso" viewBox="0 0 640 350" role="img" aria-label="Three checkpoints in a row: device, validation and execution. An honest transaction passes all three. A tampered one stops at validation.">
      <polyline className="lp-iso-track" points={pts([[-34, SLAB / 2, 0], [500, SLAB / 2, 0]])} />
      {GATES.map((g) => (
        <Gate key={g.name} {...g} />
      ))}
      <g className="lp-packet lp-packet-good">
        <Box x={-28} y={LANE} w={PACKET} d={PACKET} h={PACKET} z={10} />
      </g>
      <g className="lp-packet lp-packet-bad">
        <Box x={-28} y={LANE} w={PACKET} d={PACKET} h={PACKET} z={10} />
      </g>
    </svg>
  );
}

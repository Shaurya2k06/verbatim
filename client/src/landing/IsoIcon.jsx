// The landing page's icons, drawn on the same isometric grid as GateArt. Each is built from extruded shapes, so they share one
// light, one line weight and one set of colours. `.lp-ico-lift` parts settle into place as their block scrolls in.
const COS = 0.866;
const SIN = 0.5;
const OX = 48;
const OY = 60;

const iso = (x, y, z = 0) => [OX + (x - y) * COS, OY + (x + y) * SIN - z];
const pts = (list) => list.map(([x, y, z = 0]) => iso(x, y, z).map((n) => n.toFixed(2)).join(",")).join(" ");
const ring = (cx, cy, r, n = 28) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

function Box({ x, y, w, d, h, z = 0, tone }) {
  const t = z + h;
  return (
    <g>
      <polygon className="lp-iso-side" points={pts([[x, y + d, t], [x + w, y + d, t], [x + w, y + d, z], [x, y + d, z]])} />
      <polygon className="lp-iso-dark" points={pts([[x + w, y, t], [x + w, y + d, t], [x + w, y + d, z], [x + w, y, z]])} />
      <polygon className={`lp-iso-top${tone ? ` lp-ico-${tone}` : ""}`} points={pts([[x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t]])} />
    </g>
  );
}

/** Any outline on the floor, raised by h. Only the walls facing the viewer are drawn. */
function Prism({ outline, h, z = 0, tone }) {
  const edges = outline.map((p, i) => [p, outline[(i + 1) % outline.length]]);
  const facing = edges.filter(([a, b]) => b[0] - a[0] + (a[1] - b[1]) > 0 || (a[0] + a[1] + b[0] + b[1]) / 2 > (outline.reduce((s, p) => s + p[0] + p[1], 0) / outline.length));
  return (
    <g>
      {facing
        .sort((p, q) => p[0][0] + p[0][1] + p[1][0] + p[1][1] - (q[0][0] + q[0][1] + q[1][0] + q[1][1]))
        .map(([a, b], i) => (
          <polygon key={i} className="lp-iso-side lp-ico-seam" points={pts([[a[0], a[1], z + h], [b[0], b[1], z + h], [b[0], b[1], z], [a[0], a[1], z]])} />
        ))}
      <polygon className={`lp-iso-top${tone ? ` lp-ico-${tone}` : ""}`} points={pts(outline.map(([x, y]) => [x, y, z + h]))} />
    </g>
  );
}

/** A line drawn on a flat plane at height z. */
const Mark = ({ line, z = 0, tone, closed }) => {
  const P = closed ? "polygon" : "polyline";
  return <P className={`lp-ico-mark${tone ? ` lp-ico-mark-${tone}` : ""}`} points={pts(line.map(([x, y, zz]) => [x, y, zz ?? z]))} />;
};

const Lift = ({ children, order = 1 }) => <g className={`lp-ico-lift lp-ico-lift-${order}`}>{children}</g>;

const ICONS = {
  // Parts snapping together: what a frontend assembles.
  build: () => (
    <>
      <Box x={-22} y={-22} w={44} d={44} h={5} />
      <Box x={-15} y={-15} w={30} d={30} h={5} z={5} />
      <Lift>
        <Box x={-8} y={-8} w={16} d={16} h={10} z={16} tone="ok" />
      </Lift>
    </>
  ),
  // A handheld, showing the sentence.
  device: () => (
    <>
      <Box x={-15} y={-24} w={30} d={48} h={5} />
      <Mark z={5} closed line={[[-11, -20], [11, -20], [11, 12], [-11, 12]]} />
      <Lift>
        <Mark z={5} tone="ok" line={[[-7, -14], [7, -14]]} />
        <Mark z={5} line={[[-7, -7], [7, -7]]} />
        <Mark z={5} line={[[-7, 0], [3, 0]]} />
      </Lift>
    </>
  ),
  // A checkpoint with a packet held in it.
  gate: () => (
    <>
      <Box x={-22} y={-22} w={44} d={44} h={5} />
      <Mark tone="ink" line={[[0, -16, 5], [0, -16, 38], [0, 16, 38], [0, 16, 5]]} />
      <Lift>
        <Box x={-6} y={-6} w={12} d={12} h={12} z={5} tone="ok" />
      </Lift>
    </>
  ),
  // A solid block, checked.
  check: () => (
    <>
      <Box x={-18} y={-18} w={36} d={36} h={22} />
      <Lift>
        <Mark z={22} tone="ok" line={[[-10, 7], [-3, 7], [-3, -13]]} />
      </Lift>
    </>
  ),
  cross: () => (
    <>
      <Box x={-18} y={-18} w={36} d={36} h={22} />
      <Lift>
        <Mark z={22} tone="risk" line={[[-12, 0], [12, 0]]} />
        <Mark z={22} tone="risk" line={[[0, -12], [0, 12]]} />
      </Lift>
    </>
  ),
  // A monitor that is no longer believed.
  screen: () => (
    <>
      <Box x={-13} y={-13} w={26} d={26} h={4} />
      <Box x={-22} y={-2} w={44} d={4} h={32} z={4} />
      <Lift>
        <Mark tone="risk" line={[[-17, 2, 9], [17, 2, 31]]} />
      </Lift>
    </>
  ),
  warning: () => (
    <>
      <Box x={-22} y={-22} w={44} d={44} h={6} />
      <Lift>
        <Prism outline={[[-13, 15], [15, 15], [15, -13]]} h={5} z={6} tone="risk" />
      </Lift>
    </>
  ),
  // A dial on a slab: expiry.
  clock: () => (
    <>
      <Box x={-22} y={-22} w={44} d={44} h={6} />
      <Mark z={6} closed line={ring(0, 0, 16)} />
      <Lift>
        <Mark z={6} tone="ok" line={[[0, -11], [0, 0], [8, 0]]} />
      </Lift>
    </>
  ),
  tag: () => (
    <>
      <Prism outline={[[-30, -17], [10, -17], [30, 0], [10, 17], [-30, 17]]} h={7} />
      <Lift>
        <Mark z={7} tone="ok" closed line={ring(14, 0, 4.5, 16)} />
        <Mark z={7} line={[[-22, -6], [2, -6]]} />
        <Mark z={7} line={[[-22, 5], [-4, 5]]} />
      </Lift>
    </>
  ),
  rails: () => (
    <>
      {[-22, -10, 2, 14].map((y) => (
        <Box key={y} x={-18} y={y} w={36} d={6} h={3} />
      ))}
      <Box x={-13} y={-26} w={4} d={50} h={4} z={3} />
      <Lift>
        <Box x={9} y={-26} w={4} d={50} h={4} z={3} tone="ok" />
      </Lift>
    </>
  ),
  // Several operations in one bundle.
  bundle: () => (
    <>
      <Box x={-20} y={-20} w={19} d={19} h={16} />
      <Box x={1} y={-20} w={19} d={19} h={16} />
      <Box x={-20} y={1} w={19} d={19} h={16} />
      <Box x={1} y={1} w={19} d={19} h={16} />
      <Lift>
        <Box x={-9} y={-9} w={18} d={18} h={14} z={16} tone="ok" />
      </Lift>
    </>
  ),
  // Trust carried as layers of proof.
  layers: () => (
    <>
      <Box x={-20} y={-20} w={40} d={40} h={3} />
      <Lift order={2}>
        <Box x={-20} y={-20} w={40} d={40} h={3} z={12} />
      </Lift>
      <Lift>
        <Box x={-20} y={-20} w={40} d={40} h={3} z={24} tone="ok" />
      </Lift>
    </>
  ),
  // A staked deposit.
  vault: () => (
    <>
      <Box x={-20} y={-20} w={40} d={40} h={20} />
      <Mark closed line={[[-13, 20, 4], [13, 20, 4], [13, 20, 16], [-13, 20, 16]]} />
      <Lift>
        <Prism outline={ring(0, 0, 10, 20)} h={4} z={20} tone="ok" />
      </Lift>
    </>
  ),
  doc: () => (
    <>
      <Box x={-13} y={-20} w={32} d={42} h={3} />
      <Lift>
        <Box x={-19} y={-22} w={32} d={42} h={3} z={5} />
        <Mark z={8} tone="ok" line={[[-13, -15], [7, -15]]} />
        <Mark z={8} line={[[-13, -8], [7, -8]]} />
        <Mark z={8} line={[[-13, -1], [1, -1]]} />
      </Lift>
    </>
  ),
  // Seeing inside a contract.
  scan: () => (
    <>
      <Box x={-22} y={-22} w={44} d={44} h={4} />
      <Lift>
        <Box x={-7} y={-7} w={14} d={14} h={14} z={4} tone="risk" />
      </Lift>
      <Mark tone="dash" line={[[-17, 17, 4], [-17, 17, 32], [17, 17, 32], [17, 17, 4]]} />
      <Mark tone="dash" line={[[17, 17, 32], [17, -17, 32], [17, -17, 4]]} />
      <Mark tone="dash" line={[[17, -17, 32], [-17, -17, 32], [-17, 17, 32]]} />
    </>
  ),
  // Output leaving through the side.
  leak: () => (
    <>
      <Box x={-22} y={-20} w={32} d={40} h={20} />
      <Lift>
        <Box x={15} y={-4} w={9} d={9} h={9} tone="risk" />
      </Lift>
      <Lift order={2}>
        <Box x={23} y={12} w={6} d={6} h={6} tone="risk" />
      </Lift>
    </>
  ),
};

/** Decorative: the words beside it always say the same thing. */
export function IsoIcon({ name, size = 64 }) {
  const Draw = ICONS[name];
  if (!Draw) return null;
  return (
    <svg className="lp-ico" width={size} height={size} viewBox="8 10 80 80" aria-hidden="true" focusable="false">
      <Draw />
    </svg>
  );
}

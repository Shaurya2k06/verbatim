// Before a demo: is the devnet producing blocks, and can the sidecars see each other?
import { DEVNET, GATEWAY, MINER_SIDECAR, rpc } from "@verbatim/frames-sdk";

const block = await rpc<any>(DEVNET.node, "eth_getBlockByNumber", ["latest", false]);
const age = Math.floor(Date.now() / 1000) - Number(BigInt(block.timestamp));
console.log(`devnet block ${Number(BigInt(block.number))}, ${age} s old${age > 120 ? ": STALLED, use docs/demo/OFFLINE.md" : ""}`);
for (const u of [GATEWAY, MINER_SIDECAR]) {
  const peers = await rpc<any>(u, "skandha_connectedPeers", []).catch((e) => String(e.message));
  const info = await rpc<any>(u, "skandha_explorer_info", []).catch((e) => ({ error: String(e.message).slice(0, 80) }));
  console.log(u, "peers", JSON.stringify(peers).slice(0, 160), "mode", info.bundlingMode ?? info.error);
}

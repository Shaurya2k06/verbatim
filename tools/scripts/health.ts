import { GATEWAY, MINER_SIDECAR, rpc } from "@verbatim/frames-sdk";
for (const u of [GATEWAY, MINER_SIDECAR]) {
  const peers = await rpc<any>(u, "skandha_connectedPeers", []).catch((e) => String(e.message));
  const info = await rpc<any>(u, "skandha_explorer_info", []).catch((e) => ({ error: String(e.message).slice(0, 80) }));
  console.log(u, "peers", JSON.stringify(peers).slice(0, 160), "mode", info.bundlingMode ?? info.error);
}

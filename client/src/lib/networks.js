// The legs, built from the published deployments. Keyed endpoints are the server's proxies; addresses come only from deployments.
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { api } from "./api";

// Sepolia's RPC and bundler are keyed, so they go through the server's proxy.
export const SEPOLIA_RPC = api("/rpc/sepolia");
export const SEPOLIA_BUNDLER = api("/bundler");
export const STALE_AFTER_S = 60;

/** One entry per leg the status bar watches. `kind` decides how its relay is probed. */
export function legsFrom(deps) {
  const legs = [];
  const dev = deps["frames-devnet"];
  if (dev) legs.push({ id: "devnet", name: "Frames devnet", chainId: dev.chainId, rpc: dev.node, relay: { label: "gateway", url: dev.gateway, method: "eth_chainId" }, explorer: dev.explorer });
  const sep = deps.sepolia;
  if (sep) legs.push({ id: "sepolia", name: "Sepolia", chainId: sep.chainId, rpc: SEPOLIA_RPC, relay: { label: "bundler", url: SEPOLIA_BUNDLER, method: "eth_supportedEntryPoints" }, explorer: "https://sepolia.etherscan.io/" });
  for (const [name, d] of Object.entries(deps)) {
    if (name === "frames-devnet" || name === "sepolia" || !d.rpc) continue;
    legs.push({ id: name, name: d.displayName ?? name, chainId: d.chainId, rpc: d.rpc, relay: d.bundler ? { label: "bundler", url: d.bundler, method: "eth_supportedEntryPoints" } : { label: "bundler", url: "", method: "" }, explorer: d.explorer });
  }
  return legs;
}

export async function rpc(url, method, params = [], timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ctl.signal });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

let sepoliaClient;
export const sepoliaPublic = () => (sepoliaClient ??= createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) }));

/** A transaction link on the right explorer. The devnet explorer must be told which node saw the transaction. */
export function txUrl(leg, hash, deps) {
  if (leg === "sepolia") return `https://sepolia.etherscan.io/tx/${hash}`;
  const dev = deps?.["frames-devnet"];
  const explorer = dev?.explorer ?? "https://explorer.altmempool.wtf/";
  return dev?.mempool ? `${explorer}tx/${hash}?node=${encodeURIComponent(dev.mempool)}` : `${explorer}tx/${hash}`;
}

export const addressUrl = (leg, a, deps) => (leg === "sepolia" ? `https://sepolia.etherscan.io/address/${a}` : `${deps?.["frames-devnet"]?.explorer ?? "https://explorer.altmempool.wtf/"}address/${a}`);

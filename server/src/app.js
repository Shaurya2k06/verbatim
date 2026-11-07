// Verbatim's server: the only place secrets live. The client (../client) calls it under /api; src/index.js serves it with express.
//
// What it holds, and why:
//   SEPOLIA_RPC_URL, BUNDLER_URL, BUNDLER_URL_2  keyed endpoints, proxied with a method allowlist
//   SEPOLIA_LOGS_RPC_URL                        optional: where eth_getLogs goes (default: publicnode, which allows wide ranges)
//   ETHERSCAN_API_KEY                           logs older than the public endpoint keeps
//   WALLET_CONNECT_PROJECT_ID                   public by design; served so it is configured in one place
//   UNISWAP_API_KEY                             Trading API quotes, proxied
//   DEMO_EOA_KEY                                the "ordinary wallet" in /demo: a throwaway testnet EOA that only swaps
//   OWNER1_KEY, OWNER2_KEY                      two owners of the Sepolia demo account, for /suites only (see below)
//   ATTESTOR1_KEY..ATTESTOR3_KEY                re-sign the *published* snapshot's root with fresh timestamps (see snapshot())
//
// The owner keys are a deliberate exception for the public demo, because a visitor has none. A server signing sentences would
// defeat the point in real use, where owners sign on the offline signer. So suites.js signs only operations it builds itself, from
// a fixed list, on a testnet account, and /suites says so. No route accepts anything to sign.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, decodeAbiParameters, decodeFunctionData, http, isAddressEqual, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// Reads the repository's published deployments directly. DEPLOYMENTS_DIR overrides it when deployed away from the checkout.
const DATA = process.env.DEPLOYMENTS_DIR ? resolve(process.env.DEPLOYMENTS_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/deployments");
export const readData = (p) => JSON.parse(readFileSync(resolve(DATA, p), "utf8"));
let depCache;
export const dep = () => (depCache ??= readData("sepolia.json"));

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const need = (env, k) => {
  if (!env[k]) throw new HttpError(503, `${k} is not configured on the server`);
  return env[k];
};

// ---------------------------------------------------------------------------------------------------------------------------
// Rate limits: per server instance, which is enough to stop a stuck loop from burning testnet funds or API credits.
const buckets = new Map();
export function limit(key, perMinute) {
  const now = Date.now();
  const b = buckets.get(key) ?? { n: 0, at: now };
  if (now - b.at > 60_000) Object.assign(b, { n: 0, at: now });
  b.n++;
  buckets.set(key, b);
  if (b.n > perMinute) throw new HttpError(429, "too many requests; try again in a minute");
}

// ---------------------------------------------------------------------------------------------------------------------------
// JSON-RPC proxies.
const RPC_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_call", "eth_getCode", "eth_getBalance", "eth_getStorageAt",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_estimateGas", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_feeHistory", "net_version",
]);
const BUNDLER_METHODS = new Set([
  "eth_chainId", "eth_supportedEntryPoints", "eth_sendUserOperation", "eth_estimateUserOperationGas", "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash", "pimlico_getUserOperationGasPrice", "rundler_maxPriorityFeePerGas",
]);

export async function forward(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, `upstream returned ${r.status}`);
  }
}

function checkRpc(body, allowed) {
  if (Array.isArray(body)) throw new HttpError(400, "batches are not supported");
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") throw new HttpError(400, "not a JSON-RPC request");
  if (!allowed.has(body.method)) return { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: `${body.method} is not available through this proxy` } };
  if (body.method === "eth_getLogs") {
    const f = body.params?.[0] ?? {};
    if (f.blockHash) return null;
    const from = f.fromBlock && f.fromBlock.startsWith("0x") ? BigInt(f.fromBlock) : null;
    const to = f.toBlock && f.toBlock.startsWith("0x") ? BigInt(f.toBlock) : null;
    if (from === null || (to !== null && to - from > 10_000n)) return { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "eth_getLogs needs an explicit fromBlock and at most 10,000 blocks" } };
  }
  return null;
}

async function rpcSepolia(env, body, ip) {
  limit(`rpc:${ip}`, 600);
  const refused = checkRpc(body, RPC_METHODS);
  if (refused) return refused;
  // Alchemy's free tier caps eth_getLogs at 10 blocks, so log queries go to an endpoint that allows the 10,000 this proxy permits.
  if (body.method === "eth_getLogs") {
    const r = await forward(env.SEPOLIA_LOGS_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", body);
    // Public endpoints prune old logs; Etherscan keeps them.
    if (r.error && env.ETHERSCAN_API_KEY) return { jsonrpc: "2.0", id: body.id ?? null, result: await etherscanLogs(env, body.params[0]) };
    return r;
  }
  return forward(need(env, "SEPOLIA_RPC_URL"), body);
}

/** eth_getLogs through Etherscan's logs API, returned in JSON-RPC's shape. */
async function etherscanLogs(env, f) {
  const q = new URLSearchParams({ chainid: "11155111", module: "logs", action: "getLogs", fromBlock: String(BigInt(f.fromBlock)), toBlock: f.toBlock && f.toBlock.startsWith("0x") ? String(BigInt(f.toBlock)) : "latest", page: "1", offset: "1000", apikey: env.ETHERSCAN_API_KEY });
  if (f.address) q.set("address", Array.isArray(f.address) ? f.address[0] : f.address);
  const topics = (f.topics ?? []).map((t, i) => [i, Array.isArray(t) ? t[0] : t]).filter(([, t]) => t);
  for (const [i, t] of topics) q.set(`topic${i}`, t);
  for (let a = 0; a < topics.length; a++) for (let b = a + 1; b < topics.length; b++) q.set(`topic${topics[a][0]}_${topics[b][0]}_opr`, "and");
  const r = await fetch(`https://api.etherscan.io/v2/api?${q}`);
  const j = await r.json();
  if (j.status !== "1") {
    if (/no records/i.test(j.message ?? "") || (Array.isArray(j.result) && !j.result.length)) return [];
    throw new HttpError(502, `Etherscan: ${typeof j.result === "string" ? j.result : j.message}`);
  }
  const hex = (v) => (v === "0x" || v === "" ? "0x0" : v);
  return j.result.map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: hex(l.blockNumber), blockHash: l.blockHash ?? null, transactionHash: l.transactionHash, transactionIndex: hex(l.transactionIndex), logIndex: hex(l.logIndex), removed: false }));
}

/** Only this deployment's account may use our bundler credits. */
async function bundler(env, body, ip) {
  limit(`bundler:${ip}`, 120);
  const refused = checkRpc(body, BUNDLER_METHODS);
  if (refused) return refused;
  if (body.method === "eth_sendUserOperation" || body.method === "eth_estimateUserOperationGas") {
    const op = body.params?.[0];
    if (!op || !isAddressEqual(op.sender, dep().account)) return { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "this bundler proxy serves only the Verbatim demo account" } };
    if (body.method === "eth_sendUserOperation") limit("sendUserOperation", 20);
  }
  const urls = [env.BUNDLER_URL, env.BUNDLER_URL_2].filter(Boolean);
  if (!urls.length) throw new HttpError(503, "BUNDLER_URL is not configured on the server");
  try {
    return await forward(urls[0], body);
  } catch (e) {
    if (urls[1] && body.method !== "eth_sendUserOperation") return forward(urls[1], body);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Snapshot freshness. Policy caps a snapshot at six hours, so a static file goes stale. This re-signs the published snapshot's
// root, unchanged, with a fresh issuedAt and expiry. It cannot attest anything new: the leaves and root are the published ones.
// Same typed data as packages/snapshot-cli's snapshotTypedData (D_snapshot, §6).
const SNAPSHOT_TTL = 6n * 3600n;
const REFRESH_BEFORE = 90n * 60n;
let fresh = null;

export async function snapshot(env) {
  const base = readData("snapshot-sepolia.json");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(base.expiry) - now > REFRESH_BEFORE) return { ...base, source: "published" };
  if (fresh && fresh.root === base.root && BigInt(fresh.expiry) - now > REFRESH_BEFORE) return fresh;
  const keys = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => env[k]).filter(Boolean);
  if (keys.length < 2) return { ...base, source: "published", stale: BigInt(base.expiry) <= now };
  const listed = new Set(base.attestors.map((a) => a.toLowerCase()));
  const signers = keys.map((k) => privateKeyToAccount(k)).filter((a) => listed.has(a.address.toLowerCase())).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)).slice(0, 2);
  if (signers.length < 2) throw new HttpError(503, "the server's attestor keys are not the snapshot's attestors");
  const issuedAt = now - 60n;
  const expiry = issuedAt + SNAPSHOT_TTL;
  const chainId = BigInt(base.chainId);
  const typed = {
    domain: { name: "VerbatimSnapshot", version: "1", chainId },
    types: { Snapshot: [{ name: "root", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "expiry", type: "uint64" }, { name: "schema", type: "uint16" }] },
    primaryType: "Snapshot",
    message: { root: base.root, issuedAt, expiry, schema: base.schema },
  };
  const signatures = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(typed) })));
  fresh = { ...base, issuedAt: issuedAt.toString(), expiry: expiry.toString(), signatures, source: "re-signed" };
  return fresh;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The ordinary wallet in /demo. The page builds the swap with @verbatim/urrender; this checks it is one of the deployment's
// pools, at most 0.001 ETH, through the official router, and sends it from a throwaway EOA.
const ROUTER = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const POOL_KEY = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };
const LEGACY_SINGLE = [{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }];
const MAX_EOA_SWAP = parseEther("0.001");

function checkSwap(data, value) {
  const d = dep();
  const { args } = decodeFunctionData({ abi: ROUTER, data });
  const [commands, inputs] = args;
  if (commands !== "0x10" || inputs.length !== 1) throw new HttpError(400, "only a single V4_SWAP command is allowed");
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
  if (actions !== "0x060c0f") throw new HttpError(400, "only SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL is allowed");
  const [swap] = decodeAbiParameters(LEGACY_SINGLE, params[0]);
  const k = swap.poolKey;
  const route = Object.entries(d.pools).find(([, p]) => ["currency0", "currency1", "hooks"].every((f) => isAddressEqual(p.key[f], k[f])) && p.key.fee === k.fee && p.key.tickSpacing === k.tickSpacing);
  if (!route || !isAddressEqual(k.currency0, "0x0000000000000000000000000000000000000000") || !swap.zeroForOne) throw new HttpError(400, "not an ETH-in swap on one of the deployment's pools");
  if (value > MAX_EOA_SWAP || swap.amountIn !== value) throw new HttpError(400, "at most 0.001 ETH, and the value must match the swap");
  return route[0];
}

async function eoaSwap(env, body) {
  limit("eoa-swap", 6);
  const key = need(env, "DEMO_EOA_KEY");
  const value = BigInt(body?.value ?? -1);
  const pool = checkSwap(body?.data, value);
  const d = dep();
  const account = privateKeyToAccount(key);
  const transport = http(need(env, "SEPOLIA_RPC_URL"));
  const pub = createPublicClient({ chain: sepolia, transport });
  const balance = await pub.getBalance({ address: account.address });
  if (balance < value + parseEther("0.0005")) throw new HttpError(503, `the demo wallet ${account.address} is out of Sepolia ETH`);
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const hash = await wallet.sendTransaction({ to: d.uniswap.router, data: body.data, value, gas: 2_000_000n });
  return { hash, from: account.address, pool };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Uniswap Trading API quotes.
async function uniswapQuote(env, body, ip) {
  limit(`uniswap:${ip}`, 30);
  const r = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": need(env, "UNISWAP_API_KEY") },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      amount: String(body?.amount),
      tokenIn: body?.tokenIn,
      tokenOut: body?.tokenOut,
      tokenInChainId: Number(body?.chainId),
      tokenOutChainId: Number(body?.chainId),
      swapper: body?.swapper,
      slippageTolerance: Number(body?.slippage ?? 0.5),
      routingPreference: "BEST_PRICE",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, j.detail ?? j.errorCode ?? `Trading API returned ${r.status}`);
  return j;
}

// ---------------------------------------------------------------------------------------------------------------------------
// /attack sessions: the judge's phone and the team's laptop share one run by polling. Kept in this instance's memory: on a
// server with several instances they would need a shared store (DATABASE_URL, not wired yet).
const sessions = new Map();
const SESSION_TTL = 2 * 3600_000;
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

function session(method, parts, body) {
  for (const [k, s] of sessions) if (Date.now() - s.updated > SESSION_TTL) sessions.delete(k);
  if (method === "POST" && parts.length === 0) {
    let c = code();
    while (sessions.has(c)) c = code();
    const s = { code: c, created: Date.now(), updated: Date.now(), requests: [], events: [] };
    sessions.set(c, s);
    return s;
  }
  const s = sessions.get(String(parts[0] ?? "").toUpperCase());
  if (!s) throw new HttpError(404, "no such session; it may have expired");
  if (method === "GET") return s;
  if (method === "POST" && parts[1] === "request") {
    if (s.requests.length > 200) throw new HttpError(429, "this session is full");
    const r = { id: s.requests.length + 1, attack: String(body?.attack ?? "").slice(0, 32), from: String(body?.from ?? "judge").slice(0, 32), at: Date.now() };
    s.requests.push(r);
    s.updated = Date.now();
    return r;
  }
  if (method === "POST" && parts[1] === "event") {
    if (s.events.length > 500) throw new HttpError(429, "this session is full");
    const e = { ...Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => ["attack", "request", "stage", "outcome", "error", "txHash", "userOpHash", "leg"].includes(k)).map(([k, v]) => [k, String(v).slice(0, 300)])), at: Date.now() };
    s.events.push(e);
    s.updated = Date.now();
    return e;
  }
  throw new HttpError(405, "unsupported");
}

// ---------------------------------------------------------------------------------------------------------------------------
function config(env) {
  return {
    walletConnectProjectId: env.WALLET_CONNECT_PROJECT_ID || null,
    sepoliaRpc: !!env.SEPOLIA_RPC_URL,
    bundler: !!(env.BUNDLER_URL || env.BUNDLER_URL_2),
    uniswapApi: !!env.UNISWAP_API_KEY,
    eoaDemo: env.DEMO_EOA_KEY ? privateKeyToAccount(env.DEMO_EOA_KEY).address : null,
    snapshotRefresh: ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].filter((k) => env[k]).length >= 2,
    suites: !!(env.OWNER1_KEY && env.OWNER2_KEY),
  };
}

// Loaded on first use: it brings the signer and the renderer, which the rest of the API does not need.
const suites = () => import("./suites.js");
const frames = () => import("./frames.js");
const framesCases = () => import("./frames-cases.js");

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/** The whole API. `path` is everything after /api/. Returns { status, body }. */
export async function handle({ method, path, body, env, ip = "local" }) {
  const parts = path.split("/").filter(Boolean);
  try {
    let out;
    const route = `${method} ${parts[0] ?? ""}${parts[1] && parts[0] !== "session" ? `/${parts[1]}` : ""}`;
    switch (route) {
      case "GET health":
        out = { ok: true };
        break;
      case "GET config":
        out = config(env);
        break;
      case "POST rpc/sepolia":
        out = await rpcSepolia(env, body, ip);
        break;
      case "POST bundler":
        out = await bundler(env, body, ip);
        break;
      case "GET snapshot/sepolia":
        out = await snapshot(env);
        break;
      case "POST demo/eoa-swap":
        out = await eoaSwap(env, body);
        break;
      case "GET suites":
        out = await (await suites()).list(env);
        break;
      case "POST suites/run":
        out = await (await suites()).start(env, body, ip);
        break;
      case "GET suites/run":
        limit(`suites-read:${ip}`, 240);
        out = (await suites()).get(parts[2]);
        break;
      case "POST frames/run":
        out = (await frames()).start(env, ip);
        break;
      case "GET frames/cases":
        out = (await framesCases()).list();
        break;
      case "POST frames/case":
        out = (await framesCases()).start(env, body, ip);
        break;
      case "GET frames/case":
        limit(`frames-read:${ip}`, 240);
        out = (await framesCases()).get(parts[2]);
        break;
      case "GET frames/run":
        limit(`frames-read:${ip}`, 240);
        out = (await frames()).get(parts[2]);
        break;
      case "POST uniswap/quote":
        out = await uniswapQuote(env, body, ip);
        break;
      default:
        if (parts[0] === "session") {
          limit(`session:${ip}`, 240);
          out = session(method, parts.slice(1), body);
          break;
        }
        throw new HttpError(404, `no API route ${method} /api/${parts.join("/")}`);
    }
    return { status: 200, body: jsonSafe(out) };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return { status, body: { error: status === 500 ? `server error: ${e.shortMessage ?? e.message}` : e.message } };
  }
}

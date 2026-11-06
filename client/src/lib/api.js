// The browser's only route to keyed services: the separate server in ../server, under /api. Secrets never reach this bundle.
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Absolute URL of an API path, e.g. api("/rpc/sepolia"). */
export const api = (path) => new URL(`${BASE}/api${path}`, window.location.origin).href;

async function call(method, path, body) {
  const r = await fetch(api(path), { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body, (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)) : undefined });
  const j = await r.json().catch(() => ({ error: `server returned ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `server returned ${r.status}`), { status: r.status });
  return j;
}

export const apiGet = (path) => call("GET", path);
export const apiPost = (path, body) => call("POST", path, body ?? {});

let configP;
/** What the server has configured. Never contains a secret. */
export const serverConfig = () => (configP ??= apiGet("/config").catch((e) => ({ error: e.message })));

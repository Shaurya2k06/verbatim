// Everything the site knows comes from /data, published with the build by scripts/sync-data.mjs.
import { useEffect, useState } from "react";

const cache = new Map();

export function load(path) {
  if (!cache.has(path)) {
    const p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`/data/${path}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

/** { data, error, loading } for one published file, or several when given an array. */
export function useData(paths) {
  const key = Array.isArray(paths) ? paths.join("|") : paths;
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    const list = key.split("|");
    Promise.all(list.map(load))
      .then((xs) => live && setState({ data: Array.isArray(paths) ? xs : xs[0], error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** The deployments named in the manifest, keyed by their `network` field. */
export async function loadDeployments() {
  const m = await load("manifest.json");
  const all = await Promise.all(m.deployments.map((f) => load(`deployments/${f}`)));
  return Object.fromEntries(all.map((d) => [d.network, d]));
}

export function useDeployments() {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    loadDeployments()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const textCache = new Map();
/** A published text file (markdown), e.g. loadText("docs/GAS.md"). */
export function loadText(path) {
  if (!textCache.has(path)) {
    const p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`/data/${path}: HTTP ${r.status}`);
      return r.text();
    });
    p.catch(() => textCache.delete(path));
    textCache.set(path, p);
  }
  return textCache.get(path);
}

export function useText(path) {
  const [s, set] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    loadText(path)
      .then((data) => live && set({ data }))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [path]);
  return s;
}
